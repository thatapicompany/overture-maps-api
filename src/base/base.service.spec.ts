import { Test, TestingModule } from '@nestjs/testing';
import { BaseService } from './base.service';
import { ConfigService } from '@nestjs/config';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';

describe('BaseService', () => {
    let service: BaseService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BaseService,
                { provide: ConfigService, useValue: {} },
                { provide: BigQueryService, useValue: {} },
                { provide: CacheService, useValue: {} },
            ],
        }).compile();
        service = module.get<BaseService>(BaseService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
