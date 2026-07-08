/**
 * Detects schema drift in the Overture Maps BigQuery public dataset.
 *
 * The API reads Google's `bigquery-public-data.overture_maps.*` mirror with no
 * pinned Overture release, so upstream schema changes (new/removed/retyped
 * columns) land under us silently on Google's mirroring schedule. This script
 * fetches each table's column metadata (free `tables.get` calls, no query
 * cost) and diffs it against the checked-in snapshot, exiting non-zero on any
 * difference so the scheduled workflow fails loudly.
 *
 * On drift: review the change against docs.overturemaps.org release notes,
 * update the query builders/row parsers if needed, then refresh the snapshot:
 *   npm run etl:check-bq-schema-drift -- --update
 *
 * Requires (locally) GOOGLE_APPLICATION_CREDENTIALS; any project the service
 * account can bill metadata reads to is fine.
 */
import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SNAPSHOT_PATH = join(__dirname, 'bq-schema-snapshot.json');
const SOURCE_PROJECT = 'bigquery-public-data';
const SOURCE_DATASET = 'overture_maps';

// Every table the API queries. Add here when new themes/types are supported.
const TABLES = ['place', 'building', 'address', 'land_use', 'land_cover', 'segment', 'division_area'];

type FieldSnapshot = { name: string; type: string; mode?: string; fields?: FieldSnapshot[] };
type Snapshot = Record<string, FieldSnapshot[]>;

const toFieldSnapshot = (field: any): FieldSnapshot => ({
  name: field.name,
  type: field.type,
  ...(field.mode && field.mode !== 'NULLABLE' ? { mode: field.mode } : {}),
  ...(field.fields ? { fields: field.fields.map(toFieldSnapshot) } : {}),
});

const diffFields = (path: string, before: FieldSnapshot[] = [], after: FieldSnapshot[] = [], out: string[]) => {
  const beforeByName = new Map(before.map((f) => [f.name, f]));
  const afterByName = new Map(after.map((f) => [f.name, f]));
  for (const [name, b] of beforeByName) {
    const a = afterByName.get(name);
    if (!a) {
      out.push(`REMOVED  ${path}${name} (${b.type})`);
      continue;
    }
    if (a.type !== b.type || (a.mode ?? '') !== (b.mode ?? '')) {
      out.push(`CHANGED  ${path}${name}: ${b.type}${b.mode ? ` ${b.mode}` : ''} -> ${a.type}${a.mode ? ` ${a.mode}` : ''}`);
    }
    diffFields(`${path}${name}.`, b.fields, a.fields, out);
  }
  for (const [name, a] of afterByName) {
    if (!beforeByName.has(name)) out.push(`ADDED    ${path}${name} (${a.type})`);
  }
};

async function main() {
  const update = process.argv.includes('--update');
  const bigquery = new BigQuery();

  const current: Snapshot = {};
  for (const table of TABLES) {
    const [metadata] = await bigquery
      .dataset(SOURCE_DATASET, { projectId: SOURCE_PROJECT })
      .table(table)
      .getMetadata();
    current[table] = metadata.schema.fields.map(toFieldSnapshot);
    console.log(`Fetched ${table}: ${current[table].length} top-level columns (last modified ${new Date(+metadata.lastModifiedTime).toISOString().slice(0, 10)})`);
  }

  if (update) {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n');
    console.log(`Snapshot written to ${SNAPSHOT_PATH}`);
    return;
  }

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch {
    console.error(`No snapshot at ${SNAPSHOT_PATH}. Create one with: npm run etl:check-bq-schema-drift -- --update`);
    process.exit(1);
  }

  const drift: string[] = [];
  for (const table of TABLES) {
    diffFields(`${table}.`, snapshot[table], current[table], drift);
  }

  if (drift.length > 0) {
    console.error('\nSchema drift detected in bigquery-public-data.overture_maps:\n');
    for (const line of drift) console.error(`  ${line}`);
    console.error('\nCheck https://docs.overturemaps.org/blog/ for the release notes, update query builders/row parsers if needed, then refresh the snapshot with --update.');
    process.exit(1);
  }
  console.log('No schema drift detected.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
