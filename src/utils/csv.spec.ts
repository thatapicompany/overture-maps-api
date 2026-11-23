import { csvField, flattenResult, toCsv } from './csv';

describe('csv output', () => {
  it('gives a place the columns people look for, then the rest', () => {
    const row = flattenResult({
      id: 'p1',
      geometry: { type: 'Point', coordinates: [-0.1, 51.5] },
      properties: {
        id: 'p1',
        names: { primary: 'Shop' },
        categories: { primary: 'grocery_store' },
        addresses: [{ freeform: '1 High St', locality: 'London', postcode: 'N1', country: 'GB' }],
        websites: ['https://example.test'],
        phones: ['+44 20 0000 0000'],
        brand: { names: { primary: 'Brand' }, wikidata: 'Q1' },
        confidence: 0.9,
        sources: [{ dataset: 'x' }],
      },
    });
    expect(row).toMatchObject({
      id: 'p1', name: 'Shop', category: 'grocery_store', latitude: '51.5', longitude: '-0.1',
      address: '1 High St', locality: 'London', postcode: 'N1', country: 'GB',
      website: 'https://example.test', brand: 'Brand', brand_wikidata: 'Q1',
      confidence: '0.9', sources: '[{"dataset":"x"}]',
    });
    expect(row.names).toBeUndefined();
  });

  it('keeps a shape as GeoJSON in the last column', () => {
    const csv = toCsv([{ id: 'b1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: 'b1', subtype: 'commercial', height: 12 } }]);
    const [header, line] = csv.slice(1).split('\r\n');
    expect(header).toBe('id,subtype,height,geometry');
    expect(line.startsWith('b1,commercial,12,"{""type"":""Polygon""')).toBe(true);
  });

  it('uses one set of columns for rows with different fields', () => {
    const csv = toCsv([
      { geometry: null, properties: { id: '1', class: 'road' } },
      { geometry: null, properties: { id: '2', surface: 'paved' } },
    ]);
    expect(csv.slice(1).split('\r\n').slice(0, 3)).toEqual(['id,class,surface', '1,road,', '2,,paved']);
  });

  it('returns only a header line for no results', () => {
    expect(toCsv([])).toBe('﻿\r\n');
  });

  it('stops a spreadsheet running a value as a formula, without touching numbers', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+44 20')).toBe("'+44 20");
    expect(csvField('-0.1278')).toBe('-0.1278');
    expect(csvField('@handle')).toBe("'@handle");
    expect(csvField('plain')).toBe('plain');
  });
});
