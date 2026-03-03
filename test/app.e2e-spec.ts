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
    getDivisionsNearby: jest.fn(),
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
    mockBigQueryService.getAddressesNearby.mockResolvedValue(mockData.map(parseAddressRow));

    const response = await request(app.getHttpServer())
      .get('/addresses?lat=37.7749&lng=-122.4194')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('address-1');
  });

  it('/base (GET)', async () => {
    const mockData = readMockFile('get-base-nearby.json');
    const { parseBaseRow } = require('../src/bigquery/row-parsers/bq-base-row.parser');
    mockBigQueryService.getBaseNearby.mockResolvedValue(mockData.map(parseBaseRow));

    const response = await request(app.getHttpServer())
      .get('/base?lat=37.7749&lng=-122.4194')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('base-1');
  });

  it('/buildings (GET)', async () => {
    const mockData = [readMockFile('get-buildings-nearby.json')];
    const { parseBuildingRow } = require('../src/bigquery/row-parsers/bq-building-row.parser');
    mockBigQueryService.getBuildingsNearby.mockResolvedValue(mockData.map(parseBuildingRow));

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
    mockBigQueryService.getTransportationNearby.mockResolvedValue(mockData.map(parseTransportationRow));

    const response = await request(app.getHttpServer())
      .get('/transportation?lat=37.7749&lng=-122.4194')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('transportation-1');
  });

  it('/divisions (GET)', async () => {
    const mockData = readMockFile('get-divisions-nearby.json');
    const { parseDivisionRow } = require('../src/bigquery/row-parsers/bq-division-row.parser');
    mockBigQueryService.getDivisionsNearby.mockResolvedValue(mockData.map(parseDivisionRow));

    const response = await request(app.getHttpServer())
      .get('/divisions?lat=37.7749&lng=-122.4194')
      .set('x-api-key', 'DEMO-API-KEY')
      .expect(200);

    expect(response.body).toBeInstanceOf(Array);
    expect(response.body.length).toBe(1);
    expect(response.body[0].id).toBe('division-1');
  });

});
