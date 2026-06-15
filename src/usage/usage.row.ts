import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { UsageStore } from './usage.context';

// Data routes whose requests are eligible to be served from cache. Used to decide
// whether a zero-BigQuery-job request was a cache hit rather than a non-data route
// (e.g. the root welcome endpoint) that simply never queries BigQuery.
const DATA_ROUTE_PREFIXES = [
  '/places',
  '/buildings',
  '/addresses',
  '/transportation',
  '/divisions',
  '/base',
];

// The same header/query names the auth middleware accepts, so we can attribute a
// request to a key even when it failed to authenticate.
const API_KEY_NAMES = ['x-api-key', 'api_key', 'api-key', 'apikey'];

function extractApiKey(req: Request): string | undefined {
  for (const name of API_KEY_NAMES) {
    const fromHeader = req.headers[name];
    if (typeof fromHeader === 'string' && fromHeader) return fromHeader;
  }
  for (const name of API_KEY_NAMES) {
    const fromQuery = req.query?.[name];
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  }
  return undefined;
}

function hashApiKey(key?: string): string | null {
  if (!key) return null;
  return createHash('sha256').update(key).digest('hex');
}

function toInt(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

export interface UsageRow {
  request_id: string;
  request_ts: string;
  account_id: string | null;
  user_id: string | null;
  is_demo: boolean;
  api_key_hash: string | null;
  method: string;
  route: string | null;
  path: string;
  query_params: string;
  status_code: number;
  cache_hit: boolean;
  response_count: number | null;
  duration_ms: number;
  bq_job_count: number;
  total_bytes_billed: number;
  cost_usd: number;
  env: string | null;
  api_version: string | null;
  error: string | null;
  jobs: {
    job_id: string | null;
    bytes_processed: number;
    bytes_billed: number;
    cost_usd: number;
    duration_ms: number;
    statement_type: string | null;
  }[];
}

// Pure mapping from a finished request + its accumulated BigQuery jobs to an
// immutable usage row. Kept side-effect free so it is trivially unit testable.
export function buildUsageRow(req: Request, res: Response, store: UsageStore): UsageRow {
  const user = (res.locals?.user || (req as any).user) as
    | { accountId?: string; userId?: string; isDemoAccount?: boolean }
    | undefined;

  const jobs = store.jobs;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  const isDataRoute = DATA_ROUTE_PREFIXES.some((p) => path.startsWith(p));

  const totalBytesBilled = jobs.reduce((sum, j) => sum + (j.bytesBilled || 0), 0);
  const costUsd = jobs.reduce((sum, j) => sum + (j.costUsd || 0), 0);

  return {
    request_id: store.requestId,
    request_ts: new Date(store.startTime).toISOString(),
    account_id: user?.accountId ?? null,
    user_id: user?.userId ?? null,
    is_demo: user?.isDemoAccount ?? false,
    api_key_hash: hashApiKey(extractApiKey(req)),
    method: req.method,
    route: (req as any).route?.path ?? null,
    path,
    query_params: JSON.stringify(req.query ?? {}),
    status_code: res.statusCode,
    // No BigQuery jobs on a successful data route means the response was cached.
    cache_hit: jobs.length === 0 && res.statusCode < 400 && isDataRoute,
    response_count: toInt(res.getHeader('X-Total-Count')),
    duration_ms: Date.now() - store.startTime,
    bq_job_count: jobs.length,
    total_bytes_billed: totalBytesBilled,
    cost_usd: costUsd,
    env: process.env.ENV ?? null,
    api_version: process.env.npm_package_version ?? null,
    error: null,
    jobs: jobs.map((j) => ({
      job_id: j.jobId,
      bytes_processed: j.bytesProcessed,
      bytes_billed: j.bytesBilled,
      cost_usd: j.costUsd,
      duration_ms: j.durationMs,
      statement_type: j.statementType,
    })),
  };
}
