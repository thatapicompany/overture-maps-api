import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { buildCacheKey, CACHE_TTL_SECONDS } from '../cache/cache-key.util';
import { GetAddressesQuery } from './dto/requests/get-addresses-query.dto';
import { Address } from './interfaces/address.interface';

@Injectable()
export class AddressesService {
    logger = new Logger('AddressesService');

    constructor(
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
    ) { }

    async getAddresses(query: GetAddressesQuery): Promise<{ results: Address[]; totalCount: number }> {
        const { lat, lng, radius, limit, page = 0 } = query;
        const cacheKey = buildCacheKey('get-addresses', { lat, lng, radius, limit, page: page > 0 ? page : undefined });

        let cached: any = await this.cacheService.get<any>(cacheKey);
        // Entries cached before pagination shipped are plain arrays; wrap them.
        if (Array.isArray(cached)) {
            cached = { results: cached, totalCount: cached.length };
        }
        if (!cached?.results) {
            cached = await this.bigQueryService.getAddressesNearby(lat, lng, radius, limit, page);
            await this.cacheService.set(cacheKey, cached, CACHE_TTL_SECONDS);
        }
        return cached;
    }
}
