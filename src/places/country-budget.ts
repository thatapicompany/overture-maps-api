import { HttpException, HttpStatus } from '@nestjs/common';
import { User } from '../decorators/authed-user.decorator';
import { recordUsageError, usageStorage } from '../usage/usage.context';
import { CountryLevelQuery, isCountryLevel } from './places-cost-guards';

// A country-level /places query can read a whole country's slice of the place
// table. Filters the table is clustered on (categories, name) prune that to
// very little; filters it is not clustered on (taxonomy, brand) do not, and in
// the largest countries one such request bills over ten GiB. The per-minute
// and monthly request limits count requests, so a script that sweeps a country
// one value at a time can spend the whole project's daily BigQuery quota in
// minutes, which stops the API for every account.
//
// This is the backstop for that: each account has a daily budget of bytes
// billed by its country-level queries, counted over a rolling 24 hours. It is
// set well above what a legitimate job needs (a sweep of every taxonomy value
// in the largest country is under a tenth of the default) and well below the
// project's daily quota, so a burst runs at full speed and only an account
// that would endanger everyone else is stopped. Once it is spent, further
// country-level queries get a 429 until enough of the day has passed.
// Radius queries are never affected. Kept in memory per instance, so it is a
// ceiling per instance, not an exact account-wide figure. See
// etl/cost-controls.md.
//
// It was first an hourly budget. That throttled short, harmless bursts from
// paying accounts while still letting a sustained day through.

const GIB = 1024 ** 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 60 * 1000;
const DEFAULT_DAILY_GIB = 3072;

/** Daily budget in bytes, or null when switched off (`COUNTRY_LEVEL_DAILY_GIB=0`). */
export function countryDailyBudgetBytes(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.COUNTRY_LEVEL_DAILY_GIB;
  const gib = raw === undefined || raw === '' ? DEFAULT_DAILY_GIB : Number(raw);
  if (!Number.isFinite(gib) || gib <= 0) return null;
  return gib * GIB;
}

/**
 * Accounts the budget does not apply to (`COUNTRY_LEVEL_BUDGET_EXEMPT`, comma
 * separated). `COUNTRY_LEVEL_HOURLY_EXEMPT`, its first name, is still read.
 */
export function countryBudgetExempt(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = [env.COUNTRY_LEVEL_BUDGET_EXEMPT, env.COUNTRY_LEVEL_HOURLY_EXEMPT].filter(Boolean).join(',');
  return new Set(raw.split(',').map((id) => id.trim()).filter(Boolean));
}

export class CountryBudget {
  // Per account, bytes billed in each minute of the last day: at most 1,440
  // entries however many requests there were.
  private readonly spent = new Map<string, Map<number, number>>();

  private recent(accountId: string, now: number): Map<number, number> | undefined {
    const buckets = this.spent.get(accountId);
    if (!buckets) return undefined;
    for (const minute of buckets.keys()) {
      if (now - minute * BUCKET_MS >= WINDOW_MS) buckets.delete(minute);
    }
    if (buckets.size === 0) {
      this.spent.delete(accountId);
      return undefined;
    }
    return buckets;
  }

  /** Bytes billed by the account's country-level queries in the last 24 hours. */
  used(accountId: string, now: number = Date.now()): number {
    let total = 0;
    for (const bytes of this.recent(accountId, now)?.values() ?? []) total += bytes;
    return total;
  }

  add(accountId: string, bytes: number, now: number = Date.now()): void {
    if (!(bytes > 0)) return;
    const buckets = this.recent(accountId, now) ?? new Map<number, number>();
    const minute = Math.floor(now / BUCKET_MS);
    buckets.set(minute, (buckets.get(minute) ?? 0) + bytes);
    this.spent.set(accountId, buckets);
  }

  /**
   * Seconds until the account is back under `budget`, or 0 if it is under now.
   * Spending drops out of the window oldest first.
   */
  retryAfterSeconds(accountId: string, budget: number, now: number = Date.now()): number {
    const buckets = this.recent(accountId, now);
    if (!buckets) return 0;
    let total = 0;
    for (const bytes of buckets.values()) total += bytes;
    if (total < budget) return 0;
    for (const minute of [...buckets.keys()].sort((a, b) => a - b)) {
      total -= buckets.get(minute)!;
      if (total < budget) return Math.max(1, Math.ceil((minute * BUCKET_MS + WINDOW_MS - now) / 1000));
    }
    return Math.ceil(WINDOW_MS / 1000);
  }

  reset(): void {
    this.spent.clear();
  }
}

export const countryBudget = new CountryBudget();

export function countryBudgetMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = minutes >= 90 ? `${Math.ceil(minutes / 60)} hours` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return (
    `This account has reached its daily limit for country-level queries (a country filter without lat/lng). ` +
    `Try again in about ${wait}. Queries by lat, lng and radius are not affected.`
  );
}

function budgetFor(query: CountryLevelQuery, user: User | undefined): { accountId: string; budget: number } | null {
  if (!isCountryLevel(query) || !user?.accountId) return null;
  const budget = countryDailyBudgetBytes();
  if (budget === null || countryBudgetExempt().has(user.accountId)) return null;
  return { accountId: user.accountId, budget };
}

/** Throws 429 `country_level_daily_limit` when the account has spent its daily budget. */
export function checkCountryBudget(query: CountryLevelQuery, user: User | undefined, now: number = Date.now()): void {
  const target = budgetFor(query, user);
  if (!target) return;
  const retryAfter = countryBudget.retryAfterSeconds(target.accountId, target.budget, now);
  if (!retryAfter) return;
  recordUsageError('country_level_daily_limit');
  throw new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'country_level_daily_limit', message: countryBudgetMessage(retryAfter), retry_after_seconds: retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Adds what the current request's BigQuery jobs billed to the account's day. Cached responses bill nothing. */
export function chargeCountryBudget(query: CountryLevelQuery, user: User | undefined, now: number = Date.now()): void {
  const target = budgetFor(query, user);
  if (!target) return;
  const jobs = usageStorage.getStore()?.jobs ?? [];
  countryBudget.add(target.accountId, jobs.reduce((sum, job) => sum + (job.bytesBilled || 0), 0), now);
}
