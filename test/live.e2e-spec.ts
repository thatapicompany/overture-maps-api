import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

import { CacheService } from '../src/cache/cache.service';
import { CloudStorageCacheService } from '../src/cloudstorage-cache/cloudstorage-cache.service';

// Use a long timeout since live BigQuery queries can take time
jest.setTimeout(30000);

describe('Live Endpoints (e2e)', () => {
    let app: INestApplication;
    const apiKey = process.env.TEST_API_KEY || 'DEMO-API-KEY';

    const mockCacheService = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
        getJSON: jest.fn().mockResolvedValue(undefined),
        storeJSON: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(CacheService)
            .useValue(mockCacheService)
            .overrideProvider(CloudStorageCacheService)
            .useValue(mockCacheService)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new import_1.ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    // Base coords for testing
    const lat = 37.7749;
    const lng = -122.4194;
    const radius = 100;
    const limit = 2; // small limit to reduce BigQuery costs
    const queryParams = `lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`;

    it('should have an API key', () => {
        expect(apiKey).toBeDefined();
    });

    it('/addresses (GET) live', async () => {
        const response = await request(app.getHttpServer())
            .get(`/addresses?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/base (GET) live', async () => {
        const response = await request(app.getHttpServer())
            .get(`/base?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/buildings (GET) live', async () => {
        const response = await request(app.getHttpServer())
            .get(`/buildings?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/transportation (GET) live', async () => {
        const response = await request(app.getHttpServer())
            .get(`/transportation?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/divisions (GET) live', async () => {
        const response = await request(app.getHttpServer())
            .get(`/divisions?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });
});
