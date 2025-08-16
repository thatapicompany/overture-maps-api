import { Test, TestingModule } from '@nestjs/testing';
import { CloudStorageCacheService } from './cloudstorage-cache.service';
import { ConfigService } from '@nestjs/config';
import { GcsService } from '../gcs/gcs.service';

describe('CloudStorageCacheService', () => {
  let service: CloudStorageCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudStorageCacheService,
        { provide: ConfigService, useValue: {} },
        { provide: GcsService, useValue: {} },
      ],
    }).compile();
    service = module.get<CloudStorageCacheService>(CloudStorageCacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
