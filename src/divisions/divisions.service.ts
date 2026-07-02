import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { buildCacheKey, CACHE_TTL_SECONDS } from '../cache/cache-key.util';
import { GetDivisionsQuery } from './dto/requests/get-divisions-query.dto';
import { DivisionArea } from './interfaces/division.interface';
import { DivisionsSearchIndexService } from './divisions-search-index.service';

@Injectable()
export class DivisionsService {
    logger = new Logger('DivisionsService');

    constructor(
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
        private readonly searchIndex: DivisionsSearchIndexService,
    ) { }

    async getDivisions(query: GetDivisionsQuery): Promise<DivisionArea[]> {
        const { lat, lng, radius, limit, country, name, subtype, bbox } = query;
        const includeGeometry = query.resolveIncludeGeometry();

        const hasPoint = lat !== undefined && lng !== undefined
            && !Number.isNaN(lat) && !Number.isNaN(lng);

        // Metadata-only searches are served from the in-memory index when it is
        // loaded: milliseconds and no BigQuery scan. Point queries stay on
        // BigQuery for exact distance filtering/ordering, and anything needing
        // geometry has to go there too.
        if (!includeGeometry && !hasPoint && this.searchIndex.isReady()) {
            return this.searchIndex.search({ name, country, subtypes: subtype, bbox, limit });
        }

        const cacheKey = buildCacheKey('get-divisions', {
            lat, lng, radius, limit, country, name, subtype,
            // joined so buildCacheKey's array sort can't conflate different boxes
            bbox: bbox?.join(','),
            include_geometry: includeGeometry,
        });

        let results: DivisionArea[] | undefined = await this.cacheService.get<DivisionArea[]>(cacheKey);

        if (!results) {
            results = await this.bigQueryService.getDivisions({
                latitude: lat,
                longitude: lng,
                radius,
                limit,
                country,
                name,
                subtypes: subtype,
                bbox,
                includeGeometry,
            });
            await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        }
        return results;
    }

    async getDivisionById(id: string): Promise<DivisionArea | null> {
        const cacheKey = buildCacheKey('get-division-by-id', { id });

        let result: DivisionArea | null | undefined = await this.cacheService.get<DivisionArea>(cacheKey);

        if (result === undefined || result === null) {
            result = await this.bigQueryService.getDivisionById(id);
            if (result) {
                await this.cacheService.set(cacheKey, result, CACHE_TTL_SECONDS);
            }
        }
        return result ?? null;
    }
}
