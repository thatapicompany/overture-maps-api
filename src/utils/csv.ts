// CSV output for the location endpoints (`format=csv`): one row per result.
// The fields people look for first get columns of their own, in a fixed
// order; every other property follows by name; a shape that is not a point
// goes in a last `geometry` column as GeoJSON.

type Row = Record<string, string>;

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const object = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : undefined);

const LEADING = [
  'id',
  'name',
  'category',
  'latitude',
  'longitude',
  'address',
  'locality',
  'region',
  'postcode',
  'country',
  'website',
  'phone',
  'brand',
  'brand_wikidata',
  'subtype',
  'class',
];

// Properties folded into the leading columns above, so not repeated as JSON.
const FOLDED = new Set(['names', 'categories', 'addresses', 'websites', 'phones', 'brand', 'name']);

export const flattenResult = (item: any): Row => {
  const p: Record<string, any> = object(item?.properties) ?? {};
  const row: Row = {};
  const set = (name: string, value: unknown) => {
    const text = cell(value);
    if (text !== '') row[name] = text;
  };
  set('id', p.id ?? item?.id);
  set('name', object(p.names)?.primary ?? p.name);
  set('category', object(p.categories)?.primary);
  const address = object(first(p.addresses));
  if (address) {
    set('address', address.freeform);
    set('locality', address.locality);
    set('region', address.region);
    set('postcode', address.postcode);
    set('country', address.country);
  }
  set('website', first(p.websites));
  set('phone', first(p.phones));
  const brand = object(p.brand);
  if (brand) {
    set('brand', object(brand.names)?.primary);
    set('brand_wikidata', brand.wikidata);
  }
  const geometry = object(item?.geometry);
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    set('longitude', geometry.coordinates[0]);
    set('latitude', geometry.coordinates[1]);
  } else if (geometry) {
    set('geometry', geometry);
  }
  for (const [key, value] of Object.entries(p)) {
    if (key in row || FOLDED.has(key)) continue;
    set(key, value);
  }
  return row;
};

/**
 * One value as a CSV field. The data comes from open sources, so a value a
 * spreadsheet would run as a formula is prefixed with an apostrophe. Plain
 * numbers, including negative coordinates, are left alone.
 */
export const csvField = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (results: any[] = []): string => {
  const rows = results.map(flattenResult);
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  const columns = [
    ...LEADING.filter((name) => seen.has(name)),
    ...[...seen].filter((name) => !LEADING.includes(name) && name !== 'geometry').sort(),
    ...(seen.has('geometry') ? ['geometry'] : []),
  ];
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((name) => csvField(row[name] ?? '')).join(','));
  // A byte order mark lets spreadsheet programs read names in any script.
  return `﻿${lines.join('\r\n')}\r\n`;
};
