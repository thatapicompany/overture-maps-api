import { Test, TestingModule } from '@nestjs/testing';
import { BigQueryService } from './bigquery.service';
import { Logger } from '@nestjs/common';

describe('BigQueryService', () => {
  let service: BigQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BigQueryService,
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();
    service = module.get<BigQueryService>(BigQueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have getPlacesNearby method', () => {
    expect(typeof service.getPlacesNearby).toBe('function');
  });

  it('should have getBrandsNearby method', () => {
    expect(typeof service.getBrandsNearby).toBe('function');
  });

  it('should have getCategories method', () => {
    expect(typeof service.getCategories).toBe('function');
  });

  it('should have getBuildingsNearby method', () => {
    expect(typeof service.getBuildingsNearby).toBe('function');
  });

  it('should have runQuery method', () => {
    expect(typeof service.runQuery).toBe('function');
  });

  describe('getPlacesNearby', () => {
    const validRow = {
      id: '1',
      geometry: { value: 'POINT(20 10)' },
      bbox: { xmin: '0', xmax: '1', ymin: '0', ymax: '1' },
      version: 'v1',
      sources: {
        list: [
          {
            element: {
              property: '',
              dataset: 'meta',
              record_id: '1',
              update_time: '2024-08-02T00:00:00.000Z',
              confidence: null,
            }
          }
        ]
      },
      names: {},
      categories: {},
      confidence: 1,
      addresses: [],
    };
    it('should call runQuery with correct SQL for basic params', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const result = await service.getPlacesNearby(10, 20, 500, undefined, undefined, 'US', ['food'], 0.5, 5);
      expect(service.runQuery).toHaveBeenCalled();
      expect(result[0].id).toBe('1');
    });

    it('should include source filter in SQL if provided', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, 'US', ['food'], 0.5, 5, 'meta');
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('EXISTS (SELECT 1 FROM UNNEST(sources) AS s WHERE s.dataset = "meta")');
    });
  });

  // Helper to expose bigQueryClient for testing
  class TestableBigQueryService extends BigQueryService {
    setBigQueryClient(client: any) {
      // @ts-ignore
      this.bigQueryClient = client;
    }
  }

  describe('runQuery', () => {
    it('should throw and log error if query fails', async () => {
      const service = new TestableBigQueryService();
      const error = new Error('Query failed');
      service.setBigQueryClient({ createQueryJob: jest.fn().mockRejectedValue(error) });
      service.logger = { log: jest.fn(), error: jest.fn() } as any;
      await expect(service.runQuery('SELECT 1')).rejects.toThrow('Query failed');
    });
  });
});
