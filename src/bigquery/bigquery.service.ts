// src/bigquery/bigquery.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { Place } from '../places/interfaces/place.interface';

interface IQueryStatistics {
  totalBytesProcessed: number;
  totalBytesBilled: number;
  billedAmountInGB: number;
  bytesProcessedInGB: number;
  durationMs: number;
}

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

  private parsePlaceRow(row: any): Place {
    return {
        id: row.id,
        geometry: {
          type: 'Point',
          coordinates: this.parseGeometry(row.geometry),
        },
        bbox: {
          xmin: parseFloat(row.bbox.xmin),
          xmax: parseFloat(row.bbox.xmax),
          ymin: parseFloat(row.bbox.ymin),
          ymax: parseFloat(row.bbox.ymax),
        },
        version: row.version,
        sources: row.sources.list.map((source: any) => ({
          property: source.element.property,
          dataset: source.element.dataset,
          record_id: source.element.record_id,
          update_time: source.element.update_time,
          confidence: source.element.confidence ? parseFloat(source.element.confidence) : null,
        })),
        names: {
          primary: row.names.primary,
          common: row.names.common,
          rules: row.names.rules,
        },
        categories: {
          primary: row.categories?.primary,
          alternate: row.categories?.alternate?.split ? row.categories?.alternate?.split(',') : [],
        },
        confidence: parseFloat(row.confidence),
        websites: row.websites?.split ? row.websites.split(',') : [],
        socials: row.socials?.list ? row.socials.list.map((social: any) => social.element) : [],
        emails: row.emails?.split ? row.emails.split(',') : [],
        phones: row.phones?.list ? row.phones.list.map((phone: any) => phone.element) : [],
        brand: row.brand ? {
          names: {
            primary: row.brand?.names?.primary,
            common: row.brand?.names?.common,
            rules: row.brand?.names?.rules,
          },
          wikidata: row.brand?.wikidata,
        } : undefined,
        addresses: row.addresses?.list ? row.addresses?.list.map((address: any) => ({
          freeform: address.element?.freeform,
          locality: address.element?.locality,
          postcode: address.element?.postcode,
          region: address.element?.region,
          country: address.element?.country,
        })) : [],
        distance_m: parseFloat(row.distance_m),
      }
    }

  // Function to parse the "POINT" geometry string into coordinates array
  private parseGeometry(geometry: string): number[] {
    try{
        //@ts-ignore
        const match = geometry.value.match(/POINT\(([^ ]+) ([^ ]+)\)/);
        if (match) {
            const longitude = parseFloat(match[1]);
            const latitude = parseFloat(match[2]);
            return [longitude, latitude];
        }
    }catch(err){
        this.logger.error(err);
        this.logger.error(`Error parsing geometry: ${JSON.stringify(geometry)}`);
    }
    return [];
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
      FROM \`bigquery-public-data.overture_maps.place\`
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
      query += ` AND category.primary IN UNNEST(["${categories.join('","')}"])`;
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
      FROM \`bigquery-public-data.overture_maps.place\`
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
      FROM \`bigquery-public-data.overture_maps.place\`
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
      queryParts.push(`, ST_Distance(geometry, ST_GeogPoint(${latitude}, ${longitude})) AS distance_m`);
    }
  
    queryParts.push(`FROM \`bigquery-public-data.overture_maps.place\``);
  
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
      console.log(categories);
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
      queryParts.push(`ORDER BY distance_m`);
    }
  
    // Limit results if no filters are provided
    if (!latitude && !longitude && !brand_wikidata && !brand_name) {
      queryParts.push(`LIMIT ${this.applyMaxLimit(limit)}`);
    }
  
    // Finalize the query
    const query = queryParts.join(' ') + ';';
    this.logger.debug(`Running query: ${query}`);
  
    const { rows } = await this.runQuery(query);
    return rows.map((row: any) => this.parsePlaceRow(row));
  }  

  applyMaxLimit(limit: number): number {
    return Math.min(limit, 1000);
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
      
      const statistics:IQueryStatistics = {
          totalBytesProcessed,
          totalBytesBilled,
          billedAmountInGB: Math.round(totalBytesBilled / 1000000000),
          bytesProcessedInGB: Math.round(totalBytesProcessed / 1000000000),
          durationMs: Date.now() - start
      }

      const QueryFirstLine = query.split('\n')[0];
      this.logger.log(`BigQuery: Duration: ${statistics.durationMs}ms. Billed ${statistics.billedAmountInGB} GB. Processed ${statistics.bytesProcessedInGB} GB. Query ${QueryFirstLine}`);
      
      return {rows,statistics};
    }
}