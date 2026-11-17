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
// This is the backstop for that: each account has an hourly budget of bytes
// billed by its country-level queries. Cheap country-level queries barely
// touch it, so paging through a category is unaffected. Once it is spent,
// further country-level queries get a 429 until enough of the hour has passed.
// Radius queries are never affected. Kept in memory per instance, so it is a
// ceiling per instance, not an exact account-wide figure. See
// etl/cost-controls.md.

const GIB = 1024 ** 3;
const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_HOURLY_GIB = 300;

/** Hourly budget in bytes, or null when switched off (`COUNTRY_LEVEL_HOURLY_GIB=0`). */
export function countryHourlyBudgetBytes(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.COUNTRY_LEVEL_HOURLY_GIB;
  const gib = raw === undefined || raw === '' ? DEFAULT_HOURLY_GIB : Number(raw);
  if (!Number.isFinite(gib) || gib <= 0) return null;
  return gib * GIB;
}

/** Accounts the budget does not apply to (`COUNTRY_LEVEL_HOURLY_EXEMPT`, comma separated). */
export function countryBudgetExempt(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.COUNTRY_LEVEL_HOURLY_EXEMPT ?? '').split(',').map((id) => id.trim()).filter(Boolean));
}

interface Spend {
  at: number;
  bytes: number;
}

export class CountryBudget {
  private readonly spent = new Map<string, Spend[]>();

  private recent(accountId: string, now: number): Spend[] {
    const kept = (this.spent.get(accountId) ?? []).filter((s) => now - s.at < WINDOW_MS);
    if (kept.length) this.spent.set(accountId, kept);
    else this.spent.delete(accountId);
    return kept;
  }

  /** Bytes billed by the account's country-level queries in the last hour. */
  used(accountId: string, now: number = Date.now()): number {
    return this.recent(accountId, now).reduce((sum, s) => sum + s.bytes, 0);
  }

  add(accountId: string, bytes: number, now: number = Date.now()): void {
    if (!(bytes > 0)) return;
    const kept = this.recent(accountId, now);
    kept.push({ at: now, bytes });
    this.spent.set(accountId, kept);
  }

  /**
   * Seconds until the account is back under `budget`, or 0 if it is under now.
   * Spending drops out of the window oldest first.
   */
  retryAfterSeconds(accountId: string, budget: number, now: number = Date.now()): number {
    const kept = this.recent(accountId, now);
    let total = kept.reduce((sum, s) => sum + s.bytes, 0);
    if (total < budget) return 0;
    for (const s of kept) {
      total -= s.bytes;
      if (total < budget) return Math.max(1, Math.ceil((s.at + WINDOW_MS - now) / 1000));
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
  return (
    `This account has reached its hourly limit for country-level queries (a country filter without lat/lng). ` +
    `Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}. Queries by lat, lng and radius are not affected. ` +
    `Country-level queries filtered by categories use far less of the limit than ones filtered by taxonomy or brand.`
  );
}

function budgetFor(query: CountryLevelQuery, user: User | undefined): { accountId: string; budget: number } | null {
  if (!isCountryLevel(query) || !user?.accountId) return null;
  const budget = countryHourlyBudgetBytes();
  if (budget === null || countryBudgetExempt().has(user.accountId)) return null;
  return { accountId: user.accountId, budget };
}

/** Throws 429 `country_level_hourly_limit` when the account has spent its hourly budget. */
export function checkCountryBudget(query: CountryLevelQuery, user: User | undefined, now: number = Date.now()): void {
  const target = budgetFor(query, user);
  if (!target) return;
  const retryAfter = countryBudget.retryAfterSeconds(target.accountId, target.budget, now);
  if (!retryAfter) return;
  recordUsageError('country_level_hourly_limit');
  throw new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'country_level_hourly_limit', message: countryBudgetMessage(retryAfter), retry_after_seconds: retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Adds what the current request's BigQuery jobs billed to the account's hour. Cached responses bill nothing. */
export function chargeCountryBudget(query: CountryLevelQuery, user: User | undefined, now: number = Date.now()): void {
  const target = budgetFor(query, user);
  if (!target) return;
  const jobs = usageStorage.getStore()?.jobs ?? [];
  countryBudget.add(target.accountId, jobs.reduce((sum, job) => sum + (job.bytesBilled || 0), 0), now);
}
