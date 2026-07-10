/**
 * Builds the Wikidata brand-enrichment artifact and uploads it to GCS.
 *
 * Extracts every distinct `brand.wikidata` QID from Overture places (~3k),
 * resolves each against Wikidata via batched SPARQL (label, logo, website,
 * industry, parent org — all CC0), applies sanity gates, and writes gzipped
 * NDJSON that the API's BrandsEnrichmentService loads into memory at startup.
 *
 * Run monthly (or via the brands-enrichment workflow):
 *   npm run etl:brands-enrichment
 *
 * Requires .env: BIGQUERY_PROJECT_ID, GCS_BUCKET_NAME and (locally)
 * GOOGLE_APPLICATION_CREDENTIALS. Override the object path with
 * BRANDS_ENRICHMENT_OBJECT (default: enrichment/brands-v1.ndjson.gz).
 */
import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { gzipSync } from 'zlib';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const OBJECT_NAME = process.env.BRANDS_ENRICHMENT_OBJECT || 'enrichment/brands-v1.ndjson.gz';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'OvertureMapsAPI-brand-enrichment/1.0 (https://overturemapsapi.com; aden@thatapicompany.com)';
const BATCH_SIZE = 150;
// Abort (keeping the previous artifact) if Wikidata resolves suspiciously few
// entities — protects against partial outages producing a hollow artifact.
const MIN_RESOLVED_RATIO = 0.9;

const QID_QUERY = `
SELECT brand.wikidata AS qid
FROM \`bigquery-public-data.overture_maps.place\`
WHERE brand.wikidata IS NOT NULL AND REGEXP_CONTAINS(brand.wikidata, '^Q[0-9]+$')
GROUP BY 1`;

interface BrandRow {
  qid: string;
  label?: string;
  logo_url?: string;
  website?: string;
  industry?: string;
  parent?: string;
}

const sparqlBatch = async (qids: string[]): Promise<BrandRow[]> => {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const query = `SELECT ?qid (SAMPLE(?labelS) AS ?label) (SAMPLE(?logoS) AS ?logo) (SAMPLE(?webS) AS ?website)
 (SAMPLE(?indS) AS ?industry) (SAMPLE(?parentS) AS ?parent) WHERE {
 VALUES ?qid { ${values} }
 OPTIONAL { ?qid rdfs:label ?labelS FILTER(LANG(?labelS)="en") }
 OPTIONAL { ?qid wdt:P154 ?logoS }
 OPTIONAL { ?qid wdt:P856 ?webS }
 OPTIONAL { ?qid wdt:P452 ?i. ?i rdfs:label ?indS FILTER(LANG(?indS)="en") }
 OPTIONAL { ?qid wdt:P749 ?p. ?p rdfs:label ?parentS FILTER(LANG(?parentS)="en") }
} GROUP BY ?qid`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
      body: 'query=' + encodeURIComponent(query),
    });
    if (res.ok) {
      const data: any = await res.json();
      return data.results.bindings.map((b: any) => ({
        qid: b.qid.value.split('/').pop(),
        label: b.label?.value,
        logo_url: b.logo?.value,
        website: b.website?.value,
        industry: b.industry?.value,
        parent: b.parent?.value,
      }));
    }
    console.warn(`SPARQL batch failed (HTTP ${res.status}), attempt ${attempt}/3`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error('SPARQL batch failed after 3 attempts');
};

// Wikidata is world-editable: only accept values in expected shapes so a
// vandalised statement can't inject arbitrary URLs into API responses.
const sanitise = (row: BrandRow): BrandRow => ({
  qid: row.qid,
  label: row.label,
  logo_url: row.logo_url && /^https?:\/\/commons\.wikimedia\.org\//.test(row.logo_url) ? row.logo_url : undefined,
  website: row.website && /^https?:\/\//.test(row.website) && row.website.length < 500 ? row.website : undefined,
  industry: row.industry && row.industry.length < 200 ? row.industry : undefined,
  parent: row.parent && row.parent.length < 200 ? row.parent : undefined,
});

async function main() {
  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!projectId || !bucketName) {
    throw new Error('BIGQUERY_PROJECT_ID and GCS_BUCKET_NAME must be set');
  }

  const bigquery = new BigQuery({ projectId });
  console.log('Extracting distinct brand QIDs from Overture places...');
  const [qidRows] = await bigquery.query({ query: QID_QUERY, location: 'US' });
  const qids: string[] = qidRows.map((r: any) => r.qid);
  console.log(`Found ${qids.length} distinct QIDs. Resolving via Wikidata SPARQL...`);

  const resolved: BrandRow[] = [];
  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const rows = await sparqlBatch(qids.slice(i, i + BATCH_SIZE));
    resolved.push(...rows.map(sanitise));
    console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(qids.length / BATCH_SIZE)} (${resolved.length} entities)`);
    await new Promise((r) => setTimeout(r, 300));
  }

  if (resolved.length < qids.length * MIN_RESOLVED_RATIO) {
    throw new Error(`Only ${resolved.length}/${qids.length} QIDs resolved — aborting without uploading (previous artifact stays live)`);
  }

  const stats = (k: keyof BrandRow) => `${((100 * resolved.filter((r) => r[k]).length) / resolved.length).toFixed(1)}%`;
  console.log(`Resolved ${resolved.length}/${qids.length}. Fill rates: label ${stats('label')}, logo ${stats('logo_url')}, website ${stats('website')}, industry ${stats('industry')}, parent ${stats('parent')}`);

  const generatedAt = new Date().toISOString();
  const ndjson = resolved.map((r) => JSON.stringify({ ...r, updated_at: generatedAt })).join('\n');
  const compressed = gzipSync(Buffer.from(ndjson, 'utf8'), { level: 9 });

  const localPath = join(tmpdir(), 'brands-enrichment.ndjson.gz');
  writeFileSync(localPath, compressed);
  console.log(`Artifact: ${(compressed.length / 1024).toFixed(0)} KB gzipped (saved to ${localPath}). Uploading to gs://${bucketName}/${OBJECT_NAME} ...`);

  const storage = new Storage({ projectId });
  try {
    // Keep a dated snapshot alongside the live object so a bad month can be rolled back.
    await storage.bucket(bucketName).file(`${OBJECT_NAME}.${generatedAt.slice(0, 10)}`).save(compressed, { contentType: 'application/gzip' });
    await storage.bucket(bucketName).file(OBJECT_NAME).save(compressed, { contentType: 'application/gzip', resumable: false });
  } catch (error: any) {
    console.error(`Upload failed (${error.message ?? error}). Upload the local artifact manually with:`);
    console.error(`  gsutil cp ${localPath} gs://${bucketName}/${OBJECT_NAME}`);
    process.exit(1);
  }
  console.log('Done. The API picks the new artifact up on its next daily refresh check, or on restart.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
