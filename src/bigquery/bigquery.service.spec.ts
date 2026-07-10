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
      const params = spy.mock.calls[0][1];
      expect(sql).toContain('EXISTS (SELECT 1 FROM UNNEST(sources) AS s WHERE s.dataset = @source)');
      expect(params.source).toBe('meta');
    });
  });

  // Helper to expose bigQueryClient for testing
  class TestableBigQueryService extends BigQueryService {
    setBigQueryClient(client: any) {
      // @ts-ignore
      this.bigQueryClient = client;
    }
  }

  describe('getDivisionById maritime geometry fallback (OvertureMaps/data#540)', () => {
    const landRowWithoutGeometry = {
      id: 'ru-land-id',
      geometry: null,
      bbox: null,
      version: 1,
      sources: { list: [] },
      subtype: 'country',
      class: 'land',
      admin_level: 0,
      is_land: true,
      is_territorial: false,
      division_id: 'ru-division-id',
      names: { primary: 'Россия' },
      country: 'RU',
    };
    const maritimeSibling = {
      ...landRowWithoutGeometry,
      id: 'ru-maritime-id',
      geometry: { value: 'MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)))' },
      bbox: { xmin: '0', xmax: '1', ymin: '0', ymax: '1' },
      class: 'maritime',
      is_land: false,
      is_territorial: true,
    };

    it('serves the maritime sibling geometry when the land record has NULL geometry', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [landRowWithoutGeometry], statistics: {} })
        .mockResolvedValueOnce({ rows: [maritimeSibling], statistics: {} });

      const result = await service.getDivisionById('ru-land-id');

      expect(service.runQuery).toHaveBeenCalledTimes(2);
      expect((service.runQuery as jest.Mock).mock.calls[1][1]).toEqual({ division_id: 'ru-division-id', id: 'ru-land-id' });
      expect(result?.geometry).toBeDefined();
      expect(result?.ext_geometry_source).toBe('maritime');
      // Identity fields stay from the requested record
      expect(result?.id).toBe('ru-land-id');
      expect(result?.class).toBe('land');
      expect(result?.bbox).toBeDefined();
    });

    it('does not run the fallback when geometry is present', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValueOnce({ rows: [maritimeSibling], statistics: {} });

      const result = await service.getDivisionById('ru-maritime-id');

      expect(service.runQuery).toHaveBeenCalledTimes(1);
      expect(result?.ext_geometry_source).toBeUndefined();
    });

    it('returns the record unflagged when no sibling with geometry exists', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [landRowWithoutGeometry], statistics: {} })
        .mockResolvedValueOnce({ rows: [], statistics: {} });

      const result = await service.getDivisionById('ru-land-id');

      expect(result?.geometry).toBeUndefined();
      expect(result?.ext_geometry_source).toBeUndefined();
    });
  });

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
