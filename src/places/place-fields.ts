import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';

/**
 * Optional extra place fields, declared in a manifest that lives outside this
 * repository. A deployment whose place table carries additional `ext_`
 * columns lists them in a JSON manifest; the API then returns them on each
 * place and describes them in the OpenAPI document.
 *
 * With no manifest configured (the default) nothing here does anything.
 *
 *   PLACE_FIELDS_MANIFEST=gs://my-bucket/place-fields.json
 *   PLACE_FIELDS_MANIFEST=./place-fields.json
 *
 * Manifest shape:
 *
 *   {
 *     "version": "2026-01-01",
 *     "fields": [
 *       {
 *         "name": "ext_example",
 *         "column": "ext_example",
 *         "encoding": "json",
 *         "description": "What the field holds.",
 *         "attribution": "Who to credit.",
 *         "licence": "CC0-1.0",
 *         "schema": { "type": "string" }
 *       }
 *     ]
 *   }
 *
 * `column` defaults to `name`. `encoding: "json"` parses a STRING column that
 * holds JSON. An entry with an `entitlement` is reserved for per-account
 * access and is not served yet.
 *
 * The manifest is read once at start-up, so the responses and the OpenAPI
 * document of a running instance always agree. Deploy a new revision to pick
 * up a changed manifest.
 */

export interface PlaceFieldDefinition {
  name: string;
  column: string;
  encoding?: 'json';
  description?: string;
  attribution?: string;
  licence?: string;
  schema: Record<string, unknown>;
}

export interface PlaceFieldManifest {
  version: string;
  fields: PlaceFieldDefinition[];
}

/** Prefix that marks a place-table column as a candidate extra field. */
export const EXTRA_COLUMN_PREFIX = 'ext_';

// Names the API already produces itself; a manifest cannot redefine them.
const RESERVED_NAMES = new Set(['ext_distance', 'ext_name', 'ext_building', 'ext_brand', 'ext_place_geometry']);
const NAME_PATTERN = /^ext_[a-z][a-z0-9_]{0,62}$/;

const EMPTY: PlaceFieldManifest = { version: '', fields: [] };
const logger = new Logger('PlaceFields');

let active: PlaceFieldManifest = EMPTY;

export function getPlaceFields(): PlaceFieldDefinition[] {
  return active.fields;
}

export function getPlaceFieldManifest(): PlaceFieldManifest {
  return active;
}

/** Replaces the active manifest. Exposed for tests and for the loader. */
export function setPlaceFieldManifest(manifest: PlaceFieldManifest | null): void {
  active = manifest ?? EMPTY;
}

/**
 * Validates raw manifest JSON. Bad entries are skipped with a warning; a
 * manifest that is not an object yields no fields. Never throws.
 */
export function parsePlaceFieldManifest(raw: unknown): PlaceFieldManifest {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).fields)) {
    logger.warn('Place fields manifest ignored: expected an object with a "fields" array.');
    return EMPTY;
  }
  const seen = new Set<string>();
  const fields: PlaceFieldDefinition[] = [];
  for (const entry of (raw as any).fields as any[]) {
    const name = entry?.name;
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || RESERVED_NAMES.has(name)) {
      logger.warn(`Place field skipped: invalid or reserved name ${JSON.stringify(name)}.`);
      continue;
    }
    if (seen.has(name)) {
      logger.warn(`Place field skipped: duplicate name ${name}.`);
      continue;
    }
    const column = entry.column ?? name;
    if (typeof column !== 'string' || !NAME_PATTERN.test(column) || RESERVED_NAMES.has(column)) {
      logger.warn(`Place field ${name} skipped: column must be an ${EXTRA_COLUMN_PREFIX} column.`);
      continue;
    }
    if (!entry.schema || typeof entry.schema !== 'object' || Array.isArray(entry.schema)) {
      logger.warn(`Place field ${name} skipped: missing "schema".`);
      continue;
    }
    if (entry.entitlement) {
      // Per-account fields are not served yet, so they must not leak.
      continue;
    }
    seen.add(name);
    fields.push({
      name,
      column,
      encoding: entry.encoding === 'json' ? 'json' : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      attribution: typeof entry.attribution === 'string' ? entry.attribution : undefined,
      licence: typeof entry.licence === 'string' ? entry.licence : undefined,
      schema: entry.schema,
    });
  }
  const version = typeof (raw as any).version === 'string' ? (raw as any).version : '';
  return { version, fields };
}

async function readManifestSource(location: string): Promise<string> {
  const gcs = /^gs:\/\/([^/]+)\/(.+)$/.exec(location);
  if (!gcs) return readFileSync(location, 'utf8');
  // Imported lazily so a local-file manifest (spec export, tests) never needs
  // cloud credentials.
  const { Storage } = await import('@google-cloud/storage');
  const config: any = { projectId: process.env.BIGQUERY_PROJECT_ID };
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) config.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const [content] = await new Storage(config).bucket(gcs[1]).file(gcs[2]).download();
  return content.toString('utf8');
}

/**
 * Loads the manifest named by PLACE_FIELDS_MANIFEST, if any. A missing,
 * unreadable or slow manifest leaves the API serving its standard fields: it
 * must never stop the service starting.
 */
export async function loadPlaceFieldManifest(
  location: string | undefined = process.env.PLACE_FIELDS_MANIFEST,
  timeoutMs = parseInt(process.env.PLACE_FIELDS_MANIFEST_TIMEOUT_MS || '5000', 10),
): Promise<PlaceFieldManifest> {
  if (!location) {
    setPlaceFieldManifest(null);
    return active;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const text = await Promise.race([readManifestSource(location), timeout]);
    setPlaceFieldManifest(parsePlaceFieldManifest(JSON.parse(text)));
    logger.log(`Place fields manifest loaded: ${active.fields.length} field(s), version ${active.version || 'unset'}.`);
  } catch (error: any) {
    logger.warn(`Place fields manifest not loaded (${error.message}); serving standard fields only.`);
    setPlaceFieldManifest(null);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return active;
}

/**
 * Turns a BigQuery cell into plain JSON: unwraps Parquet-style repeated
 * fields ({ list: [{ element }] }) and the client's wrapper objects for
 * dates, timestamps and big numbers ({ value }).
 */
export function normaliseColumnValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => normaliseColumnValue(v) ?? null);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === 'list' && Array.isArray(record.list)) {
    return record.list.map((item: any) => normaliseColumnValue(item && typeof item === 'object' && 'element' in item ? item.element : item) ?? null);
  }
  if (keys.length === 1 && keys[0] === 'value' && typeof record.value !== 'object') return record.value;
  if (typeof (record as any).toFixed === 'function' && typeof (record as any).toString === 'function') return value.toString();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = normaliseColumnValue(record[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Collects every non-null `ext_` column of a place row, keyed by column name.
 * Kept independent of the manifest so cached query results stay valid when
 * the manifest changes; the manifest decides what is returned at response
 * time.
 */
export function extractExtraColumns(row: Record<string, unknown>): Record<string, unknown> | undefined {
  let extra: Record<string, unknown> | undefined;
  for (const key of Object.keys(row)) {
    if (!key.startsWith(EXTRA_COLUMN_PREFIX) || RESERVED_NAMES.has(key)) continue;
    const value = normaliseColumnValue(row[key]);
    if (value === undefined) continue;
    (extra ??= {})[key] = value;
  }
  return extra;
}

/**
 * The manifest-declared fields present on a place, ready to merge into its
 * properties. Columns the manifest does not list are never returned.
 */
export function resolvePlaceFields(
  extra: Record<string, unknown> | undefined,
  fields: PlaceFieldDefinition[] = active.fields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!extra || !fields.length) return out;
  for (const field of fields) {
    let value = extra[field.column];
    if (value === undefined || value === null) continue;
    if (field.encoding === 'json' && typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
      if (value === null) continue;
    }
    out[field.name] = value;
  }
  return out;
}

/** OpenAPI property schemas for the active fields, keyed by field name. */
export function placeFieldSchemas(fields: PlaceFieldDefinition[] = active.fields): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const field of fields) {
    const credit = [field.attribution && `Source: ${field.attribution}`, field.licence && `Licence: ${field.licence}`]
      .filter(Boolean)
      .join('. ');
    const description = [field.description ?? (field.schema.description as string | undefined), credit && `${credit}.`]
      .filter(Boolean)
      .join(' ');
    out[field.name] = { ...field.schema, ...(description ? { description } : {}) };
  }
  return out;
}
