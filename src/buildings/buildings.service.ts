/*
https://docs.nestjs.com/providers#services
*/

import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { AuthedUser, User } from '../decorators/authed-user.decorator';
import { ValidateLatLngUser } from '../decorators/validate-lat-lng-user.decorator';
import { ConfigService } from '@nestjs/config';
import { CloudStorageCacheService } from '../cloudstorage-cache/cloudstorage-cache.service';
import { GetBuildingsQuery } from './dto/requests/get-buildings-query.dto';
import { Building } from './interfaces/building.interface';
import { buildCacheKey } from '../cache/cache-key.util';

@Injectable()
export class BuildingsService {

    logger = new Logger('PlacesService');
    
    constructor(
        private readonly configService: ConfigService,
      private readonly bigQueryService: BigQueryService,
      private readonly cloudStorageCache: CloudStorageCacheService,
    ) {}

    async getBuildings(query: GetBuildingsQuery): Promise<Building[]> {
        const {  lat, lng, radius,limit } = query;
  
        // Check if cached results exist in File Cache. Key on data-affecting params
        // only (not presentation/format) so equivalent requests share one entry.
        const cacheKey = buildCacheKey('get-buildings', { lat, lng, radius, limit });
        const cachedResult = await this.cloudStorageCache.getJSON(cacheKey);
        if (cachedResult) {
          return cachedResult;
        }
      
        const results = await this.bigQueryService.getBuildingsNearby( lat, lng, radius,limit);
        await this.cloudStorageCache.storeJSON (results,cacheKey);
        return results;//
      }
}
