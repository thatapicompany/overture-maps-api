import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { GetTransportationQuery } from './dto/requests/get-transportation-query.dto';
import { TransportationSegment } from './interfaces/transportation.interface';

@Injectable()
export class TransportationService {
    logger = new Logger('TransportationService');

    constructor(
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
    ) { }

    async getTransportationSegments(query: GetTransportationQuery): Promise<TransportationSegment[]> {
        const { lat, lng, radius, limit } = query;
        const cacheKey = `get-transportation-${JSON.stringify(query)}`;

        let results: TransportationSegment[] | undefined = await this.cacheService.get<TransportationSegment[]>(cacheKey);

        if (!results) {
            results = await this.bigQueryService.getTransportationNearby(lat, lng, radius, limit);
            await this.cacheService.set(cacheKey, results, 3600);
        }
        return results;
    }
}
