import { Test, TestingModule } from '@nestjs/testing';
import { BuildingsService } from './buildings.service';
import { ConfigService } from '@nestjs/config';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CloudStorageCacheService } from '../cloudstorage-cache/cloudstorage-cache.service';

describe('BuildingsService', () => {
  let service: BuildingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingsService,
        { provide: ConfigService, useValue: {} },
        { provide: BigQueryService, useValue: {} },
        { provide: CloudStorageCacheService, useValue: {} },
      ],
    }).compile();
    service = module.get<BuildingsService>(BuildingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
