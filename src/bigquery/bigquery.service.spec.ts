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
      expect(result.results[0].id).toBe('1');
      expect(result.totalCount).toBe(1);
    });

    it('adds OFFSET and a deterministic id tiebreaker when paginating', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [{ ...validRow, total_count: 42 }], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      const result = await service.getPlacesNearby(10, 20, 500, undefined, undefined, undefined, undefined, undefined, 10, undefined, undefined, undefined, 2);
      const sql = spy.mock.calls[0][0];
      const params = spy.mock.calls[0][1];
      expect(sql).toContain('COUNT(*) OVER() AS total_count');
      expect(sql).toContain('ORDER BY ext_distance, id');
      expect(sql).toContain('OFFSET @offset');
      expect(params.offset).toBe(20);
      expect(result.totalCount).toBe(42);
    });

    it('does not add OFFSET on page 0, but ordering is always deterministic', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, undefined, undefined, undefined, 10);
      const sql = spy.mock.calls[0][0];
      // Deterministic ordering on every page (incl. 0) is what makes pages
      // stable and disjoint regardless of which page a client requests first.
      expect(sql).toContain('ORDER BY ext_distance, id');
      expect(sql).not.toContain('OFFSET');
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

    it('filters to places with a website when has_contact=[website]', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, 'GB', undefined, 0.5, 5, undefined, undefined, undefined, 0, ['website']);
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('(ARRAY_LENGTH(websites.list) > 0)');
    });

    it('uses OR semantics across multiple has_contact fields', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, 'GB', undefined, 0.5, 5, undefined, undefined, undefined, 0, ['website', 'social']);
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('(ARRAY_LENGTH(websites.list) > 0 OR ARRAY_LENGTH(socials.list) > 0)');
    });

    it('adds no contact clause when has_contact is empty or omitted', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, 'GB', undefined, 0.5, 5, undefined, undefined, undefined, 0, []);
      expect(spy.mock.calls[0][0]).not.toContain('ARRAY_LENGTH');
    });

    it('adds a case-insensitive name clause against names.primary and names.common when name is provided', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, undefined, undefined, undefined, 5, undefined, undefined, undefined, 0, undefined, 'Central Park');
      const sql = spy.mock.calls[0][0];
      const params = spy.mock.calls[0][1];
      // names.common is a MAP (STRUCT<key_value ARRAY<STRUCT<key,value>>>), not the
      // {list:[{element}]} shape used by other repeated fields — must unnest .key_value.
      expect(sql).toContain('LOWER(names.primary) = LOWER(@name)');
      expect(sql).toContain('UNNEST(names.common.key_value)');
      expect(sql).toContain('LOWER(common_name.value) = LOWER(@name)');
      expect(params.name).toBe('Central Park');
    });

    it('adds no name clause when name is omitted', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, 'US', ['food'], 0.5, 5);
      expect(spy.mock.calls[0][0]).not.toContain('names.primary');
      expect(spy.mock.calls[0][1].name).toBeUndefined();
    });

    it('adds a prefix clause for name_prefix: start of the name or of any word, lowercased, nearest first', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(51.5074, -0.1278, 5000, undefined, undefined, undefined, undefined, undefined, 5, undefined, undefined, undefined, 0, undefined, undefined, '  The   Example ');
      const sql = spy.mock.calls[0][0];
      const params = spy.mock.calls[0][1];
      expect(sql).toContain("STARTS_WITH(LOWER(names.primary), @name_prefix)");
      expect(sql).toContain("STRPOS(LOWER(names.primary), CONCAT(' ', @name_prefix)) > 0");
      expect(sql).toContain('ORDER BY ext_distance, id');
      expect(params.name_prefix).toBe('the example');
      // The prefix is a parameter, never spliced into the SQL.
      expect(sql).not.toContain('the example');
    });

    it('adds no prefix clause when name_prefix is omitted', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, undefined, undefined, undefined, undefined, 5);
      expect(spy.mock.calls[0][0]).not.toContain('@name_prefix');
      expect(spy.mock.calls[0][1].name_prefix).toBeUndefined();
    });

    it('combines the name filter with other filters (radius + brand_name + name)', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(10, 20, 500, undefined, 'Starbucks', undefined, undefined, undefined, 5, undefined, undefined, undefined, 0, undefined, 'Starbucks Reserve');
      const sql = spy.mock.calls[0][0];
      const params = spy.mock.calls[0][1];
      expect(sql).toContain('ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)');
      expect(sql).toContain('brand.names.primary = @brand_name');
      expect(sql).toContain('LOWER(names.primary) = LOWER(@name)');
      expect(params.brand_name).toBe('Starbucks');
      expect(params.name).toBe('Starbucks Reserve');
    });
  });

  describe('getPlacesWithNearestBuilding / getBuildingsNearby (BUILDING_TABLE)', () => {
    const validRow = {
      id: '1',
      geometry: { value: 'POINT(20 10)' },
      bbox: { xmin: '0', xmax: '1', ymin: '0', ymax: '1' },
      version: 'v1',
      sources: { list: [] },
      names: {},
      categories: {},
      confidence: 1,
      addresses: [],
      building_id: 'b1',
      building_geometry: { value: 'POLYGON((0 0,1 0,1 1,0 1,0 0))' },
      distance_to_nearest_building: 0,
    };

    it('queries the default public building table when BUILDING_TABLE is unset (match_nearest_building=true)', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesWithNearestBuilding(10, 20, 500, undefined, undefined, undefined, undefined, undefined, 5, true);
      const sql = spy.mock.calls[0][0];
      // Both the buildings CTE and the place-side JOIN should reference the
      // same BUILDING_TABLE-derived name; falls back to the public dataset
      // table when the env var isn't set (as in this test process).
      expect(sql).toContain('bigquery-public-data.overture_maps.building');
    });

    it('queries the default public building table when BUILDING_TABLE is unset (match_nearest_building=false)', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesWithNearestBuilding(10, 20, 500, undefined, undefined, undefined, undefined, undefined, 5, false);
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('bigquery-public-data.overture_maps.building');
    });

    it('getBuildingsNearby queries the default public building table when BUILDING_TABLE is unset', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getBuildingsNearby(10, 20, 500, 5);
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('bigquery-public-data.overture_maps.building');
    });
  });

  // Helper to expose bigQueryClient for testing
  class TestableBigQueryService extends BigQueryService {
    setBigQueryClient(client: any) {
      // @ts-ignore
      this.bigQueryClient = client;
    }
  }

  describe('building queries name their grid cells (BUILDING_GRID_TABLE)', () => {
    const prev = process.env.BUILDING_GRID_TABLE;
    afterEach(() => {
      if (prev === undefined) delete process.env.BUILDING_GRID_TABLE; else process.env.BUILDING_GRID_TABLE = prev;
    });
    const stub = () => {
      const service = new BigQueryService();
      service.getPlaceColumns = jest.fn().mockResolvedValue(new Set([]));
      service.runQuery = jest.fn().mockResolvedValue({ rows: [], statistics: {} });
      return service;
    };
    const call = (service: BigQueryService) => (service.runQuery as jest.Mock).mock.calls[0] as [string, any];

    it('reads the grid table and the cells the circle touches', async () => {
      process.env.BUILDING_GRID_TABLE = 'proj.overture.building_by_cell';
      const service = stub();
      await service.getBuildingsNearby(40.7484, -73.9857, 200, 10);
      const [sql, params] = call(service);
      expect(sql).toContain('`proj.overture.building_by_cell` AS s');
      expect(sql).toContain('WHERE cell IN UNNEST(@building_cells) AND ST_WITHIN(s.geometry');
      expect(params.building_cells).toEqual([43 * 120 + 35]);
    });

    it('does the same for the nearest-building join, and reaches further for buildings that contain a place', async () => {
      process.env.BUILDING_GRID_TABLE = 'proj.overture.building_by_cell';
      const nearest = stub();
      await nearest.getPlacesWithNearestBuilding(40.5, -74.999, 50, undefined, undefined, undefined, undefined, undefined, 10, true);
      const [nearestSql, nearestParams] = call(nearest);
      expect(nearestSql).toContain('`proj.overture.building_by_cell`');
      expect(nearestSql).toContain('cell IN UNNEST(@building_cells) AND ST_WITHIN(geometry');
      expect(nearestParams.building_cells).toEqual([43 * 120 + 34, 43 * 120 + 35]);

      const containing = stub();
      // 4 km from the cell edge: outside a 50 m circle, inside the wider reach.
      await containing.getPlacesWithNearestBuilding(40.5, -74.953, 50, undefined, undefined, undefined, undefined, undefined, 10, false);
      const [containingSql, containingParams] = call(containing);
      expect(containingSql).toContain('`proj.overture.building_by_cell` AS b');
      expect(containingSql).toContain('b.cell IN UNNEST(@building_cells) AND ST_WITHIN(p.geometry');
      expect(containingParams.building_cells).toEqual([43 * 120 + 34, 43 * 120 + 35]);
    });

    it('reads the plain mirror when the grid table is not set, and the grid table without a cell list when the area is too wide', async () => {
      delete process.env.BUILDING_GRID_TABLE;
      const plain = stub();
      await plain.getBuildingsNearby(40.7484, -73.9857, 200, 10);
      expect(call(plain)[0]).not.toContain('building_cells');
      expect(call(plain)[1].building_cells).toBeUndefined();

      process.env.BUILDING_GRID_TABLE = 'proj.overture.building_by_cell';
      const wide = stub();
      await wide.getBuildingsNearby(89.9, 10, 20000, 10);
      expect(call(wide)[0]).not.toContain('building_cells');
      expect(call(wide)[0]).toContain('`proj.overture.building_by_cell` AS s');
    });
  });

  describe('getDivisionById reads the id-clustered mirror (DIVISION_AREA_TABLE)', () => {
    // Public division_area is clustered by geometry, so a by-id lookup scanned
    // ~9 GiB. The mirror is clustered by id. Behaviour must be identical for
    // callers: same row, and never a 404 for an id the public table has.
    const row = {
      id: 'div-1', geometry: { value: 'MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)))' },
      bbox: { xmin: '0', xmax: '1', ymin: '0', ymax: '1' }, version: 1, sources: { list: [] },
      subtype: 'county', class: 'land', admin_level: 2, is_land: true, is_territorial: false,
      division_id: 'd-1', names: { primary: 'Somewhere' }, country: 'US',
    };
    const prev = process.env.DIVISION_AREA_TABLE;
    afterEach(() => {
      if (prev === undefined) delete process.env.DIVISION_AREA_TABLE; else process.env.DIVISION_AREA_TABLE = prev;
    });

    it('queries the public table exactly as before when DIVISION_AREA_TABLE is unset', async () => {
      delete process.env.DIVISION_AREA_TABLE;
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [row], statistics: {} });
      const result = await service.getDivisionById('div-1');
      expect(service.runQuery).toHaveBeenCalledTimes(1);
      expect((service.runQuery as jest.Mock).mock.calls[0][0]).toContain('`bigquery-public-data.overture_maps.division_area`');
      expect(result?.id).toBe('div-1');
    });

    it('reads the mirror and does not touch the public table on a hit', async () => {
      process.env.DIVISION_AREA_TABLE = 'proj.overture.division_area';
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [row], statistics: {} });
      const result = await service.getDivisionById('div-1');
      expect(service.runQuery).toHaveBeenCalledTimes(1);
      const sql = (service.runQuery as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('`proj.overture.division_area`');
      expect(sql).toContain('WHERE s.id = @id');
      expect(result?.id).toBe('div-1');
    });

    it('falls back to the public table when the mirror lacks the id, so a lagging mirror never causes a 404', async () => {
      process.env.DIVISION_AREA_TABLE = 'proj.overture.division_area';
      const service = new BigQueryService();
      service.runQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [], statistics: {} })
        .mockResolvedValueOnce({ rows: [row], statistics: {} });
      const result = await service.getDivisionById('div-1');
      const calls = (service.runQuery as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(calls[0]).toContain('`proj.overture.division_area`');
      expect(calls[1]).toContain('`bigquery-public-data.overture_maps.division_area`');
      expect(result?.id).toBe('div-1');
    });

    it('returns null only when neither the mirror nor the public table has the id', async () => {
      process.env.DIVISION_AREA_TABLE = 'proj.overture.division_area';
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [], statistics: {} });
      expect(await service.getDivisionById('nope')).toBeNull();
      expect(service.runQuery).toHaveBeenCalledTimes(2);
    });
  });

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

  describe('getBaseNearby (land_use + land_cover UNION ALL, live 500 on 2026-08-25)', () => {
    const validBaseRow = {
      id: '1',
      geometry: { value: 'POLYGON((0 0, 1 0, 1 1, 0 0))' },
      bbox: { xmin: '0', xmax: '1', ymin: '0', ymax: '1' },
      version: 1,
      sources: {
        list: [
          { element: { property: '', dataset: 'OpenStreetMap', record_id: 'w1', license: 'ODbL-1.0' } },
        ],
      },
      subtype: 'park',
      class: 'park',
    };

    it('rebuilds sources into a fixed shape on both sides of the UNION instead of selecting it verbatim', async () => {
      // Root cause: land_use's sources.list.element has extra fields
      // (provider/resource/version) that land_cover's doesn't. A bare
      // "SELECT ... sources ..." on both sides made the UNION ALL fail with
      // "incompatible types" the moment those two schemas drifted apart -
      // that's what broke /base in prod. Rebuilding sources to only the
      // fields bq-base-row.parser.ts reads makes the union immune to
      // whatever else Overture adds upstream to either table.
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validBaseRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getBaseNearby(10, 20, 500, 5);
      const sql = spy.mock.calls[0][0];

      // Old, broken pattern must not reappear
      expect(sql).not.toMatch(/SELECT id, geometry, bbox, version, sources,/);

      // Both branches of the UNION rebuild sources the same way
      const rebuildOccurrences = sql.match(/STRUCT\(ARRAY\(/g) ?? [];
      expect(rebuildOccurrences.length).toBe(2);
      expect(sql).toContain('FROM UNNEST(sources.list) AS entry');
      expect(sql).toContain('entry.element.property AS property');
      expect(sql).toContain('bigquery-public-data.overture_maps.land_use');
      expect(sql).toContain('bigquery-public-data.overture_maps.land_cover');
    });

    it('parses results end to end with the rebuilt sources shape', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [{ ...validBaseRow, total_count: 1 }], statistics: {} });

      const result = await service.getBaseNearby(10, 20, 500, 5);

      expect(result.totalCount).toBe(1);
      expect(result.results[0].sources[0]).toEqual({
        property: '',
        dataset: 'OpenStreetMap',
        record_id: 'w1',
        license: 'ODbL-1.0',
      });
    });
  });

  describe('country-level routing to PLACE_COUNTRY_TABLE', () => {
    // The geometry mirror cannot prune a country predicate, so a query with
    // no lat/lng must read the country-clustered mirror and use its top-level
    // `country` / `name_lower` columns. With lat/lng it must keep reading the
    // geometry table with the raw-schema predicates, country filter included.
    const validRow = {
      id: '1', geometry: { value: 'POINT(20 10)' }, bbox: { xmin: '0', xmax: '1', ymin: '0', ymax: '1' },
      version: 'v1', sources: { list: [] }, names: {}, categories: {}, confidence: 1, addresses: [],
    };
    const prevPlace = process.env.PLACE_TABLE;
    const prevCountry = process.env.PLACE_COUNTRY_TABLE;
    beforeEach(() => {
      process.env.PLACE_TABLE = 'proj.overture.place';
      process.env.PLACE_COUNTRY_TABLE = 'proj.overture.place_by_country';
    });
    afterEach(() => {
      if (prevPlace === undefined) delete process.env.PLACE_TABLE; else process.env.PLACE_TABLE = prevPlace;
      if (prevCountry === undefined) delete process.env.PLACE_COUNTRY_TABLE; else process.env.PLACE_COUNTRY_TABLE = prevCountry;
    });
    const stub = () => {
      const service = new BigQueryService();
      service.getPlaceColumns = jest.fn().mockResolvedValue(new Set(['categories']));
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      return service;
    };

    it('reads the country mirror with top-level predicates when there is no lat/lng (the 5 Oct 2026 shape)', async () => {
      const service = stub();
      await service.getPlacesNearby(undefined as any, undefined as any, 1000, undefined, undefined, 'GB', undefined, 0.6, 20, undefined, undefined, undefined, 0, undefined, 'The Example Cafe');
      const sql = (service.runQuery as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('FROM `proj.overture.place_by_country`');
      expect(sql).toContain('country = @country');
      expect(sql).not.toContain('addresses.list[OFFSET(0)].element.country');
      expect(sql).toContain('name_lower = LOWER(@name)');
      expect(sql).not.toContain('LOWER(names.primary)');
      expect(sql).toContain('UNNEST(names.common.key_value)');
      expect(sql).not.toContain('ST_DWithin');
    });

    it('keeps the geometry table and raw-schema predicates when lat/lng are present, even with a country filter', async () => {
      const service = stub();
      await service.getPlacesNearby(51.5074, -0.1278, 100, undefined, undefined, 'GB', undefined, undefined, 20, undefined, undefined, undefined, 0, undefined, 'The Example Cafe');
      const sql = (service.runQuery as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('FROM `proj.overture.place`');
      expect(sql).toContain('ST_DWithin(geometry, ST_GeogPoint(@longitude, @latitude), @radius)');
      expect(sql).toContain('addresses.list[OFFSET(0)].element.country = @country');
      expect(sql).toContain('LOWER(names.primary) = LOWER(@name)');
      expect(sql).not.toContain('place_by_country');
      expect(sql).not.toContain('name_lower');
    });

    it('falls back to PLACE_TABLE with raw-schema predicates when PLACE_COUNTRY_TABLE is unset', async () => {
      delete process.env.PLACE_COUNTRY_TABLE;
      const service = stub();
      await service.getPlacesNearby(undefined as any, undefined as any, 1000, undefined, undefined, 'GB', ['restaurant'], undefined, 20);
      const sql = (service.runQuery as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('FROM `proj.overture.place`');
      expect(sql).toContain('addresses.list[OFFSET(0)].element.country = @country');
    });

    describe('narrowing to clustered columns (PLACE_FILTER_INDEX_TABLE, PLACE_BRAND_TABLE)', () => {
      const prevIndex = process.env.PLACE_FILTER_INDEX_TABLE;
      const prevBrand = process.env.PLACE_BRAND_TABLE;
      beforeEach(() => {
        process.env.PLACE_FILTER_INDEX_TABLE = 'proj.overture.place_filter_index';
        process.env.PLACE_BRAND_TABLE = 'proj.overture.place_by_brand';
      });
      afterEach(() => {
        if (prevIndex === undefined) delete process.env.PLACE_FILTER_INDEX_TABLE; else process.env.PLACE_FILTER_INDEX_TABLE = prevIndex;
        if (prevBrand === undefined) delete process.env.PLACE_BRAND_TABLE; else process.env.PLACE_BRAND_TABLE = prevBrand;
      });
      // Answers index lookups from `index`, and everything else with one row.
      const indexed = (index: Record<string, (string | null)[]>, hasCategories = false) => {
        const service = new BigQueryService();
        service.getPlaceColumns = jest.fn().mockResolvedValue(new Set(hasCategories ? ['categories'] : []));
        service.runQuery = jest.fn().mockImplementation(async (sql: string, params: any) => {
          if (sql.includes('Get filter index')) {
            const rows = (params.values as string[]).flatMap((value) => (index[`${params.kind}:${value}`] ?? []).map((narrow) => ({ value, narrow })));
            return { rows, statistics: {} };
          }
          return { rows: [validRow], statistics: {} };
        });
        return service;
      };
      const placesCall = (service: BigQueryService) =>
        (service.runQuery as jest.Mock).mock.calls.find((c) => (c[0] as string).includes('Get places nearby'));
      const country = (service: BigQueryService, o: { brand_wikidata?: string; brand_name?: string; categories?: string[]; taxonomy?: string[]; lat?: number; lng?: number }) =>
        service.getPlacesNearby(o.lat as any, o.lng as any, 1000, o.brand_wikidata, o.brand_name, 'US', o.categories, 0.5, 20, undefined, undefined, o.taxonomy, 0);

      it('narrows a taxonomy filter to the basic categories the values occur in, keeping the filter itself', async () => {
        const service = indexed({ 'taxonomy:squash_court': ['sport_court'], 'taxonomy:kiteboarding': ['sport_or_fitness_facility', 'sport_court'] });
        await country(service, { taxonomy: ['squash_court', 'kiteboarding'] });
        const [sql, params] = placesCall(service)!;
        expect(sql).toContain('FROM `proj.overture.place_by_country`');
        expect(sql).toContain('country = @country AND basic_category IN UNNEST(@narrow_taxonomy_basics) AND');
        expect(sql).toContain('taxonomy.primary IN UNNEST(@taxonomy)');
        expect(params.narrow_taxonomy_basics.sort()).toEqual(['sport_court', 'sport_or_fitness_facility']);
      });

      it('answers with nothing, and no places query, when no place in the country has the taxonomy value', async () => {
        const service = indexed({});
        expect(await country(service, { taxonomy: ['no_such_thing'] })).toEqual({ results: [], totalCount: 0 });
        expect(placesCall(service)).toBeUndefined();
      });

      it('keeps rows with no basic category when the index says the value occurs there too', async () => {
        const service = indexed({ 'taxonomy:odd': ['shop', null], 'taxonomy:odder': [null] });
        await country(service, { taxonomy: ['odd'] });
        expect(placesCall(service)![0]).toContain('(basic_category IN UNNEST(@narrow_taxonomy_basics) OR basic_category IS NULL)');
        const second = indexed({ 'taxonomy:odder': [null] });
        await country(second, { taxonomy: ['odder'] });
        const [sql, params] = placesCall(second)!;
        expect(sql).toContain('country = @country AND basic_category IS NULL AND');
        expect(params.narrow_taxonomy_basics).toBeUndefined();
      });

      it('narrows a categories filter to the values themselves plus where they occur as taxonomy', async () => {
        const service = indexed({ 'taxonomy:sushi_restaurant': ['restaurant'] });
        await country(service, { categories: ['sushi_restaurant', 'museum'] });
        const [sql, params] = placesCall(service)!;
        expect(sql).toContain('basic_category IN UNNEST(@narrow_category_basics)');
        expect(params.narrow_category_basics.sort()).toEqual(['museum', 'restaurant', 'sushi_restaurant']);
      });

      it('does not narrow categories while the table still has the legacy categories column', async () => {
        const service = indexed({ 'taxonomy:museum': ['museum'] }, true);
        await country(service, { categories: ['museum'] });
        expect(placesCall(service)![0]).not.toContain('narrow_category_basics');
      });

      it('reads a brand name from the brand table, by its clustered column', async () => {
        const service = indexed({});
        await country(service, { brand_name: 'Example Coffee' });
        const [sql] = placesCall(service)!;
        expect(sql).toContain('FROM `proj.overture.place_by_brand`');
        expect(sql).toContain('country = @country AND brand_name = @brand_name');
        expect(sql).toContain('brand.names.primary = @brand_name');
      });

      it('turns a Wikidata id into its brand names, and answers with nothing when the country has none', async () => {
        const service = indexed({ 'brand_wikidata:Q1': ['Example Coffee', 'Example Coffee Reserve'] });
        await country(service, { brand_wikidata: 'Q1' });
        const [sql, params] = placesCall(service)!;
        expect(sql).toContain('FROM `proj.overture.place_by_brand`');
        expect(sql).toContain('brand_name IN UNNEST(@narrow_brand_names)');
        expect(sql).toContain('brand.wikidata = @brand_wikidata');
        expect(params.narrow_brand_names).toEqual(['Example Coffee', 'Example Coffee Reserve']);
        const none = indexed({});
        expect(await country(none, { brand_wikidata: 'Q2' })).toEqual({ results: [], totalCount: 0 });
      });

      it('looks a value up once and remembers it', async () => {
        const service = indexed({ 'taxonomy:museum': ['museum'] });
        await country(service, { taxonomy: ['museum'] });
        await country(service, { taxonomy: ['museum'] });
        expect((service.runQuery as jest.Mock).mock.calls.filter((c) => (c[0] as string).includes('Get filter index'))).toHaveLength(1);
      });

      it('runs the query as before when the index cannot be read, or is not configured', async () => {
        const service = indexed({});
        (service.runQuery as jest.Mock).mockImplementation(async (sql: string) => {
          if (sql.includes('Get filter index')) throw new Error('index unavailable');
          return { rows: [validRow], statistics: {} };
        });
        await country(service, { taxonomy: ['museum'] });
        expect(placesCall(service)![0]).not.toContain('narrow_');
        delete process.env.PLACE_FILTER_INDEX_TABLE;
        delete process.env.PLACE_BRAND_TABLE;
        const plain = indexed({});
        await country(plain, { taxonomy: ['museum'], brand_name: 'Example Coffee' });
        const [sql] = placesCall(plain)!;
        expect(sql).toContain('FROM `proj.overture.place_by_country`');
        expect(sql).not.toContain('narrow_');
        expect((plain.runQuery as jest.Mock).mock.calls).toHaveLength(1);
      });

      it('leaves radius queries alone', async () => {
        const service = indexed({ 'taxonomy:museum': ['museum'] });
        await country(service, { taxonomy: ['museum'], brand_name: 'Example Coffee', lat: 1, lng: 2 });
        const [sql] = placesCall(service)!;
        expect(sql).toContain('FROM `proj.overture.place`');
        expect(sql).not.toContain('narrow_');
        expect(sql).not.toContain('brand_name = @brand_name');
      });
    });

    it('routes the brands and categories aggregates the same way', async () => {
      const service = stub();
      await service.getBrandsNearby('AU');
      await service.getCategories('AU');
      await service.getBrandsNearby(undefined, -33.89, 151.28, 1000);
      const calls = (service.runQuery as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(calls[0]).toContain('place_by_country');
      expect(calls[0]).toContain('country = @country');
      expect(calls[1]).toContain('place_by_country');
      expect(calls[1]).toContain('country = @country');
      expect(calls[2]).toContain('FROM `proj.overture.place`');
      expect(calls[2]).not.toContain('place_by_country');
    });

    it('reads place counts by country from the mirror\'s clustered column', async () => {
      const service = stub();
      (service.runQuery as jest.Mock).mockResolvedValue({ rows: [{ country: 'AU', count_places: 1, count_brands: 1 }], statistics: {} });
      await service.getPlaceCountsByCountry();
      const sql = (service.runQuery as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('place_by_country');
      expect(sql).toContain('SELECT country AS country');
    });

    it('uses the pre-lowered name_lower column for name_prefix on the country mirror', async () => {
      const service = new BigQueryService();
      service.runQuery = jest.fn().mockResolvedValue({ rows: [validRow], statistics: {} });
      const spy = jest.spyOn(service, 'runQuery');
      await service.getPlacesNearby(undefined as any, undefined as any, 1000, undefined, undefined, 'GB', undefined, 0.6, 20, undefined, undefined, undefined, 0, undefined, undefined, 'exam');
      const sql = spy.mock.calls[0][0];
      expect(sql).toContain('STARTS_WITH(name_lower, @name_prefix)');
      expect(sql).not.toContain('LOWER(names.primary)');
    });
  });

  describe('getBrandsNearby', () => {
    it('leaves out places with no brand, in SQL and in the mapped rows', async () => {
      const service = new BigQueryService();
      service.getPlaceColumns = jest.fn().mockResolvedValue(new Set(['categories']));
      service.runQuery = jest.fn().mockResolvedValue({
        rows: [
          { brand: null, count_places: 900 },
          { brand: { names: { primary: null }, wikidata: null }, count_places: 40 },
          { brand: { names: { primary: 'Example Coffee' }, wikidata: 'Q1' }, count_places: 12 },
          { brand: { names: { primary: null }, wikidata: 'Q2' }, count_places: 3 },
        ],
        statistics: {},
      });
      const brands = await service.getBrandsNearby(undefined, 51.5138, -0.0984, 1000);
      const sql = (service.runQuery as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('(brand.names.primary IS NOT NULL OR brand.wikidata IS NOT NULL)');
      expect(brands.map((b) => b.wikidata)).toEqual(['Q1', 'Q2']);
    });
  });

  describe('runQuery', () => {
    it('prices bytes billed at US$6.25 per TiB (not the pre-2023 US$5 per decimal TB)', async () => {
      const service = new TestableBigQueryService();
      const job = {
        id: 'job-1',
        getQueryResults: jest.fn().mockResolvedValue([[]]),
        getMetadata: jest.fn().mockResolvedValue([{ statistics: { totalBytesProcessed: String(2 ** 40), query: { totalBytesBilled: String(2 ** 40), statementType: 'SELECT' } } }]),
      };
      service.setBigQueryClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });
      service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
      const { statistics } = await service.runQuery('SELECT 1');
      expect(statistics.costInUSD).toBeCloseTo(6.25, 6);
    });

    it('should throw and log error if query fails', async () => {
      const service = new TestableBigQueryService();
      const error = new Error('Query failed');
      service.setBigQueryClient({ createQueryJob: jest.fn().mockRejectedValue(error) });
      service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
      await expect(service.runQuery('SELECT 1')).rejects.toThrow('Query failed');
    });
  });
});

describe('zero coordinates', () => {
  it('hasCoords treats 0 as a real coordinate', () => {
    const { hasCoords } = require('./bigquery.service');
    expect(hasCoords(0, 0)).toBe(true);
    expect(hasCoords(0, 151.2)).toBe(true);
    expect(hasCoords(undefined, 151.2)).toBe(false);
    expect(hasCoords(NaN, 0)).toBe(false);
    expect(hasCoords(null, 0)).toBe(false);
  });

  it('keeps the spatial filter for a point on the equator', async () => {
    const service = new BigQueryService();
    const spy = jest.fn().mockResolvedValue({ rows: [], statistics: {} });
    service.runQuery = spy;
    await service.getPlacesNearby(0, 10, 2000);
    expect(spy.mock.calls[0][0]).toMatch(/ST_DWithin/i);
  });
});

describe('BigQueryService bytes billed backstop', () => {
  const prev = process.env.BQ_MAX_BYTES_BILLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.BQ_MAX_BYTES_BILLED; else process.env.BQ_MAX_BYTES_BILLED = prev;
  });

  function serviceWith(job: any) {
    const service = new BigQueryService();
    const createQueryJob = jest.fn().mockResolvedValue([job]);
    (service as any).bigQueryClient = { createQueryJob };
    (service as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { service, createQueryJob };
  }

  const okJob = {
    id: 'job-1',
    getQueryResults: jest.fn().mockResolvedValue([[{ a: 1 }]]),
    getMetadata: jest.fn().mockResolvedValue([{ statistics: { totalBytesProcessed: '10', query: { totalBytesBilled: '10' } } }]),
  };

  it('sets no cap by default (BigQuery checks it against an upper-bound estimate)', async () => {
    delete process.env.BQ_MAX_BYTES_BILLED;
    const { service, createQueryJob } = serviceWith(okJob);
    await service.runQuery('SELECT 1');
    expect(createQueryJob.mock.calls[0][0].maximumBytesBilled).toBeUndefined();
  });

  it('applies a cap only when BQ_MAX_BYTES_BILLED is set to a positive number', async () => {
    process.env.BQ_MAX_BYTES_BILLED = '1000';
    let { service, createQueryJob } = serviceWith(okJob);
    await service.runQuery('SELECT 1');
    expect(createQueryJob.mock.calls[0][0].maximumBytesBilled).toBe('1000');

    for (const v of ['0', '-5', 'nonsense']) {
      process.env.BQ_MAX_BYTES_BILLED = v;
      ({ service, createQueryJob } = serviceWith(okJob));
      await service.runQuery('SELECT 1');
      expect(createQueryJob.mock.calls[0][0].maximumBytesBilled).toBeUndefined();
    }
  });

  it('turns a bytesBilledLimitExceeded failure into a 400 with guidance', async () => {
    const failing = {
      id: 'job-2',
      getQueryResults: jest.fn().mockRejectedValue(Object.assign(new Error('Query exceeded limit for bytes billed'), { errors: [{ reason: 'bytesBilledLimitExceeded' }] })),
      getMetadata: jest.fn(),
    };
    const { service } = serviceWith(failing);
    await expect(service.runQuery('SELECT 1')).rejects.toMatchObject({ status: 400 });
  });

  it('warns when a job bills more than the warning threshold', async () => {
    delete process.env.BQ_WARN_BYTES_BILLED;
    const big = 13 * 2 ** 30;
    const job = {
      id: 'job-4',
      getQueryResults: jest.fn().mockResolvedValue([[]]),
      getMetadata: jest.fn().mockResolvedValue([{ statistics: { totalBytesProcessed: String(big), query: { totalBytesBilled: String(big) } } }]),
    };
    const { service } = serviceWith(job);
    await service.runQuery('SELECT 1');
    expect((service as any).logger.warn).toHaveBeenCalledWith(expect.stringMatching(/large job billed 13\.0 GiB/));
    const small = serviceWith(okJob);
    await small.service.runQuery('SELECT 1');
    expect((small.service as any).logger.warn).not.toHaveBeenCalled();
  });

  it('passes other BigQuery errors through unchanged', async () => {
    const failing = { id: 'job-3', getQueryResults: jest.fn().mockRejectedValue(new Error('boom')), getMetadata: jest.fn() };
    const { service } = serviceWith(failing);
    await expect(service.runQuery('SELECT 1')).rejects.toThrow('boom');
  });
});
