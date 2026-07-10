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

    async getDivisions(query: GetDivisionsQuery): Promise<{ results: DivisionArea[]; totalCount: number }> {
        const { lat, lng, radius, limit, page = 0, country, name, subtype, admin_level, bbox } = query;
        const includeGeometry = query.resolveIncludeGeometry();

        const hasPoint = lat !== undefined && lng !== undefined
            && !Number.isNaN(lat) && !Number.isNaN(lng);

        // Metadata-only searches are served from the in-memory index when it is
        // loaded: milliseconds and no BigQuery scan. Point queries stay on
        // BigQuery for exact distance filtering/ordering, and anything needing
        // geometry has to go there too. admin_level filters also need BigQuery
        // until the index artifact has been rebuilt with admin_level data.
        const indexCanServe = this.searchIndex.isReady()
            && (!admin_level || admin_level.length === 0 || this.searchIndex.hasAdminLevels());
        if (!includeGeometry && !hasPoint && indexCanServe) {
            return this.searchIndex.search({ name, country, subtypes: subtype, adminLevels: admin_level, bbox, limit, page });
        }

        const cacheKey = buildCacheKey('get-divisions', {
            lat, lng, radius, limit, country, name, subtype, admin_level,
            // page omitted when 0 by buildCacheKey's falsy filter? No — 0 is
            // kept explicit here so page-0 keys match the pre-pagination keys
            // only when the shape matches; see array tolerance below.
            page: page > 0 ? page : undefined,
            // joined so buildCacheKey's array sort can't conflate different boxes
            bbox: bbox?.join(','),
            include_geometry: includeGeometry,
        });

        let cached = await this.cacheService.get<any>(cacheKey);
        // Entries cached before pagination shipped are plain arrays; wrap them
        // so they stay valid until their TTL expires.
        if (Array.isArray(cached)) {
            cached = { results: cached, totalCount: cached.length };
        }
        if (cached?.results) {
            return cached;
        }

        const paginated = await this.bigQueryService.getDivisions({
            latitude: lat,
            longitude: lng,
            radius,
            limit,
            page,
            country,
            name,
            subtypes: subtype,
            adminLevels: admin_level,
            bbox,
            includeGeometry,
        });
        await this.cacheService.set(cacheKey, paginated, CACHE_TTL_SECONDS);
        return paginated;
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
