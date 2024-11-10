
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
    return this.gcsService.getJSON(cacheKey);
  }
  
  async storeJSON(data: any[], cacheKey: string): Promise<boolean> {
    return this.gcsService.storeJSON(data, cacheKey);
  }
}