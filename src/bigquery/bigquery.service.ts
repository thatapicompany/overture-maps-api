// src/bigquery/bigquery.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { Place } from '../places/interfaces/place.interface';

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
  async getPlacesNearby(
    latitude: number,
    longitude: number,
    radius: number = 1000,
    wikidata?: string,
    country?: string
  ): Promise<Place[]> {
    // Build the query with optional filters for wikidata and country
    let query = `
      SELECT *, ST_Distance(geometry, ST_GeogPoint(${longitude}, ${latitude})) AS distance_m FROM \`bigquery-public-data.overture_maps.place\`
      WHERE ST_DWithin(geometry, ST_GeogPoint(${longitude}, ${latitude}), ${radius})

    `;

  
    if (wikidata) {
        query += ` AND brand.wikidata = "${wikidata}"`;
      }
  
      if (country) {
        query += ` AND addresses.list[OFFSET(0)].element.country = "${country}"`;
      }
    query += ` ORDER BY distance_m LIMIT 100;`;
    
    this.logger.debug(`Running query: ${query}`);

    const options = {
      query: query,
      location: 'US', // Adjust the location if necessary
    };

    const [rows] = await this.bigQueryClient.query(options);

    return rows.map((row: any) => ({
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
    }));
  }
}