import { BigQuery } from '@google-cloud/bigquery';
import { EnrichmentAdapter } from '../data-adapters/EnrichmentAdapter';

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export class BqEnrichmentAdapter implements EnrichmentAdapter {
  private client: BigQuery;
  private project: string;
  private dataset: string;
  private table: string;
  private allowlist: string[];
  private cachedFields?: string[];

  constructor() {
    this.project = process.env.ENRICHMENT_BQ_PROJECT || '';
    this.dataset = process.env.ENRICHMENT_BQ_DATASET || '';
    this.table = process.env.ENRICHMENT_BQ_TABLE || '';
    this.allowlist = (process.env.ENRICHMENT_FIELDS_ALLOWLIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    this.client = new BigQuery({
      projectId: this.project,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }

  async supportedFields(): Promise<string[]> {
    if (this.cachedFields) return this.cachedFields;
    const [metadata] = await this.client
      .dataset(this.dataset)
      .table(this.table)
      .getMetadata();
    let fields = (metadata.schema?.fields || [])
      .map((f: any) => f.name)
      .filter((name: string) => name !== 'id');
    if (this.allowlist.length) {
      fields = fields.filter((f) => this.allowlist.includes(f));
    }
    this.cachedFields = fields;
    return fields;
  }

  async fetchEnrichmentByIds(
    ids: string[],
    options?: { fields?: string[] },
  ): Promise<Record<string, Record<string, unknown>>> {
    if (!ids.length) return {};
    const allowed = await this.supportedFields();
    const requested = options?.fields?.length
      ? options.fields.filter((f) => allowed.includes(f))
      : allowed;
    const projection = requested.length ? requested.join(', ') : '';
    const results: Record<string, Record<string, unknown>> = {};
    for (const batch of chunk(ids, 5000)) {
      const query = `SELECT id${projection ? ', ' + projection : ''} FROM \`${this.project}.${this.dataset}.${this.table}\` WHERE id IN UNNEST(@ids)`;
      const options = { query, params: { ids: batch } } as any;
      const [rows] = await this.client.query(options);
      for (const row of rows as any[]) {
        const { id, ...rest } = row;
        results[id] = rest;
      }
    }
    return results;
  }
}
