
import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { Place } from '../places/interfaces/place.interface';
import { ConfigService } from '@nestjs/config';
import { GcsService } from '../gcs/gcs.service';
@Injectable()
export class CloudStorageCacheService {

    constructor(
        private readonly configService: ConfigService,
      private readonly gcsService: GcsService) {
        
    }
    

  logger = new Logger('CloudStorageCacheService');

  async getJSON (cacheKey: string): Promise<any[]|null> {
    const gcs = new Storage();
    const bucket = gcs.bucket(process.env.GCS_BUCKET);
    const file = bucket.file(cacheKey);
    try {
      const data = await file.download();
      return JSON.parse(data.toString());
    } catch (error) {
      return null;
    }
  }
  
  async storeJSON(data: any[], cacheKey: string): Promise<boolean> {
    const gcs = new Storage();
    const bucket = gcs.bucket(process.env.GCS_BUCKET);
    const file = bucket.file(cacheKey);
    try {
      await file.save(JSON.stringify(data));
      return true
    } catch (error) {
      this.logger.error(`Error storing cache: ${error}`);
      return false
    }
  }
}