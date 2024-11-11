
import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { Place, PlaceWithBuilding } from '../places/interfaces/place.interface';
import { Building } from '../buildings/interfaces/building.interface';
import { parsePointToGeoJSON, parsePolygonToGeoJSON } from '../utils/geojson';
import { parsePlaceRow, parsePlaceWithBuildingRow } from './row-parsers/bq-place-row.parser';
import { parseBuildingRow } from './row-parsers/bq-building-row.parser';

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
const SOURCE_DATASET="bigquery-public-data.overture_maps" 

@Injectable()
export class BigQueryService {
  private bigQueryClient: BigQuery;
  logger = new Logger('BigQueryService');

  constructor() {
    this.bigQueryClient = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }
  

  // New method to get brands based on country or lat/lng/radius
  async getBrandsNearby(
    country_code?: string,
    latitude?: number,
    longitude?: number,
    radius: number = 1000,
    categories?: string[],
    minimum_places?: number,
    require_wikidata: boolean = false

  ): Promise<{ names: {primary:string,common:string,rules:string}; wikidata: string; counts:{ places:number}  }[]> {

    let query = `-- Overture Maps API: Get brands nearby
      SELECT DISTINCT brand , count(id) as count_places
      FROM \`${SOURCE_DATASET}.place\`
    `;

    if (country_code) {
      query += ` WHERE addresses.list[OFFSET(0)].element.country = "${country_code}"`;
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
    }
    query += ` GROUP BY ALL`;
    if (minimum_places) {
      query += ` HAVING count_places >= ${minimum_places}`;
    }
    query += ` ORDER BY count_places DESC;`;

    const {rows} = await this.runQuery(query);

    return rows.map((row: any) => ({
      names: row.brand.names,
      wikidata: row.brand.wikidata,
      counts:{
        places: row.count_places
      }
    }));
  }

  async getPlaceCountsByCountry(): Promise<{ country: string; counts:{ places:number, brands:number} }[]> {
    const query = `-- Overture Maps API: Get place counts by country
      SELECT addresses.list[OFFSET(0)].element.country AS country, COUNT(id) AS count_places, count(DISTINCT brand.names.primary ) as count_brands
      FROM \`${SOURCE_DATASET}.place\`
      GROUP BY country
      ORDER BY count_places DESC;
    `;

    const {rows} = await this.runQuery(query);

    return rows.map((row: any) => ({
      country: row.country,
      counts:{
        places: row.count_places,
        brands: row.count_brands
      }
    }));
  }

  async getCategories(country?:string): Promise<{ primary: string; counts:{ places:number } }[]> {
    let query = `-- Overture Maps API: Get categories
      SELECT DISTINCT categories.primary AS category_primary,
      count(1) as count_places,
      count(distinct brand.names.primary) as count_brands
      FROM \`${SOURCE_DATASET}.place\`
      WHERE categories.primary IS NOT NULL
    `;
    if (country) {
      query += ` AND addresses.list[OFFSET(0)].element.country = "${country}"`
    }

    query += ` GROUP BY category_primary
      ORDER BY count_places DESC;
    `;

    const {rows} = await this.runQuery(query);

    return rows.map((row: any) => ({
      primary: row.category_primary,
      counts:{
        places: row.count_places,
        brands: row.count_brands
      }
    }));
  }async getPlacesWithNearestBuilding(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    brand_wikidata?: string,
    brand_name?: string,
    country?: string,
    categories?: string[],
    min_confidence?: number,
    limit?: number,
    match_nearest_building: boolean = true
  ): Promise<PlaceWithBuilding[]> {
    
    // Build the query
    let queryParts: string[] = [];
  
    queryParts.push(`
    -- Overture Maps API: Get Places with Buildings
    -- Step 1: Define the search area as a circular polygon around the point with a specified radius
    DECLARE search_area_geometry GEOGRAPHY;
    SET search_area_geometry = ST_Buffer(ST_GeogPoint(${longitude}, ${latitude}), ${radius});
    `);
  
    // Build the WHERE clause for additional filters
    let whereClauses: string[] = [];
    
    // Add radius condition if not already in WHERE clause
    whereClauses.push(`ST_DWithin(p.geometry, ST_GeogPoint(${longitude}, ${latitude}), ${radius})`);
  
    if (brand_wikidata) {
      whereClauses.push(`p.brand.wikidata = "${brand_wikidata}"`);
    }
    
    if (brand_name) {
      whereClauses.push(`p.brand.names.primary = "${brand_name}"`);
    }
    
    if (country) {
      whereClauses.push(`p.addresses[OFFSET(0)].country = "${country}"`);
    }
    
    if (categories && categories.length > 0) {
      whereClauses.push(`p.categories.primary IN UNNEST(["${categories.join('","')}"])`);
    }
    
    if (min_confidence !== undefined) {
      whereClauses.push(`p.confidence >= ${min_confidence}`);
    }
  
    // Determine if we match nearest building or only containing buildings
    if (match_nearest_building) {
      queryParts.push(`
      -- Step 2: Select buildings within the search area and calculate the distance
      WITH nearby_buildings AS (
        SELECT
          id AS building_id,
          geometry AS building_geometry,
          ST_Distance(geometry, ST_GeogPoint(${longitude}, ${latitude})) AS building_distance
        FROM
          \`bigquery-public-data.overture_maps.building\`
        WHERE
          ST_WITHIN(geometry, search_area_geometry)
          AND ST_DWithin(geometry, ST_GeogPoint(${longitude}, ${latitude}), ${radius})
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
          ST_DWithin(p.geometry, b.building_geometry, ${radius})
        WHERE
          ST_WITHIN(p.geometry, search_area_geometry)
        `
+ (whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '') +
      `

      )
    
      -- Step 4: Select only the nearest building for each place
      SELECT
        * except(distance_rank)
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
        0 as distance_to_nearest_building
      FROM
        \`bigquery-public-data.overture_maps.place\` AS p
      JOIN
        \`bigquery-public-data.overture_maps.building\` AS b
      ON
        ST_WITHIN(p.geometry, b.geometry)
      WHERE
        ST_WITHIN(p.geometry, search_area_geometry)
        `
+ (whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '') +
      `
      `);
    }
  
  
    // Limit results if specified
    if (limit) {
      queryParts.push(`LIMIT ${this.applyMaxLimit(limit)}`);
    }
  
    // Finalize the query
    const query = queryParts.join(' ') + ';';
    this.logger.debug(`Running query: ${query}`);
  
    // Execute the query
    const { rows } = await this.runQuery(query);
  
    // Map results to the response type
    return rows.map((row: any) => parsePlaceWithBuildingRow(row));
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
    limit?: number
  ): Promise<Place[]> {
  
    let queryParts: string[] = [];
  
    // Base query and distance calculation if latitude and longitude are provided
    queryParts.push(`-- Overture Maps API: Get places nearby \n`);
    queryParts.push(`SELECT *`);
    
    if (latitude && longitude) {
      queryParts.push(`, ST_Distance(geometry, ST_GeogPoint(${longitude}, ${latitude})) AS ext_distance`);
    }
  
    queryParts.push(`FROM \`${SOURCE_DATASET}.place\``);
  
    // Conditional filters
    let whereClauses: string[] = [];
    
    if (latitude && longitude && radius) {
      whereClauses.push(`ST_DWithin(geometry, ST_GeogPoint(${longitude}, ${latitude}), ${radius})`);
    } 
  
    if (brand_wikidata) {
      whereClauses.push(`brand.wikidata = "${brand_wikidata}"`);
    }
    if (brand_name) {
      whereClauses.push(`brand.names.primary = "${brand_name}"`);
    }
  
    if (country) {
      whereClauses.push(`addresses.list[OFFSET(0)].element.country = "${country}"`);
    }

    if(categories && categories.length > 0){
      whereClauses.push(`categories.primary IN UNNEST(["${categories.join('","')}"])`);
    }
  
    if (min_confidence) {
      whereClauses.push(`confidence >= ${min_confidence}`);
    }
  
    // Combine where clauses
    if (whereClauses.length > 0) {
      queryParts.push(`WHERE ${whereClauses.join(' AND ')}`);
    }
  
    // Order by distance if latitude and longitude are provided
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance`);
    }
  
    // Limit results if no filters are provided
    if (limit) {
      queryParts.push(`LIMIT ${this.applyMaxLimit(limit)}`);
    }
  
    // Finalize the query
    const query = queryParts.join(' ') + ';';
    this.logger.debug(`Running query: ${query}`);
  
    const { rows } = await this.runQuery(query);
    return rows.map((row: any) => parsePlaceRow(row));
  }  

    

  async getBuildingsNearby(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    limit?: number
  ): Promise<Building[]> {
  
    let queryParts: string[] = [];
  
    queryParts.push(
    `-- Overture Maps API: Get Buildings Nearby
    -- Step 1: define the search area to limit the cost in step 2 taking advantage of the 'geometry' clustering
DECLARE search_area_geometry GEOGRAPHY;
SET search_area_geometry = ST_Buffer(ST_GeogPoint(${longitude}, ${latitude}), ${radius});

-- Step 2: Select buildings within the search area
SELECT
  *
 ,ST_Distance(geometry, ST_GeogPoint(${longitude}, ${latitude})) AS ext_distance
FROM
  \`bigquery-public-data.overture_maps.building\` AS s
WHERE ST_WITHIN(s.geometry, search_area_geometry) and ST_DWithin(geometry, ST_GeogPoint(${longitude}, ${latitude}), ${radius})`);

    // Order by distance if latitude and longitude are provided
    if (latitude && longitude) {
      queryParts.push(`ORDER BY ext_distance`);
    }
  
    // Limit results if no filters are provided
    if (limit) {
      queryParts.push(`LIMIT ${this.applyMaxLimit(limit)}`);
    }
  
    // Finalize the query
    const query = queryParts.join(' ') + ';';
    this.logger.debug(`Running query: ${query}`);
  
    const { rows } = await this.runQuery(query);
    return rows.map((row: any) => parseBuildingRow(row));
  }
  
  applyMaxLimit(limit: number): number {
    return Math.min(limit, MAX_LIMIT);
  }

  getDefaultLabels() : any
  {

      const  labels =  {
          "product":  "overture-maps-api",
          "env": process.env.ENV
      }
      return labels;
  }

  async runQuery(query:string, labels:any={}):Promise<{rows:any[], statistics:IQueryStatistics}>
  {
      
      let start = Date.now()
      const options = {
          query: query,
          // Location must match that of the dataset(s) referenced in the query.
          location: 'US',
          labels: {...labels, ...this.getDefaultLabels()},
      };
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

      const statistics:IQueryStatistics = {
          totalBytesProcessed,
          totalBytesBilled,
          billedAmountInGB: Math.round(totalBytesBilled / 1000000000),
          bytesProcessedInGB: Math.round(totalBytesProcessed / 1000000000),
          durationMs: Date.now() - start,
          costInUSD
      }

      const QueryFirstLine = query.split('\n')[0];
      this.logger.log(`BigQuery: Duration: ${statistics.durationMs}ms. Billed ${statistics.billedAmountInGB} GB. USD $$${costInUSD.toFixed(4)}. Query Line 1: ${QueryFirstLine}`);
      
      return {rows,statistics};
    }
}