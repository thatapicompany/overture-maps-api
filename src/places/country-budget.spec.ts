import { HttpException } from '@nestjs/common';
import { usageStorage } from '../usage/usage.context';
import { chargeCountryBudget, checkCountryBudget, countryBudget, CountryBudget, countryBudgetExempt, countryHourlyBudgetBytes } from './country-budget';

const GIB = 1024 ** 3;
const user = (accountId: string) => ({ accountId }) as any;
const job = (bytesBilled: number) => ({ jobId: 'j', bytesProcessed: bytesBilled, bytesBilled, costUsd: 0, durationMs: 1, statementType: 'SELECT' });
const inRequest = (jobs: ReturnType<typeof job>[], run: () => void) => usageStorage.run({ requestId: 'r', startTime: 0, jobs }, run);

describe('country-level hourly budget', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    countryBudget.reset();
    delete process.env.COUNTRY_LEVEL_HOURLY_GIB;
    delete process.env.COUNTRY_LEVEL_HOURLY_EXEMPT;
  });
  afterAll(() => {
    process.env = prev;
  });

  it('reads its settings: 300 GiB by default, off at 0, with a list of exempt accounts', () => {
    expect(countryHourlyBudgetBytes({})).toBe(300 * GIB);
    expect(countryHourlyBudgetBytes({ COUNTRY_LEVEL_HOURLY_GIB: '50' })).toBe(50 * GIB);
    expect(countryHourlyBudgetBytes({ COUNTRY_LEVEL_HOURLY_GIB: '0' })).toBeNull();
    expect(countryHourlyBudgetBytes({ COUNTRY_LEVEL_HOURLY_GIB: 'nonsense' })).toBeNull();
    expect([...countryBudgetExempt({ COUNTRY_LEVEL_HOURLY_EXEMPT: ' a , b,' })]).toEqual(['a', 'b']);
  });

  it('keeps a rolling hour and says when the account is back under', () => {
    const budget = new CountryBudget();
    const t0 = 1_000_000;
    budget.add('acct', 200 * GIB, t0);
    budget.add('acct', 150 * GIB, t0 + 10 * 60_000);
    expect(budget.used('acct', t0 + 11 * 60_000)).toBe(350 * GIB);
    // Over by the first spend: free again when that one is an hour old.
    expect(budget.retryAfterSeconds('acct', 300 * GIB, t0 + 20 * 60_000)).toBe(40 * 60);
    expect(budget.retryAfterSeconds('acct', 300 * GIB, t0 + 61 * 60_000)).toBe(0);
    expect(budget.used('acct', t0 + 71 * 60_000)).toBe(0);
    expect(budget.retryAfterSeconds('other', 300 * GIB, t0)).toBe(0);
  });

  it('lets a sweep of expensive country queries run until the budget is spent, then refuses with a 429', () => {
    process.env.COUNTRY_LEVEL_HOURLY_GIB = '40';
    const query = { country: 'US' };
    const now = 5_000_000;
    for (let i = 0; i < 3; i++) {
      expect(() => checkCountryBudget(query, user('acct'), now + i)).not.toThrow();
      inRequest([job(14 * GIB)], () => chargeCountryBudget(query, user('acct'), now + i));
    }
    let thrown: HttpException | undefined;
    const store = { requestId: 'r', startTime: 0, jobs: [] as any[], error: undefined as string | undefined };
    usageStorage.run(store, () => {
      try {
        checkCountryBudget(query, user('acct'), now + 10);
      } catch (error) {
        thrown = error as HttpException;
      }
    });
    expect(thrown?.getStatus()).toBe(429);
    expect(thrown?.getResponse()).toMatchObject({ error: 'country_level_hourly_limit', retry_after_seconds: 3600 });
    expect(store.error).toBe('country_level_hourly_limit');
    // Another account, and the same account an hour later, are unaffected.
    expect(() => checkCountryBudget(query, user('other'), now + 10)).not.toThrow();
    expect(() => checkCountryBudget(query, user('acct'), now + 61 * 60_000)).not.toThrow();
  });

  it('never applies to radius queries, cached responses, exempt accounts or when switched off', () => {
    process.env.COUNTRY_LEVEL_HOURLY_GIB = '10';
    inRequest([job(50 * GIB)], () => chargeCountryBudget({ country: 'US', lat: 1, lng: 2 }, user('acct')));
    expect(countryBudget.used('acct')).toBe(0);
    inRequest([], () => chargeCountryBudget({ country: 'US' }, user('acct')));
    expect(countryBudget.used('acct')).toBe(0);
    inRequest([job(50 * GIB)], () => chargeCountryBudget({ country: 'US' }, user('acct')));
    expect(() => checkCountryBudget({ country: 'US' }, user('acct'))).toThrow(HttpException);
    expect(() => checkCountryBudget({ country: 'US', lat: 1, lng: 2 }, user('acct'))).not.toThrow();
    process.env.COUNTRY_LEVEL_HOURLY_EXEMPT = 'acct';
    expect(() => checkCountryBudget({ country: 'US' }, user('acct'))).not.toThrow();
    delete process.env.COUNTRY_LEVEL_HOURLY_EXEMPT;
    process.env.COUNTRY_LEVEL_HOURLY_GIB = '0';
    expect(() => checkCountryBudget({ country: 'US' }, user('acct'))).not.toThrow();
  });
});
