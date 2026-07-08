import { parsePlaceRow } from './bq-place-row.parser';

// Minimal BigQuery-shaped place row (Parquet-style list wrapping).
const baseRow = () => ({
  id: 'place-1',
  geometry: { value: 'POINT(-73.9857 40.7484)' },
  bbox: { xmin: '-73.99', xmax: '-73.98', ymin: '40.74', ymax: '40.75' },
  version: 1,
  confidence: '0.9',
  names: { primary: 'Test Place' },
  sources: {
    list: [
      {
        element: {
          property: '',
          dataset: 'meta',
          record_id: 'r1',
          update_time: '2026-04-27T00:00:00.000Z',
          confidence: '0.5',
          license: 'CDLA-Permissive-2.0',
        },
      },
    ],
  },
  categories: {
    primary: 'accountant',
    alternate: { list: [{ element: 'trusts' }, { element: 'professional_services' }] },
  },
  basic_category: 'financial_service',
  taxonomy: {
    primary: 'accountant',
    hierarchy: { list: [{ element: 'services_and_business' }, { element: 'financial_service' }, { element: 'accountant' }] },
    alternates: { list: [{ element: 'financial_service' }] },
  },
  operating_status: 'open',
});

describe('parsePlaceRow', () => {
  it('parses categories, taxonomy, basic_category, operating_status and source license', () => {
    const place = parsePlaceRow(baseRow());

    expect(place.categories).toEqual({ primary: 'accountant', alternate: ['trusts', 'professional_services'] });
    expect(place.basic_category).toBe('financial_service');
    expect(place.taxonomy).toEqual({
      primary: 'accountant',
      hierarchy: ['services_and_business', 'financial_service', 'accountant'],
      alternates: ['financial_service'],
    });
    expect(place.operating_status).toBe('open');
    expect(place.sources[0].license).toBe('CDLA-Permissive-2.0');
    expect(place.theme).toBe('places');
    expect(place.type).toBe('place');
  });

  it('derives categories from taxonomy when the categories column is gone (September 2026 upstream removal)', () => {
    const row = baseRow();
    delete (row as any).categories;

    const place = parsePlaceRow(row);

    expect(place.categories).toEqual({ primary: 'accountant', alternate: ['financial_service'] });
  });

  it('falls back to basic_category when taxonomy.primary is also missing', () => {
    const row = baseRow();
    delete (row as any).categories;
    (row as any).taxonomy = null;

    const place = parsePlaceRow(row);

    expect(place.categories.primary).toBe('financial_service');
    expect(place.categories.alternate).toEqual([]);
  });

  it('handles null taxonomy alternates and null operating_status (pre-signal rows)', () => {
    const row = baseRow();
    (row as any).taxonomy.alternates = null;
    (row as any).operating_status = null;

    const place = parsePlaceRow(row);

    expect(place.taxonomy?.alternates).toEqual([]);
    expect(place.operating_status).toBeUndefined();
  });
});
