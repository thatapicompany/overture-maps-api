import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { UsageRow } from './usage.row';

// BigQuery schema for the immutable usage table. Mirrors UsageRow. Used to
// auto-create the table on startup when it does not yet exist.
const TABLE_SCHEMA = {
  fields: [
    { name: 'request_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'request_ts', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'account_id', type: 'STRING' },
    { name: 'user_id', type: 'STRING' },
    { name: 'is_demo', type: 'BOOL' },
    { name: 'api_key_hash', type: 'STRING' },
    { name: 'method', type: 'STRING' },
    { name: 'route', type: 'STRING' },
    { name: 'path', type: 'STRING' },
    { name: 'query_params', type: 'STRING' },
    { name: 'status_code', type: 'INT64' },
    { name: 'cache_hit', type: 'BOOL' },
    { name: 'response_count', type: 'INT64' },
    { name: 'duration_ms', type: 'INT64' },
    { name: 'bq_job_count', type: 'INT64' },
    { name: 'total_bytes_billed', type: 'INT64' },
    { name: 'cost_usd', type: 'FLOAT64' },
    { name: 'env', type: 'STRING' },
    { name: 'api_version', type: 'STRING' },
    { name: 'error', type: 'STRING' },
    {
      name: 'jobs',
      type: 'RECORD',
      mode: 'REPEATED',
      fields: [
        { name: 'job_id', type: 'STRING' },
        { name: 'bytes_processed', type: 'INT64' },
        { name: 'bytes_billed', type: 'INT64' },
        { name: 'cost_usd', type: 'FLOAT64' },
        { name: 'duration_ms', type: 'INT64' },
        { name: 'statement_type', type: 'STRING' },
      ],
    },
  ],
};

/**
 * Buffers usage rows in memory and flushes them to an append-only BigQuery table
 * via streaming inserts. Writes are best-effort and never block or fail the API
 * request: enqueue() returns immediately, and flush errors are logged, not thrown.
 *
 * Immutability is a property of the write path (insert only, never UPDATE/DELETE)
 * and of IAM on the dataset — see etl/usage-tracking-schema.sql.
 */
@Injectable()
export class UsageSink implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('UsageSink');
  private readonly enabled = process.env.USAGE_TRACKING_ENABLED === 'true';
  private readonly projectId = process.env.USAGE_BQ_PROJECT || process.env.BIGQUERY_PROJECT_ID;
  private readonly datasetId = process.env.USAGE_BQ_DATASET || 'usage';
  private readonly tableId = process.env.USAGE_BQ_TABLE || 'api_requests';
  private readonly flushIntervalMs = parseInt(process.env.USAGE_FLUSH_INTERVAL_MS || '2000', 10);
  private readonly maxBufferRows = parseInt(process.env.USAGE_FLUSH_MAX_ROWS || '500', 10);

  private bigQuery?: BigQuery;
  private buffer: UsageRow[] = [];
  private timer?: NodeJS.Timeout;
  private flushing = false;

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Usage tracking disabled (set USAGE_TRACKING_ENABLED=true to enable)');
      return;
    }

    const config: any = { projectId: this.projectId };
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      config.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    this.bigQuery = new BigQuery(config);

    try {
      await this.ensureTable();
    } catch (err: any) {
      this.logger.error(`Failed to ensure usage table exists: ${err.message}`);
    }

    // Periodic flush. unref() so the timer never keeps the process alive on its own.
    this.timer = setInterval(() => {
      this.flush().catch((err) => this.logger.error(`Scheduled flush failed: ${err.message}`));
    }, this.flushIntervalMs);
    this.timer.unref();

    this.logger.log(
      `Usage tracking enabled -> ${this.projectId}.${this.datasetId}.${this.tableId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  // Best-effort, non-blocking. Drops the row silently if tracking is disabled.
  enqueue(row: UsageRow): void {
    if (!this.enabled) return;
    this.buffer.push(row);
    if (this.buffer.length >= this.maxBufferRows) {
      this.flush().catch((err) => this.logger.error(`Threshold flush failed: ${err.message}`));
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || !this.bigQuery || this.flushing || this.buffer.length === 0) {
      return;
    }
    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      // raw insert lets us set insertId = request_id for best-effort dedup of retries.
      const rows = batch.map((row) => ({ insertId: row.request_id, json: row }));
      await this.bigQuery
        .dataset(this.datasetId)
        .table(this.tableId)
        .insert(rows, { raw: true });
    } catch (err: any) {
      // Re-buffer on failure so a transient BigQuery error doesn't lose usage data,
      // unless that would grow the buffer without bound.
      if (this.buffer.length + batch.length <= this.maxBufferRows * 4) {
        this.buffer.unshift(...batch);
      }
      this.logger.error(`Usage flush failed (${batch.length} rows): ${err.message}`);
    } finally {
      this.flushing = false;
    }
  }

  private async ensureTable(): Promise<void> {
    if (!this.bigQuery) return;
    const dataset = this.bigQuery.dataset(this.datasetId);
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      await dataset.create({ location: 'US' });
      this.logger.log(`Created dataset ${this.datasetId}`);
    }
    const table = dataset.table(this.tableId);
    const [tableExists] = await table.exists();
    if (!tableExists) {
      await dataset.createTable(this.tableId, {
        schema: TABLE_SCHEMA,
        timePartitioning: { type: 'DAY', field: 'request_ts' },
        clustering: { fields: ['account_id', 'route'] },
      });
      this.logger.log(`Created usage table ${this.datasetId}.${this.tableId}`);
    }
  }
}
