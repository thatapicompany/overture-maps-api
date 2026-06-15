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

    async getAddresses(query: GetAddressesQuery): Promise<Address[]> {
        const { lat, lng, radius, limit } = query;
        const cacheKey = buildCacheKey('get-addresses', { lat, lng, radius, limit });

        let results: Address[] | undefined = await this.cacheService.get<Address[]>(cacheKey);

        if (!results) {
            results = await this.bigQueryService.getAddressesNearby(lat, lng, radius, limit);
            await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        }
        return results;
    }
}
