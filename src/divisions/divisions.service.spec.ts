import { Test, TestingModule } from '@nestjs/testing';
import { DivisionsService } from './divisions.service';
import { ConfigService } from '@nestjs/config';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';

describe('DivisionsService', () => {
    let service: DivisionsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DivisionsService,
                { provide: ConfigService, useValue: {} },
                { provide: BigQueryService, useValue: {} },
                { provide: CacheService, useValue: {} },
            ],
        }).compile();
        service = module.get<DivisionsService>(DivisionsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
