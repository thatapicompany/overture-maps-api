import { AsyncLocalStorage } from 'async_hooks';

// Per-BigQuery-job cost/usage captured during a single API request.
export interface BqJobUsage {
  jobId: string | null;
  bytesProcessed: number;
  bytesBilled: number;
  costUsd: number;
  durationMs: number;
  statementType: string | null;
}

// Request-scoped accumulator. One store per inbound API request; runQuery() pushes
// the cost of every BigQuery job it runs into store.jobs so the usage middleware can
// assemble a single immutable usage row once the response finishes.
export interface UsageStore {
  requestId: string;
  startTime: number;
  jobs: BqJobUsage[];
  /** Machine-readable reason a request failed inside the service layer, if any. */
  error?: string;
}

export const usageStorage = new AsyncLocalStorage<UsageStore>();

// Append a BigQuery job's usage to the current request's store, if one is active.
// Safe to call from anywhere — a no-op outside an HTTP request context (e.g. tests).
export function recordBqJob(job: BqJobUsage): void {
  const store = usageStorage.getStore();
  if (store) {
    store.jobs.push(job);
  }
}

// Note why the current request failed (e.g. a BigQuery guardrail fired), so the
// usage row records it. No-op outside a request.
export function recordUsageError(code: string): void {
  const store = usageStorage.getStore();
  if (store) {
    store.error = code;
  }
}

// Returns the active request id for labelling BigQuery jobs, or undefined.
export function currentRequestId(): string | undefined {
  return usageStorage.getStore()?.requestId;
}
