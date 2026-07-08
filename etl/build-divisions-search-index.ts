/**
 * Builds the divisions search index artifact and uploads it to GCS.
 *
 * Exports the searchable columns (no geometry) of every Overture division_area
 * from BigQuery (~123MB scan) as gzipped NDJSON. The API's
 * DivisionsSearchIndexService loads this at startup and serves name/subtype/
 * bbox/country division searches from memory instead of per-request BigQuery
 * scans.
 *
 * Run after each monthly Overture release (or via Cloud Scheduler):
 *   npm run etl:divisions-search-index
 *
 * Requires .env: BIGQUERY_PROJECT_ID, GCS_BUCKET_NAME and (locally)
 * GOOGLE_APPLICATION_CREDENTIALS. Override the object path with
 * DIVISIONS_SEARCH_INDEX_OBJECT (default: search-indexes/divisions-v1.ndjson.gz).
 */
import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { gzipSync } from 'zlib';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const OBJECT_NAME = process.env.DIVISIONS_SEARCH_INDEX_OBJECT || 'search-indexes/divisions-v1.ndjson.gz';

const QUERY = `
SELECT
  id,
  names.primary AS primary,
  (SELECT kv.value FROM UNNEST(names.common.key_value) AS kv WHERE kv.key = 'en' LIMIT 1) AS en,
  country,
  region,
  subtype,
  class,
  admin_level,
  is_land,
  is_territorial,
  division_id,
  [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax] AS bbox
FROM \`bigquery-public-data.overture_maps.division_area\`
`;

async function main() {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!projectId || !bucketName) {
    throw new Error('BIGQUERY_PROJECT_ID and GCS_BUCKET_NAME must be set');
  }

  const bigquery = new BigQuery({ projectId });
  const storage = new Storage({ projectId });

  console.log('Querying division_area (searchable columns only)...');
  const lines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    bigquery.createQueryStream({ query: QUERY, useLegacySql: false })
      .on('data', (row: any) => {
        // Strip null/undefined fields to keep the artifact small.
        const slim: any = { id: row.id };
        if (row.primary) slim.primary = row.primary;
        if (row.en && row.en !== row.primary) slim.en = row.en;
        if (row.country) slim.country = row.country;
        if (row.region) slim.region = row.region;
        if (row.subtype) slim.subtype = row.subtype;
        if (row.class) slim.class = row.class;
        if (row.admin_level !== null && row.admin_level !== undefined) slim.admin_level = row.admin_level;
        if (row.is_land !== null && row.is_land !== undefined) slim.is_land = row.is_land;
        if (row.is_territorial !== null && row.is_territorial !== undefined) slim.is_territorial = row.is_territorial;
        if (row.division_id) slim.division_id = row.division_id;
        if (row.bbox && row.bbox[0] !== null) slim.bbox = row.bbox;
        lines.push(JSON.stringify(slim));
        if (lines.length % 100000 === 0) console.log(`  ${lines.length} rows...`);
      })
      .on('error', reject)
      .on('end', resolve);
  });
  console.log(`Fetched ${lines.length} rows. Compressing...`);

  const compressed = gzipSync(Buffer.from(lines.join('\n'), 'utf8'), { level: 9 });

  // Always keep a local copy so a failed upload (e.g. missing
  // storage.objects.create on the bucket) doesn't waste the BigQuery scan.
  const localPath = join(tmpdir(), 'divisions-search-index.ndjson.gz');
  writeFileSync(localPath, compressed);
  console.log(`Artifact size: ${(compressed.length / 1024 / 1024).toFixed(1)} MB gzipped (saved to ${localPath}). Uploading to gs://${bucketName}/${OBJECT_NAME} ...`);

  try {
    await storage.bucket(bucketName).file(OBJECT_NAME).save(compressed, {
      contentType: 'application/gzip',
      resumable: true,
    });
  } catch (error: any) {
    console.error(`Upload failed (${error.message ?? error}). Upload the local artifact manually with:`);
    console.error(`  gsutil cp ${localPath} gs://${bucketName}/${OBJECT_NAME}`);
    process.exit(1);
  }
  console.log('Done. The API picks the new index up on its next daily refresh check, or on restart.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
