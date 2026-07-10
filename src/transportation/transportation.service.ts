import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { buildCacheKey, CACHE_TTL_SECONDS } from '../cache/cache-key.util';
import { GetTransportationQuery } from './dto/requests/get-transportation-query.dto';
import { TransportationSegment } from './interfaces/transportation.interface';

@Injectable()
export class TransportationService {
    logger = new Logger('TransportationService');

    constructor(
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
    ) { }

    async getTransportationSegments(query: GetTransportationQuery): Promise<{ results: TransportationSegment[]; totalCount: number }> {
        const { lat, lng, radius, limit, page = 0 } = query;
        const cacheKey = buildCacheKey('get-transportation', { lat, lng, radius, limit, page: page > 0 ? page : undefined });

        let cached: any = await this.cacheService.get<any>(cacheKey);
        // Entries cached before pagination shipped are plain arrays; wrap them.
        if (Array.isArray(cached)) {
            cached = { results: cached, totalCount: cached.length };
        }
        if (!cached?.results) {
            cached = await this.bigQueryService.getTransportationNearby(lat, lng, radius, limit, page);
            await this.cacheService.set(cacheKey, cached, CACHE_TTL_SECONDS);
        }
        return cached;
    }
}
