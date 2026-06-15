import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { buildCacheKey, CACHE_TTL_SECONDS } from '../cache/cache-key.util';
import { GetDivisionsQuery } from './dto/requests/get-divisions-query.dto';
import { DivisionArea } from './interfaces/division.interface';

@Injectable()
export class DivisionsService {
    logger = new Logger('DivisionsService');

    constructor(
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
    ) { }

    async getDivisions(query: GetDivisionsQuery): Promise<DivisionArea[]> {
        const { lat, lng, radius, limit } = query;
        const cacheKey = buildCacheKey('get-divisions', { lat, lng, radius, limit });

        let results: DivisionArea[] | undefined = await this.cacheService.get<DivisionArea[]>(cacheKey);

        if (!results) {
            results = await this.bigQueryService.getDivisionsNearby(lat, lng, radius, limit);
            await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        }
        return results;
    }
}
