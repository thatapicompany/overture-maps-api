
import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { Place, PlaceWithBuilding } from '../places/interfaces/place.interface';
import { Building } from '../buildings/interfaces/building.interface';
import { parsePointToGeoJSON, parsePolygonToGeoJSON } from '../utils/geojson';
import { parsePlaceRow, parsePlaceWithBuildingRow } from './row-parsers/bq-place-row.parser';
import { parseBuildingRow } from './row-parsers/bq-building-row.parser';
import { Address } from '../addresses/interfaces/address.interface';
import { parseAddressRow } from './row-parsers/bq-address-row.parser';
import { BaseFeature } from '../base/interfaces/base.interface';
import { parseBaseRow } from './row-parsers/bq-base-row.parser';
import { TransportationSegment } from '../transportation/interfaces/transportation.interface';
import { parseTransportationRow } from './row-parsers/bq-transportation-row.parser';
import { DivisionArea } from '../divisions/interfaces/division.interface';
import { parseDivisionRow } from './row-parsers/bq-division-row.parser';
import { currentRequestId, recordBqJob } from '../usage/usage.context';

interface IQueryStatistics {
  totalBytesProcessed: number;
  totalBytesBilled: number;
  billedAmountInGB: number;
  bytesProcessedInGB: number;
  durationMs: number;
  costInUSD: number;
}

const MAX_LIMIT = 100000;

// replace this with your own dataset if you have optimised ot to only include the country you are interested in
const SOURCE_DATASET = "bigquery-public-data.overture_maps"

// How long to trust a cached place-table column list. Overture releases monthly
// and Google re-mirrors shortly after, so a few hours is plenty to pick up the
// September 2026 `categories` column removal without a redeploy.
const PLACE_COLUMNS_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class BigQueryService {
  private bigQueryClient: BigQuery;
  logger = new Logger('BigQueryService');

  constructor() {

    const config: any = {
      projectId: process.env.BIGQUERY_PROJECT_ID
    };

    // Only add keyFilename if GOOGLE_APPLICATION_CREDENTIALS is set
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      config.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    this.bigQueryClient = new BigQuery(config);
  }

  private placeColumnsCache: { columns: Set<string>; fetchedAt: number } | null = null;

  /**
   * Column names of the source `place` table, from table metadata (a free API
   * call, no query cost). Lets query builders adapt to upstream schema changes
   * — most immediately the September 2026 removal of `categories` — instead of
   * throwing SQL errors when a column disappears. On metadata failure the last
   * known set is reused, falling back to the pre-taxonomy schema.
   */
  async getPlaceColumns(): Promise<Set<string>> {
    const now = Date.now();
    if (this.placeColumnsCache && now - this.placeColumnsCache.fetchedAt < PLACE_COLUMNS_TTL_MS) {
      return this.placeColumnsCache.columns;
    }
    try {
      const [projectId, datasetId] = SOURCE_DATASET.split('.');
      const [metadata] = await this.bigQueryClient
        .dataset(datasetId, { projectId })
        .table('place')
        .getMetadata();
      const columns = new Set<string>(metadata.schema.fields.map((f: any) => f.name));
      this.placeColumnsCache = { columns, fetchedAt: now };
      return columns;
    } catch (error) {
      this.logger.warn(`Could not fetch place table metadata: ${error.message}`);
      if (this.placeColumnsCache) return this.placeColumnsCache.columns;
      // Assume the long-standing schema (categories present) if we've never seen metadata.
      return new Set(['categories']);
    }
  }

  /**
   * SQL for the `categories` query filter. Matches the legacy `categories`
   * column (while it still exists upstream) and the v1.15+ `taxonomy` /
   * `basic_category` vocabulary, so client filter values from either
   * generation keep working before, during and after the September 2026
   * upstream removal of `categories`.
   */
  private categoryFilterSql(hasCategoriesColumn: boolean, prefix = ''): string {
    const legacy = `${prefix}categories.primary IN UNNEST(@categories)`;
    const taxonomy = `${prefix}taxonomy.primary IN UNNEST(@categories) OR ${prefix}basic_category IN UNNEST(@categories)`;
    return hasCategoriesColumn ? `(${legacy} OR ${taxonomy})` : `(${taxonomy})`;
  }

  /**
   * SQL for the `taxonomy` query filter: matches the primary taxonomy category
   * or any ancestor in the hierarchy, so e.g. `food_and_drink` matches every
   * descendant category.
   */
  private taxonomyFilterSql(prefix = ''): string {
    return `(${prefix}taxonomy.primary IN UNNEST(@taxonomy) OR EXISTS(SELECT 1 FROM UNNEST(${prefix}taxonomy.hierarchy.list) AS th WHERE th.element IN UNNEST(@taxonomy)))`;
  }

  // Maps a public has_contact value to its Overture array column. Contact
  // columns are Parquet-style repeated fields (STRUCT<list ARRAY<..>>), so
  // presence is ARRAY_LENGTH(col.list) > 0. NULL columns yield NULL (excluded).
  private static readonly CONTACT_COLUMNS: Record<string, string> = {
    website: 'websites',
    phone: 'phones',
    email: 'emails',
    social: 'socials',
  };

  /**
   * "At least one of the requested contact fields is present" — OR semantics,
   * so has_contact=website,social matches places with a website OR a social.
   * Values are DTO-validated against CONTACT_COLUMNS keys; unknown values are
   * ignored defensively.
   */
  private contactPresenceSql(fields: string[], prefix = ''): string | null {
    const clauses = fields
      .map((f) => BigQueryService.CONTACT_COLUMNS[f])
      .filter(Boolean)
      .map((col) => `ARRAY_LENGTH(${prefix}${col}.list) > 0`);
    return clauses.length ? `(${clauses.join(' OR ')})` : null;
  }

  /**
   * Appends LIMIT/OFFSET for pagination. Used together with a
   * `COUNT(*) OVER() AS total_count` window aggregate in the SELECT list so a
   * single query returns both the requested page and the total number of
   * matching rows (no separate COUNT query, no extra scan).
   */
  private applyPagination(queryParts: string[], params: any, limit?: number, page = 0): void {
    if (!limit) return;
    queryParts.push(`LIMIT @limit`);
    params.limit = this.applyMaxLimit(limit);
    if (page > 0) {
      queryParts.push(`OFFSET @offset`);
      params.offset = page * this.applyMaxLimit(limit);
    }
  }

  /** Total matching rows from the window aggregate; falls back to page size. */
  private extractTotalCount(rows: any[]): number {
    if (rows.length > 0 && rows[0].total_count !== undefined && rows[0].total_count !== null) {
      return Number(rows[0].total_count);
    }
    return rows.length;
  }


  // New method to get brands based on country or lat/lng/radius
  async getBrandsNearby(
    country?: string,
    latitude?: number,
    longitude?: number,
    radius: number = 1000,
    categories?: string[],
    minimum_places?: number,
    require_wikidata: boolean = false

  ): Promise<{ names: { primary: string, common: string, rules: string }; wikidata: string; counts: { places: number } }[]> {

    let query = `-- Overture Maps API: Get brands nearby
      SELECT DISTINCT brand , count(id) as count_places
      FROM \`${SOURCE_DATASET}.place\`
    `;

    const params: any = {};
    const hasCategoriesColumn = (await this.getPlaceColumns()).has('categories');
    const whereClauses = this.buildWhereClauses({ country, latitude, longitude, radius, categories, require_wikidata, hasCategoriesColumn, params });
    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    /*
        if (country) {
          query += ` WHERE addresses.list[OFFSET(0)].element.country = "${country}"`;
        } else if (latitude && longitude) {
          query += ` WHERE ST_DISTANCE(
            ST_GEOGPOINT(${longitude}, ${latitude}),
            ST_GEOGPOINT(CAST(SPLIT(SUBSTR(geometry, 7), ' ')[SAFE_OFFSET(0)] AS FLOAT64), CAST(SPLIT(SUBSTR(geometry, 7), ' ')[SAFE_OFFSET(1)] AS FLOAT64))
          ) <= ${radius}`;
        }
        query += ` AND brand IS NOT NULL`;
        if(categories && categories.length > 0){
          query += ` AND categories.primary IN UNNEST(["${categories.join('","')}"])`;
        }
        if (require_wikidata) {
          query += ` AND brand.wikidata IS NOT NULL`;
        }*/
    query += ` GROUP BY ALL`;
    if (minimum_places) {
      query += ` HAVING count_places >= @minimum_places`;
      params.minimum_places = minimum_places;
    }
    query += ` ORDER BY count_places DESC;`;

    const { rows } = await this.runQuery(query, params);

    return rows.map((row: any) => ({
      names: row.brand?.names,
      wikidata: row.brand?.wikidata,
      counts: {
        places: row.count_places
      }
    }));
  }

  async getPlaceCountsByCountry(): Promise<{ country: string; counts: { places: number, brands: number } }[]> {
    const query = `-- Overture Maps API: Get place counts by country
      SELECT addresses.list[OFFSET(0)].element.country AS country, COUNT(id) AS count_places, count(DISTINCT brand.names.primary ) as count_brands
      FROM \`${SOURCE_DATASET}.place\`
      GROUP BY country
      ORDER BY count_places DESC;
    `;

    const { rows } = await this.runQuery(query);

    return rows.map((row: any) => ({
      country: row.country,
      counts: {
        places: row.count_places,
        brands: row.count_brands
      }
    }));
  }

  async getCategories(
    country?: string,
    latitude?: number,
    longitude?: number,
    radius: number = 1000
  ): Promise<{ primary: string; counts: { places: number } }[]> {

    // Prefer the legacy `categories` vocabulary while the column exists so the
    // response is unchanged for existing clients; once Overture removes it
    // (September 2026), serve the same response shape from `taxonomy`.
    const hasCategoriesColumn = (await this.getPlaceColumns()).has('categories');
    const categoryColumn = hasCategoriesColumn ? 'categories.primary' : 'taxonomy.primary';

    let query = `-- Overture Maps API: Get categories
      SELECT DISTINCT ${categoryColumn} AS category_primary,
      count(1) as count_places,
      count(distinct brand.names.primary) as count_brands
      FROM \`${SOURCE_DATASET}.place\`
      WHERE ${categoryColumn} IS NOT NULL
    `;

    const params: any = {};
    const whereClauses = this.buildWhereClauses({ country, latitude, longitude, radius, params });
    if (whereClauses.length > 0) {
      query += ` AND ${whereClauses.join(' AND ')}`;
    }
    query += ` GROUP BY category_primary
      ORDER BY count_places DESC;
    `;

    const { rows } = await this.runQuery(query, params);

    return rows.map((row: any) => ({
      primary: row.category_primary,
      counts: {
        places: row.count_places,
        brands: row.count_brands
      }
    }));
  }


  async getPlacesWithNearestBuilding(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    brand_wikidata?: string,
    brand_name?: string,
    country?: string,
    categories?: string[],
    min_confidence?: number,
    limit?: number,
    match_nearest_building: boolean = true,
    operating_status?: string,
    taxonomy?: string[],
    page: number = 0
  ): Promise<{ results: PlaceWithBuilding[]; totalCount: number }> {

    // Build the query
    let queryParts: string[] = [];
    const params: any = {};
    const hasCategoriesColumn = (await this.getPlaceColumns()).has('categories');

    queryParts.push(`
    -- Overture Maps API: Get Places with Buildings
    -- Single statement (no DECLARE) so BigQuery can serve identical repeat queries
    -- from its free results cache. The search area is inlined as ST_Buffer(...).
    `);
    params.longitude = longitude;
    params.latitude = latitude;
    params.radius = radius;

    // Build the WHERE clause for additional filters
    let whereClauses: string[] = [];

    if (latitude && longitude && radius) {
      // Add radius condition if not already in WHERE clause
      whereClauses.push(`ST_DWithin(p.geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);
    }
    if (brand_wikidata) {
      whereClauses.push(`p.brand.wikidata = @brand_wikidata`);
      params.brand_wikidata = brand_wikidata;
    }

    if (brand_name) {
      whereClauses.push(`p.brand.names.primary = @brand_name`);
      params.brand_name = brand_name;
    }

    if (country) {
      whereClauses.push(`p.addresses[OFFSET(0)].element.country = @country`);
      params.country = country;
    }

    if (categories && categories.length > 0) {
      whereClauses.push(this.categoryFilterSql(hasCategoriesColumn, 'p.'));
      params.categories = categories;
    }

    if (taxonomy && taxonomy.length > 0) {
      whereClauses.push(this.taxonomyFilterSql('p.'));
      params.taxonomy = taxonomy;
    }

    if (operating_status) {
      whereClauses.push(`p.operating_status = @operating_status`);
      params.operating_status = operating_status;
    }

    if (min_confidence !== undefined) {
      whereClauses.push(`p.confidence >= @min_confidence`);
      params.min_confidence = min_confidence;
    }

    // Determine if we match nearest building or only containing buildings
    if (match_nearest_building) {
      queryParts.push(`
      -- Step 2: Select buildings within the search area and calculate the distance
      WITH nearby_buildings AS (
        SELECT
          id AS building_id,
          geometry AS building_geometry,
          ST_Distance(geometry, ST_GeogPoint(@longitude, @latitude)) AS building_distance
        FROM
          \`bigquery-public-data.overture_maps.building\`
        WHERE
          ST_WITHIN(geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius))
          AND ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)
      ),
    
      -- Step 3: Select places within the search area and join to the nearest building
      place_with_nearest_building AS (
        SELECT
          p.*,
          b.building_id as building_id,
          b.building_geometry AS building_geometry,
          ST_Distance(p.geometry, b.building_geometry) AS distance_to_nearest_building,
          ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY ST_Distance(p.geometry, b.building_geometry)) AS distance_rank
        FROM
          \`bigquery-public-data.overture_maps.place\` AS p
        JOIN
          nearby_buildings AS b
        ON
          ST_DWithin(p.geometry, b.building_geometry, @radius)
        WHERE
          ST_WITHIN(p.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius))
        `
        + (whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '') +
        `

      )
    
      -- Step 4: Select only the nearest building for each place
      SELECT
        * EXCEPT(distance_rank), COUNT(*) OVER() AS total_count
      FROM
        place_with_nearest_building
      WHERE
        distance_rank = 1
      `);
    } else {
      queryParts.push(`
      -- Step 2: Select places and buildings within the search area where the building contains the place geometry
      SELECT
        p.*,
        b.id as building_id,
        b.geometry AS building_geometry,
        0 as distance_to_nearest_building,
        COUNT(*) OVER() AS total_count
      FROM
        \`bigquery-public-data.overture_maps.place\` AS p
      JOIN
        \`bigquery-public-data.overture_maps.building\` AS b
      ON
        ST_WITHIN(p.geometry, b.geometry)
      WHERE
        ST_WITHIN(p.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius))
        `
        + (whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '') +
        `
      `);
    }


    // Always deterministic: stable, disjoint pages regardless of which page
    // a client requests first.
    queryParts.push(`ORDER BY distance_to_nearest_building, id`);

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    // Execute the query
    const { rows } = await this.runQuery(query, params);

    // Map results to the response type
    return {
      results: rows.map((row: any) => parsePlaceWithBuildingRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }




  async getPlacesNearby(

    latitude: number,
    longitude: number,
    radius: number = 1000,
    brand_wikidata?: string,
    brand_name?: string,
    country?: string,
    categories?: string[],
    min_confidence?: number,
    limit?: number,
    source?: string,
    operating_status?: string,
    taxonomy?: string[],
    page: number = 0,
    has_contact?: string[]
  ): Promise<{ results: Place[]; totalCount: number }> {

    let queryParts: string[] = [];
    const params: any = {};
    const hasCategoriesColumn = (await this.getPlaceColumns()).has('categories');

    // Base query and distance calculation if latitude and longitude are provided
    queryParts.push(`-- Overture Maps API: Get places nearby \n`);
    queryParts.push(`SELECT *, COUNT(*) OVER() AS total_count`);

    if (latitude && longitude) {
      queryParts.push(`, ST_Distance(geometry, ST_GeogPoint(@longitude, @latitude)) AS ext_distance`);
      params.latitude = latitude;
      params.longitude = longitude;
    }

    queryParts.push(`FROM \`${SOURCE_DATASET}.place\``);

    // Conditional filters
    let whereClauses: string[] = [];

    if (latitude && longitude && radius) {
      whereClauses.push(`ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);
      params.radius = radius;
    }

    if (brand_wikidata) {
      whereClauses.push(`brand.wikidata = @brand_wikidata`);
      params.brand_wikidata = brand_wikidata;
    }
    if (brand_name) {
      whereClauses.push(`brand.names.primary = @brand_name`);
      params.brand_name = brand_name;
    }

    if (country) {
      whereClauses.push(`addresses.list[OFFSET(0)].element.country = @country`);
      params.country = country;
    }

    if (categories && categories.length > 0) {
      whereClauses.push(this.categoryFilterSql(hasCategoriesColumn));
      params.categories = categories;
    }

    if (taxonomy && taxonomy.length > 0) {
      whereClauses.push(this.taxonomyFilterSql());
      params.taxonomy = taxonomy;
    }

    if (operating_status) {
      whereClauses.push(`operating_status = @operating_status`);
      params.operating_status = operating_status;
    }

    if (min_confidence) {
      whereClauses.push(`confidence >= @min_confidence`);
      params.min_confidence = min_confidence;
    }

    if (source) {
      // Filter for at least one sources element with matching dataset
      whereClauses.push(`EXISTS (SELECT 1 FROM UNNEST(sources) AS s WHERE s.dataset = @source)`);
      params.source = source;
    }

    if (has_contact && has_contact.length > 0) {
      const contactSql = this.contactPresenceSql(has_contact);
      if (contactSql) whereClauses.push(contactSql);
    }

    // Combine where clauses
    if (whereClauses.length > 0) {
      queryParts.push(`WHERE ${whereClauses.join(' AND ')}`);
    }

    // Order by distance if latitude and longitude are provided; the id
    // tiebreaker (and the id-only ordering for country queries) is applied
    // only when paginating, so pages are deterministic without changing
    // existing unpaginated behaviour.
    // Always deterministic: the id tiebreaker guarantees stable, disjoint
    // pages regardless of which page a client requests first.
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance, id`);
    } else {
      queryParts.push(`ORDER BY id`);
    }

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    this.logger.debug(`Running query: ${query}`);

    const { rows } = await this.runQuery(query, params);
    return {
      results: rows.map((row: any) => parsePlaceRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }



  async getBuildingsNearby(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    limit?: number,
    page: number = 0
  ): Promise<{ results: Building[]; totalCount: number }> {

    let queryParts: string[] = [];
    const params: any = { latitude, longitude, radius };

    queryParts.push(
      `-- Overture Maps API: Get Buildings Nearby
    -- Single statement (no DECLARE) so BigQuery can serve identical repeat queries
    -- from its free results cache. ST_Buffer is inlined; the 'geometry' clustering
    -- is still pruned and the result set is unchanged.
SELECT
  *, COUNT(*) OVER() AS total_count
 ,ST_Distance(geometry, ST_GeogPoint(@longitude, @latitude)) AS ext_distance
FROM
  \`bigquery-public-data.overture_maps.building\` AS s
WHERE ST_WITHIN(s.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius)) and ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);

    // Order by distance if latitude and longitude are provided
    // Always deterministic: the id tiebreaker guarantees stable, disjoint
    // pages regardless of which page a client requests first.
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance, id`);
    } else {
      queryParts.push(`ORDER BY id`);
    }

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    const { rows } = await this.runQuery(query, params);
    return {
      results: rows.map((row: any) => parseBuildingRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }

  applyMaxLimit(limit: number): number {
    return Math.min(limit, MAX_LIMIT);
  }

  getDefaultLabels(): any {

    const labels: any = {
      "product": "overture-maps-api",
      "env": process.env.ENV
    }
    // Tag the BigQuery job with the API request id so INFORMATION_SCHEMA.JOBS can be
    // reconciled against the usage table. UUIDs satisfy BigQuery's label-value rules
    // ([a-z0-9_-], <=63 chars); guard anyway in case the format ever changes.
    const requestId = currentRequestId();
    if (requestId && /^[a-z0-9_-]{1,63}$/.test(requestId)) {
      labels.request_id = requestId;
    }
    return labels;
  }

  async runQuery(query: string, params?: any, labels: any = {}): Promise<{ rows: any[], statistics: IQueryStatistics }> {

    let start = Date.now()
    const options: any = {
      query: query,
      // Location must match that of the dataset(s) referenced in the query.
      location: 'US',
      labels: { ...labels, ...this.getDefaultLabels() },
    };
    if (params) {
      options.params = params;
    }
    // Run the query as a job
    const [job] = await this.bigQueryClient.createQueryJob(options);

    // Wait for the query to finish
    const [rows] = await job.getQueryResults();
    const [result] = await job.getMetadata();

    const totalBytesProcessed = parseInt(result.statistics.totalBytesProcessed);
    const totalBytesBilled = parseInt(result.statistics.query.totalBytesBilled);

    const costPerTB = 5; // USD per TB
    const bytesPerTB = 1e12;
    const costInUSD = (totalBytesBilled / bytesPerTB) * costPerTB;

    const statistics: IQueryStatistics = {
      totalBytesProcessed,
      totalBytesBilled,
      billedAmountInGB: Math.round(totalBytesBilled / 1000000000),
      bytesProcessedInGB: Math.round(totalBytesProcessed / 1000000000),
      durationMs: Date.now() - start,
      costInUSD
    }

    const QueryFirstLine = query.split('\n')[0];
    this.logger.log(`BigQuery: Duration: ${statistics.durationMs}ms. Billed ${statistics.billedAmountInGB} GB. USD $$${costInUSD.toFixed(4)}. Query Line 1: ${QueryFirstLine}`);

    // Attribute this job's cost to the current API request for per-customer usage modelling.
    recordBqJob({
      jobId: job.id ?? null,
      bytesProcessed: totalBytesProcessed,
      bytesBilled: totalBytesBilled,
      costUsd: costInUSD,
      durationMs: statistics.durationMs,
      statementType: result.statistics?.query?.statementType ?? null,
    });

    return { rows, statistics };
  }
  async getAddressesNearby(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    limit?: number,
    page: number = 0
  ): Promise<{ results: Address[]; totalCount: number }> {

    let queryParts: string[] = [];
    const params: any = { latitude, longitude, radius };

    queryParts.push(
      `-- Overture Maps API: Get Addresses Nearby
    -- Single statement (no DECLARE) so BigQuery can cache identical repeat queries.
SELECT
  *, COUNT(*) OVER() AS total_count
 ,ST_Distance(geometry, ST_GeogPoint(@longitude, @latitude)) AS ext_distance
FROM
  \`bigquery-public-data.overture_maps.address\` AS s
WHERE ST_WITHIN(s.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius)) and ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);

    // Order by distance if latitude and longitude are provided
    // Always deterministic: the id tiebreaker guarantees stable, disjoint
    // pages regardless of which page a client requests first.
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance, id`);
    } else {
      queryParts.push(`ORDER BY id`);
    }

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    const { rows } = await this.runQuery(query, params);
    return {
      results: rows.map((row: any) => parseAddressRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }

  async getBaseNearby(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    limit?: number,
    page: number = 0
  ): Promise<{ results: BaseFeature[]; totalCount: number }> {

    let queryParts: string[] = [];
    const params: any = { latitude, longitude, radius };

    queryParts.push(
      `-- Overture Maps API: Get Base Features Nearby (Land Use + Land Cover)
    -- Single statement (no DECLARE) so BigQuery can cache identical repeat queries.
WITH combined_base AS (
  SELECT id, geometry, bbox, version, sources, subtype, class FROM \`bigquery-public-data.overture_maps.land_use\`
  UNION ALL
  SELECT id, geometry, bbox, version, sources, subtype, CAST(NULL as string) as class FROM \`bigquery-public-data.overture_maps.land_cover\`
)
SELECT
  *, COUNT(*) OVER() AS total_count
 ,ST_Distance(geometry, ST_GeogPoint(@longitude, @latitude)) AS ext_distance
FROM
  combined_base AS s
WHERE ST_WITHIN(s.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius)) and ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);

    // Order by distance if latitude and longitude are provided
    // Always deterministic: the id tiebreaker guarantees stable, disjoint
    // pages regardless of which page a client requests first.
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance, id`);
    } else {
      queryParts.push(`ORDER BY id`);
    }

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    const { rows } = await this.runQuery(query, params);
    return {
      results: rows.map((row: any) => parseBaseRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }

  async getTransportationNearby(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    limit?: number,
    page: number = 0
  ): Promise<{ results: TransportationSegment[]; totalCount: number }> {

    let queryParts: string[] = [];
    const params: any = { latitude, longitude, radius };

    queryParts.push(
      `-- Overture Maps API: Get Transportation Segments Nearby
    -- Single statement (no DECLARE) so BigQuery can cache identical repeat queries.
SELECT
  *, COUNT(*) OVER() AS total_count
 ,ST_Distance(geometry, ST_GeogPoint(@longitude, @latitude)) AS ext_distance
FROM
  \`bigquery-public-data.overture_maps.segment\` AS s
WHERE ST_WITHIN(s.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius)) and ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);

    // Order by distance if latitude and longitude are provided
    // Always deterministic: the id tiebreaker guarantees stable, disjoint
    // pages regardless of which page a client requests first.
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance, id`);
    } else {
      queryParts.push(`ORDER BY id`);
    }

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    const { rows } = await this.runQuery(query, params);
    return {
      results: rows.map((row: any) => parseTransportationRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }

  async getDivisions(options: {
    latitude?: number;
    longitude?: number;
    radius?: number;
    country?: string;
    name?: string;
    subtypes?: string[];
    adminLevels?: number[];
    bbox?: number[]; // [xmin, ymin, xmax, ymax]
    limit?: number;
    page?: number;
    includeGeometry?: boolean;
  }): Promise<{ results: DivisionArea[]; totalCount: number }> {

    const { latitude, longitude, radius = 1000, country, name, subtypes, adminLevels, bbox, limit, page = 0, includeGeometry = true } = options;

    const hasPoint = latitude !== undefined && longitude !== undefined
      && !Number.isNaN(latitude) && !Number.isNaN(longitude);

    const params: any = {};
    const whereClauses: string[] = [];

    if (hasPoint) {
      whereClauses.push(`ST_WITHIN(s.geometry, ST_Buffer(ST_GeogPoint(@longitude, @latitude), @radius)) AND ST_DWithin(s.geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);
      params.latitude = latitude;
      params.longitude = longitude;
      params.radius = radius;
    }
    if (country) {
      whereClauses.push(`s.country = @country`);
      params.country = country;
    }
    if (name) {
      // Substring match on primary / English common name, or an exact ID match,
      // mirroring a typical admin-area search box.
      whereClauses.push(`(
        LOWER(s.names.primary) LIKE @name_like
        OR EXISTS(SELECT 1 FROM UNNEST(s.names.common.key_value) AS kv WHERE kv.key = 'en' AND LOWER(kv.value) LIKE @name_like)
        OR s.id = @name_exact
      )`);
      params.name_like = `%${name.toLowerCase()}%`;
      params.name_exact = name;
    }
    if (subtypes && subtypes.length > 0) {
      whereClauses.push(`s.subtype IN UNNEST(@subtypes)`);
      params.subtypes = subtypes;
    }
    if (adminLevels && adminLevels.length > 0) {
      whereClauses.push(`s.admin_level IN UNNEST(@admin_levels)`);
      params.admin_levels = adminLevels;
    }
    if (bbox && bbox.length === 4) {
      // Intersection test against the precomputed bbox columns — far cheaper
      // than ST_Intersects on the polygon geometry.
      whereClauses.push(`s.bbox.xmin <= @bbox_xmax AND s.bbox.xmax >= @bbox_xmin AND s.bbox.ymin <= @bbox_ymax AND s.bbox.ymax >= @bbox_ymin`);
      [params.bbox_xmin, params.bbox_ymin, params.bbox_xmax, params.bbox_ymax] = bbox;
    }

    if (whereClauses.length === 0) {
      // DTO validation requires at least one narrowing filter; guard against a
      // full-table scan if this is ever called directly without one.
      throw new Error('getDivisions requires at least one filter (point, country, name or bbox)');
    }

    let queryParts: string[] = [];
    queryParts.push(
      `-- Overture Maps API: Get Division Areas
    -- Single statement (no DECLARE) so BigQuery can cache identical repeat queries.
    -- Excluding geometry skips the by-far-largest column, so search-style queries scan ~99% less.
SELECT
  ${includeGeometry ? '*' : '* EXCEPT (geometry)'}, COUNT(*) OVER() AS total_count
 ${hasPoint ? ',ST_Distance(s.geometry, ST_GeogPoint(@longitude, @latitude)) AS ext_distance' : ''}
FROM
  \`bigquery-public-data.overture_maps.division_area\` AS s
WHERE ${whereClauses.join('\n  AND ')}`);

    // Always deterministic: the id tiebreaker guarantees stable, disjoint
    // pages regardless of which page a client requests first.
    if (hasPoint) {
      queryParts.push(`ORDER BY ext_distance, s.id`);
    } else {
      queryParts.push(`ORDER BY s.id`);
    }

    this.applyPagination(queryParts, params, limit, page);

    // Finalize the query
    const query = queryParts.join(' ') + ';';

    const { rows } = await this.runQuery(query, params);
    return {
      results: rows.map((row: any) => parseDivisionRow(row)),
      totalCount: this.extractTotalCount(rows),
    };
  }

  async getDivisionById(id: string): Promise<DivisionArea | null> {
    const query = `-- Overture Maps API: Get Division Area by ID
SELECT
  *
FROM
  \`bigquery-public-data.overture_maps.division_area\` AS s
WHERE s.id = @id
LIMIT 1;`;

    const { rows } = await this.runQuery(query, { id });
    if (!rows.length) return null;

    const division = parseDivisionRow(rows[0]);

    // Upstream data gap (github.com/OvertureMaps/data/issues/540): a handful
    // of country-level land records have NULL geometry in the BigQuery mirror
    // (e.g. Russia, Australia) while their maritime sibling (land + territorial
    // waters, same division_id) is intact. Fall back to the sibling's geometry
    // so clients always get a boundary, flagged via ext_geometry_source.
    if (!division.geometry && rows[0].division_id) {
      const fallbackQuery = `-- Overture Maps API: Get Division Area geometry fallback (sibling area)
SELECT
  *
FROM
  \`bigquery-public-data.overture_maps.division_area\` AS s
WHERE s.division_id = @division_id
  AND s.id != @id
  AND s.geometry IS NOT NULL
ORDER BY s.is_land DESC
LIMIT 1;`;
      const { rows: fallbackRows } = await this.runQuery(fallbackQuery, { division_id: rows[0].division_id, id });
      if (fallbackRows.length) {
        const sibling = parseDivisionRow(fallbackRows[0]);
        division.geometry = sibling.geometry;
        division.bbox = division.bbox ?? sibling.bbox;
        division.ext_geometry_source = sibling.class ?? 'sibling_area';
      }
    }

    return division;
  }
  private buildWhereClauses({
    country,
    latitude,
    longitude,
    radius,
    brand_wikidata,
    brand_name,
    categories,
    min_confidence,
    require_wikidata,
    hasCategoriesColumn = true,
    params
  }: {
    country?: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    brand_wikidata?: string;
    brand_name?: string;
    categories?: string[];
    min_confidence?: number;
    require_wikidata?: boolean;
    hasCategoriesColumn?: boolean;
    params: any;
  }): string[] {
    const whereClauses: string[] = [];

    if (latitude && longitude && radius) {
      whereClauses.push(`ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)`);
      params.latitude = latitude;
      params.longitude = longitude;
      params.radius = radius;
    }
    if (country) {
      whereClauses.push(`addresses.list[OFFSET(0)].element.country = @country`);
      params.country = country;
    }
    if (brand_wikidata) {
      whereClauses.push(`brand.wikidata = @brand_wikidata`);
      params.brand_wikidata = brand_wikidata;
    }
    if (brand_name) {
      whereClauses.push(`brand.names.primary = @brand_name`);
      params.brand_name = brand_name;
    }
    if (categories && categories.length > 0) {
      whereClauses.push(this.categoryFilterSql(hasCategoriesColumn));
      params.categories = categories;
    }
    if (min_confidence !== undefined) {
      whereClauses.push(`confidence >= @min_confidence`);
      params.min_confidence = min_confidence;
    }
    if (require_wikidata) {
      whereClauses.push(`brand.wikidata IS NOT NULL`);
    }

    return whereClauses;
  }

}