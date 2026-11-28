import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  extractExtraColumns,
  getPlaceFields,
  loadPlaceFieldManifest,
  normaliseColumnValue,
  parsePlaceFieldManifest,
  placeFieldSchemas,
  resolvePlaceFields,
  setPlaceFieldManifest,
} from './place-fields';
import { parsePlaceRow } from '../bigquery/row-parsers/bq-place-row.parser';
import { toPlaceDto } from './dto/responses/place-response.dto';
import { addPlaceFields } from '../openapi/openapi.document';

const FIXTURE = {
  version: 'test-1',
  fields: [
    {
      name: 'ext_sample_note',
      description: 'A sample note.',
      attribution: 'Sample Source',
      licence: 'CC0-1.0',
      schema: { type: 'string', example: 'hello' },
    },
    { name: 'ext_sample_tags', column: 'ext_sample_tags_raw', encoding: 'json', schema: { type: 'array', items: { type: 'string' } } },
  ],
};

const row = (extra: Record<string, unknown> = {}): any => ({
  id: 'p1',
  geometry: { value: 'POINT(1 2)' },
  bbox: { xmin: '1', xmax: '1', ymin: '2', ymax: '2' },
  version: '1',
  sources: { list: [] },
  names: { primary: 'Sample' },
  taxonomy: { primary: 'cafe' },
  confidence: '0.9',
  ...extra,
});

describe('place fields manifest', () => {
  afterEach(() => setPlaceFieldManifest(null));

  it('serves nothing extra when no manifest is configured', async () => {
    await loadPlaceFieldManifest(undefined);
    expect(getPlaceFields()).toEqual([]);
    const dto = toPlaceDto(parsePlaceRow(row({ ext_sample_note: 'hello' })), {} as any);
    expect(dto.properties).not.toHaveProperty('ext_sample_note');
    expect(dto.properties).not.toHaveProperty('extra_columns');
  });

  it('adds manifest fields to place properties', () => {
    setPlaceFieldManifest(parsePlaceFieldManifest(FIXTURE));
    const dto: any = toPlaceDto(
      parsePlaceRow(row({ ext_sample_note: 'hello', ext_sample_tags_raw: '["a","b"]', ext_unlisted: 'secret' })),
      {} as any,
    );
    expect(dto.properties.ext_sample_note).toBe('hello');
    expect(dto.properties.ext_sample_tags).toEqual(['a', 'b']);
    expect(dto.properties).not.toHaveProperty('ext_unlisted');
    expect(dto.properties).not.toHaveProperty('ext_sample_tags_raw');
    expect(dto.properties).not.toHaveProperty('extra_columns');
  });

  it('omits a field whose column is missing, null or unparseable', () => {
    setPlaceFieldManifest(parsePlaceFieldManifest(FIXTURE));
    const dto: any = toPlaceDto(parsePlaceRow(row({ ext_sample_note: null, ext_sample_tags_raw: 'not json' })), {} as any);
    expect(dto.properties).not.toHaveProperty('ext_sample_note');
    expect(dto.properties).not.toHaveProperty('ext_sample_tags');
  });

  it('honours the includes filter for manifest fields', () => {
    setPlaceFieldManifest(parsePlaceFieldManifest(FIXTURE));
    const dto: any = toPlaceDto(parsePlaceRow(row({ ext_sample_note: 'hello' })), { includes: ['ext_sample_note'] } as any);
    expect(dto.properties.ext_sample_note).toBe('hello');
  });

  it('skips invalid, reserved, duplicate and entitlement-gated entries', () => {
    const manifest = parsePlaceFieldManifest({
      fields: [
        { name: 'sample', schema: { type: 'string' } },
        { name: 'ext_distance', schema: { type: 'number' } },
        { name: 'ext_brand', schema: { type: 'object' } },
        { name: 'ext_no_schema' },
        { name: 'ext_bad_column', column: 'names', schema: { type: 'string' } },
        { name: 'ext_gated', entitlement: 'some-key', schema: { type: 'string' } },
        { name: 'ext_ok', schema: { type: 'string' } },
        { name: 'ext_ok', schema: { type: 'string' } },
      ],
    });
    expect(manifest.fields.map((f) => f.name)).toEqual(['ext_ok']);
    expect(parsePlaceFieldManifest(null).fields).toEqual([]);
    expect(parsePlaceFieldManifest({ fields: 'x' }).fields).toEqual([]);
  });

  it('loads from a local file and survives a missing or broken one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'place-fields-'));
    const good = join(dir, 'manifest.json');
    writeFileSync(good, JSON.stringify(FIXTURE));
    expect((await loadPlaceFieldManifest(good)).fields).toHaveLength(2);
    expect((await loadPlaceFieldManifest(join(dir, 'missing.json'))).fields).toEqual([]);
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{');
    expect((await loadPlaceFieldManifest(broken)).fields).toEqual([]);
  });

  it('normalises BigQuery cell shapes', () => {
    expect(normaliseColumnValue({ list: [{ element: 'a' }, { element: 'b' }] })).toEqual(['a', 'b']);
    expect(normaliseColumnValue({ value: '2026-01-01' })).toBe('2026-01-01');
    expect(normaliseColumnValue({ a: { list: [{ element: 1 }] }, b: null })).toEqual({ a: [1] });
    expect(normaliseColumnValue(null)).toBeUndefined();
    expect(extractExtraColumns({ id: 'x', ext_distance: 5, ext_a: null, ext_b: 1 })).toEqual({ ext_b: 1 });
    expect(extractExtraColumns({ id: 'x' })).toBeUndefined();
    expect(resolvePlaceFields(undefined, parsePlaceFieldManifest(FIXTURE).fields)).toEqual({});
  });

  it('describes manifest fields in the OpenAPI document and leaves it alone otherwise', () => {
    const document: any = { components: { schemas: { PlacePropertiesDto: { properties: { ext_name: { type: 'string' } } } } } };
    const before = JSON.stringify(document);
    addPlaceFields(document);
    expect(JSON.stringify(document)).toBe(before);

    setPlaceFieldManifest(parsePlaceFieldManifest(FIXTURE));
    addPlaceFields(document);
    const props = document.components.schemas.PlacePropertiesDto.properties;
    expect(props.ext_sample_note).toEqual({
      type: 'string',
      example: 'hello',
      description: 'A sample note. Source: Sample Source. Licence: CC0-1.0.',
    });
    expect(props.ext_sample_tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(placeFieldSchemas([])).toEqual({});
  });
});
