import { Test, TestingModule } from '@nestjs/testing';
import { AddressesService } from './addresses.service';
import { ConfigService } from '@nestjs/config';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';

describe('AddressesService', () => {
    let service: AddressesService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AddressesService,
                { provide: ConfigService, useValue: {} },
                { provide: BigQueryService, useValue: {} },
                { provide: CacheService, useValue: {} },
            ],
        }).compile();
        service = module.get<AddressesService>(AddressesService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
