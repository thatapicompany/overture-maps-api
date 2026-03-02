import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { GetBaseQuery } from './dto/requests/get-base-query.dto';
import { BaseFeature } from './interfaces/base.interface';

@Injectable()
export class BaseService {
    logger = new Logger('BaseService');

    constructor(
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
    ) { }

    async getBaseFeatures(query: GetBaseQuery): Promise<BaseFeature[]> {
        const { lat, lng, radius, limit } = query;
        const cacheKey = `get-base-${JSON.stringify(query)}`;

        let results: BaseFeature[] | undefined = await this.cacheService.get<BaseFeature[]>(cacheKey);

        if (!results) {
            results = await this.bigQueryService.getBaseNearby(lat, lng, radius, limit);
            await this.cacheService.set(cacheKey, results, 3600);
        }
        return results;
    }
}
