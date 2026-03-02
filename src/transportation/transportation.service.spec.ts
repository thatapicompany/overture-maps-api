import { Test, TestingModule } from '@nestjs/testing';
import { TransportationService } from './transportation.service';
import { ConfigService } from '@nestjs/config';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';

describe('TransportationService', () => {
    let service: TransportationService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TransportationService,
                { provide: ConfigService, useValue: {} },
                { provide: BigQueryService, useValue: {} },
                { provide: CacheService, useValue: {} },
            ],
        }).compile();
        service = module.get<TransportationService>(TransportationService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
