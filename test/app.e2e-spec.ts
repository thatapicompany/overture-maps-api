import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { BigQueryService } from '../src/bigquery/bigquery.service';
import { CacheService } from '../src/cache/cache.service';
import { CloudStorageCacheService } from '../src/cloudstorage-cache/cloudstorage-cache.service';
import * as fs from 'fs';
import * as path from 'path';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let bigQueryService: BigQueryService;

  const mockBigQueryService = {
    getAddressesNearby: jest.fn(),
    getBaseNearby: jest.fn(),
    getBuildingsNearby: jest.fn(),
    getTransportationNearby: jest.fn(),
    getDivisions: jest.fn(),
    getDivisionById: jest.fn(),
    // We can add mock implementations for places if needed
  };

  const mockCacheService = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    getJSON: jest.fn().mockResolvedValue(undefined),
    storeJSON: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BigQueryService)
      .useValue(mockBigQueryService)
      .overrideProvider(CacheService)
      .useValue(mockCacheService)
      .overrideProvider(CloudStorageCacheService)
      .useValue(mockCacheService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const readMockFile = (filename: string) => {
    const filePath = path.join(__dirname, 'mock-data', 'bq-results', filename);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  };

  // BigQueryService search methods return a pagination envelope; the
  // PaginationInterceptor unwraps it so response bodies stay plain arrays.
  const paginated = <T>(results: T[]) => ({ results, totalCount: results.length });

  it('/ (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .expect(200);
    expect(response.body).toBeDefined();
    expect(response.body).toHaveProperty('service');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toBe('API by ThatAPICompany.com, Data by OvertureMaps.org');
  });

  it('/addresses (GET)', async () => {
    const mockData = readMockFile('get-addresses-nearby.json');
    const { parseAddressRow } = require('../src/bigquery/row-parsers/bq-address-row.parser');
    mockBigQueryService.getAddressesNearby.mockResolvedValue(paginated(mockData.map(parseAddressRow)));

    const response = await request(app.getHttpServer())
      .get('/addresses?lat=40.7128&lng=-74.0060')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('address-1');
    // Pagination metadata travels in headers; the body stays a plain array
    expect(response.headers['pagination-count']).toBe('1');
    expect(response.headers['pagination-page']).toBe('0');
    expect(response.headers['x-total-count']).toBe('1');
  });

  it('/base (GET)', async () => {
    const mockData = readMockFile('get-base-nearby.json');
    const { parseBaseRow } = require('../src/bigquery/row-parsers/bq-base-row.parser');
    mockBigQueryService.getBaseNearby.mockResolvedValue(paginated(mockData.map(parseBaseRow)));

    const response = await request(app.getHttpServer())
      .get('/base?lat=40.7128&lng=-74.0060')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('base-1');
  });

  it('/buildings (GET)', async () => {
    const mockData = [readMockFile('get-buildings-nearby.json')];
    const { parseBuildingRow } = require('../src/bigquery/row-parsers/bq-building-row.parser');
    mockBigQueryService.getBuildingsNearby.mockResolvedValue(paginated(mockData.map(parseBuildingRow)));

    const response = await request(app.getHttpServer())
      .get('/buildings?lat=-33.8915&lng=151.276')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('08bbe0e373042fff0200498cd0c29719');
  });

  it('/transportation (GET)', async () => {
    const mockData = readMockFile('get-transportation-nearby.json');
    const { parseTransportationRow } = require('../src/bigquery/row-parsers/bq-transportation-row.parser');
    mockBigQueryService.getTransportationNearby.mockResolvedValue(paginated(mockData.map(parseTransportationRow)));

    const response = await request(app.getHttpServer())
      .get('/transportation?lat=40.7128&lng=-74.0060')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('transportation-1');
  });

  it('/divisions (GET)', async () => {
    const mockData = readMockFile('get-divisions-nearby.json');
    const { parseDivisionRow } = require('../src/bigquery/row-parsers/bq-division-row.parser');
    mockBigQueryService.getDivisions.mockResolvedValue(paginated(mockData.map(parseDivisionRow)));

    const response = await request(app.getHttpServer())
      .get('/divisions?lat=40.7128&lng=-74.0060')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('division-1');
    // Fields guaranteed for admin-area consumers
    expect(response.body[0].bbox).toEqual({ xmin: -122.4195, xmax: -122.4193, ymin: 37.7749, ymax: 37.7751 });
    expect(response.body[0].properties.primary_name).toBe('San Francisco County');
    expect(response.body[0].properties.names.common.en).toBe('San Francisco');
    expect(response.body[0].properties.country).toBe('US');
    expect(response.body[0].properties.region).toBe('US-CA');
    // lat/lng radius queries keep returning geometry (backward compatible)
    expect(response.body[0].geometry.type).toBe('Polygon');
    expect(mockBigQueryService.getDivisions).toHaveBeenCalledWith(
      expect.objectContaining({ includeGeometry: true }),
    );
  });

  it('/divisions (GET) by name, subtype and bbox without lat/lng', async () => {
    const mockData = readMockFile('get-divisions-nearby.json');
    const { parseDivisionRow } = require('../src/bigquery/row-parsers/bq-division-row.parser');
    mockBigQueryService.getDivisions.mockResolvedValue(paginated(mockData.map(parseDivisionRow)));

    const response = await request(app.getHttpServer())
      .get('/divisions?name=san francisco&subtype=county,locality&bbox=-123,37,-122,38')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(mockBigQueryService.getDivisions).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'san francisco',
        subtypes: ['county', 'locality'],
        bbox: [-123, 37, -122, 38],
        // name searches default to metadata-only results
        includeGeometry: false,
      }),
    );
  });

  it('/divisions (GET) rejects a request with no narrowing filter', async () => {
    await request(app.getHttpServer())
      .get('/divisions')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(400);
  });

  it('/divisions/:id (GET)', async () => {
    const mockData = readMockFile('get-divisions-nearby.json');
    const { parseDivisionRow } = require('../src/bigquery/row-parsers/bq-division-row.parser');
    mockBigQueryService.getDivisionById.mockResolvedValue(parseDivisionRow(mockData[0]));

    const response = await request(app.getHttpServer())
      .get('/divisions/division-1')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body.id).toBe('division-1');
    expect(response.body.geometry.type).toBe('Polygon');
    expect(response.body.properties.primary_name).toBe('San Francisco County');
    expect(mockBigQueryService.getDivisionById).toHaveBeenCalledWith('division-1');
  });

  it('/divisions/:id (GET) returns 404 for an unknown id', async () => {
    mockBigQueryService.getDivisionById.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/divisions/does-not-exist')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(404);
  });

});
