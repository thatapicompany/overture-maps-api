import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { firestoreFieldValue, portalFirestore, portalFirestoreConfigured } from '../tiers/portal-firestore';

// Per-account monthly request counters, shared across Cloud Run instances.
//
// Store: Firestore (project PLAN_FIRESTORE_PROJECT_ID, collection
// QUOTA_FIRESTORE_COLLECTION, one doc per account per UTC month, id
// `{accountId}_{YYYY-MM}`). Chosen because the hosted deployment has no Redis.
//
// Writes are batched: each instance accumulates increments in memory and
// flushes them every 2s with FieldValue.increment, because Firestore sustains
// about one write per second per document and one account can send thousands
// of requests an hour.
//
// Reads are cached per instance for 5s and refreshed in the background, so a
// request waits on Firestore only the first time this instance sees an
// account in a month. The effective count is the last read plus this
// instance's increments since. Other instances' unflushed increments are not
// visible, so an account can overshoot its limit by a few seconds' traffic per
// instance. That is the price of not putting a Firestore round trip on every
// request.
//
// Seeding: the first time an account-month doc is needed it is created from
// that month's successful requests in BigQuery (usage.api_requests), so turning
// this on mid-month counts the month from day one, not from deploy.
//
// Every failure (Firestore, BigQuery, timeout) makes the count unavailable,
// and the guard treats unavailable as allow.
//
// Increments are never retried. A write that errors or times out may still
// have been applied, and retrying it double counts: on Cloud Run with
// request-based CPU, background flushes ran slowly, hit the timeout after the
// write had landed, and were retried, inflating counts 2-3x in the first
// minutes of production. Dropping an uncertain increment can
// only under-count, which errs towards allowing; the next read re-syncs.
// Flushes are also started from the request path (flushSoon), while the
// instance has CPU, not only from the background timer.

export interface CounterBackend {
  read(key: string): Promise<number | null>;
  create(key: string, data: { accountId: string; month: string; count: number }): Promise<boolean>;
  increment(key: string, n: number): Promise<void>;
}

export type MonthSeeder = (accountId: string, monthStart: Date) => Promise<number>;

interface KeyState {
  remote: number | null;
  readAt: number;
  pending: number;
  flushedSinceRead: number;
  reading?: Promise<void>;
  failedUntil?: number;
}

const envInt = (name: string, fallback: number): number => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

@Injectable()
export class UsageCounterStore implements OnModuleDestroy {
  private readonly logger = new Logger('UsageCounterStore');
  private readonly state = new Map<string, KeyState>();
  private backend?: CounterBackend;
  private seeder?: MonthSeeder;
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  /** Test seam. Production builds Firestore and BigQuery adapters lazily. */
  configure(backend: CounterBackend, seeder: MonthSeeder): void {
    this.backend = backend;
    this.seeder = seeder;
    this.state.clear();
  }

  /**
   * Successful requests this account has made this UTC month, or null when
   * the count cannot be established (the caller must then allow).
   */
  async current(accountId: string, now: Date = new Date()): Promise<number | null> {
    const key = `${accountId}_${monthKey(now)}`;
    const st = this.stateFor(key);
    const refreshMs = envInt('QUOTA_COUNT_REFRESH_MS', 5_000);
    if (st.remote === null) {
      if (st.failedUntil && st.failedUntil > Date.now()) return null;
      await this.read(key, accountId, now);
      if (st.remote === null) return null;
    } else if (Date.now() - st.readAt >= refreshMs) {
      void this.read(key, accountId, now);
    }
    return st.remote + st.flushedSinceRead + st.pending;
  }

  /**
   * Start a flush now if anything is pending. Called at the start of each
   * request: on Cloud Run with request-based billing an instance only has CPU
   * while a request is in flight, so this is when a flush actually runs.
   * Non-blocking; never delays the request.
   */
  flushSoon(): void {
    if (this.flushing) return;
    for (const st of this.state.values()) {
      if (st.pending > 0) {
        void this.flush();
        return;
      }
    }
  }

  /** Count one successful request. Flushed to Firestore within ~2s. */
  record(accountId: string, now: Date = new Date()): void {
    this.stateFor(`${accountId}_${monthKey(now)}`).pending += 1;
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), envInt('QUOTA_FLUSH_INTERVAL_MS', 2_000));
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const current = monthKey(new Date());
      for (const [key, st] of this.state) {
        if (st.pending > 0) {
          const n = st.pending;
          st.pending = 0;
          try {
            await this.withTimeout(this.getBackend().increment(key, n), envInt('QUOTA_WRITE_TIMEOUT_MS', 10_000));
            st.flushedSinceRead += n;
          } catch (err: any) {
            // Do NOT retry: the increment may have been applied (see the note
            // at the top). Force a fresh read so the count re-syncs from
            // Firestore on the next request.
            st.readAt = 0;
            this.logger.error(`Usage counter flush uncertain for ${key} (+${n}), not retried: ${err?.message ?? err}`);
          }
        }
        // Drop finished months once nothing is left to flush for them.
        if (!key.endsWith(`_${current}`) && st.pending === 0) this.state.delete(key);
      }
    })().finally(() => (this.flushing = undefined));
    return this.flushing;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private stateFor(key: string): KeyState {
    let st = this.state.get(key);
    if (!st) {
      st = { remote: null, readAt: 0, pending: 0, flushedSinceRead: 0 };
      this.state.set(key, st);
    }
    return st;
  }

  private read(key: string, accountId: string, now: Date): Promise<void> {
    const st = this.stateFor(key);
    if (st.reading) return st.reading;
    const flushedBefore = st.flushedSinceRead;
    st.reading = (async () => {
      try {
        const backend = this.getBackend();
        let value = await this.withTimeout(backend.read(key));
        if (value === null) {
          const seeded = await this.withTimeout(this.getSeeder()(accountId, monthStartUtc(now)));
          const created = await this.withTimeout(backend.create(key, { accountId, month: monthKey(now), count: seeded }));
          value = created ? seeded : ((await this.withTimeout(backend.read(key))) ?? seeded);
          if (created) this.logger.log(`Seeded ${key} with ${seeded} successful requests from BigQuery.`);
        }
        st.remote = value;
        st.readAt = Date.now();
        // Increments flushed before this read began are included in `value`.
        st.flushedSinceRead -= flushedBefore;
        st.failedUntil = undefined;
      } catch (err: any) {
        st.failedUntil = Date.now() + envInt('QUOTA_FAILURE_BACKOFF_MS', 30_000);
        this.logger.error(`Usage counter read failed for ${key}: ${err?.message ?? err}; not enforcing for this account until it recovers.`);
      } finally {
        st.reading = undefined;
      }
    })();
    return st.reading;
  }

  private withTimeout<T>(p: Promise<T>, ms: number = envInt('QUOTA_STORE_TIMEOUT_MS', 3_000)): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]).finally(() => timer && clearTimeout(timer));
  }

  private getBackend(): CounterBackend {
    if (!this.backend) this.backend = firestoreBackend();
    return this.backend;
  }

  private getSeeder(): MonthSeeder {
    if (!this.seeder) this.seeder = bigQuerySeeder();
    return this.seeder;
  }
}

function firestoreBackend(): CounterBackend {
  if (!portalFirestoreConfigured()) throw new Error('PLAN_FIRESTORE_PROJECT_ID is not set; monthly counters are disabled.');
  const collection = () => portalFirestore().collection(process.env.QUOTA_FIRESTORE_COLLECTION || 'api_usage_monthly');
  return {
    async read(key) {
      const snap = await collection().doc(key).get();
      if (!snap.exists) return null;
      const n = Number(snap.data()?.count);
      return Number.isFinite(n) ? n : 0;
    },
    async create(key, data) {
      try {
        await collection().doc(key).create({ ...data, seededCount: data.count, createdAt: new Date(), updatedAt: new Date() });
        return true;
      } catch (err: any) {
        if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message))) return false;
        throw err;
      }
    },
    async increment(key, n) {
      const FieldValue = firestoreFieldValue();
      await collection().doc(key).set({ count: FieldValue.increment(n), updatedAt: new Date() }, { merge: true });
    },
  };
}

export function bigQuerySeeder(): MonthSeeder {
  const projectId = process.env.USAGE_BQ_PROJECT || process.env.BIGQUERY_PROJECT_ID;
  const table = `${projectId}.${process.env.USAGE_BQ_DATASET || 'usage'}.${process.env.USAGE_BQ_TABLE || 'api_requests'}`;
  const bq = new BigQuery({ projectId });
  return async (accountId, monthStart) => {
    // Partitioned by request_ts and clustered by account_id, so this reads one
    // account's slice of the current month: a few MB.
    const [rows] = await bq.query({
      query: `SELECT COUNTIF(status_code < 400) AS n FROM \`${table}\` WHERE account_id = @accountId AND request_ts >= @monthStart`,
      params: { accountId, monthStart: bq.timestamp(monthStart) },
      location: 'US',
      labels: { product: 'overture-maps-api', purpose: 'quota-seed' },
    });
    return Number(rows?.[0]?.n ?? 0);
  };
}
