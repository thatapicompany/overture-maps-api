import { HttpException } from '@nestjs/common';
import { usageStorage } from '../usage/usage.context';
import { chargeCountryBudget, checkCountryBudget, countryBudget, CountryBudget, countryBudgetExempt, countryBudgetMessage, countryDailyBudgetBytes } from './country-budget';

const GIB = 1024 ** 3;
const HOUR = 60 * 60_000;
const user = (accountId: string) => ({ accountId }) as any;
const job = (bytesBilled: number) => ({ jobId: 'j', bytesProcessed: bytesBilled, bytesBilled, costUsd: 0, durationMs: 1, statementType: 'SELECT' });
const inRequest = (jobs: ReturnType<typeof job>[], run: () => void) => usageStorage.run({ requestId: 'r', startTime: 0, jobs }, run);

describe('country-level daily budget', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    countryBudget.reset();
    delete process.env.COUNTRY_LEVEL_DAILY_GIB;
    delete process.env.COUNTRY_LEVEL_BUDGET_EXEMPT;
    delete process.env.COUNTRY_LEVEL_HOURLY_EXEMPT;
  });
  afterAll(() => {
    process.env = prev;
  });

  it('reads its settings: 3 TiB a day by default, off at 0, with a list of exempt accounts under either name', () => {
    expect(countryDailyBudgetBytes({})).toBe(3072 * GIB);
    expect(countryDailyBudgetBytes({ COUNTRY_LEVEL_DAILY_GIB: '50' })).toBe(50 * GIB);
    expect(countryDailyBudgetBytes({ COUNTRY_LEVEL_DAILY_GIB: '0' })).toBeNull();
    expect(countryDailyBudgetBytes({ COUNTRY_LEVEL_DAILY_GIB: 'nonsense' })).toBeNull();
    expect([...countryBudgetExempt({ COUNTRY_LEVEL_BUDGET_EXEMPT: ' a , b,' })]).toEqual(['a', 'b']);
    expect([...countryBudgetExempt({ COUNTRY_LEVEL_HOURLY_EXEMPT: 'c', COUNTRY_LEVEL_BUDGET_EXEMPT: 'a' })].sort()).toEqual(['a', 'c']);
  });

  it('keeps a rolling day and says when the account is back under', () => {
    const budget = new CountryBudget();
    const t0 = 10 * 24 * HOUR;
    budget.add('acct', 2000 * GIB, t0);
    budget.add('acct', 1500 * GIB, t0 + 2 * HOUR);
    expect(budget.used('acct', t0 + 3 * HOUR)).toBe(3500 * GIB);
    // Over by the first spend: free again when that one is a day old.
    expect(budget.retryAfterSeconds('acct', 3072 * GIB, t0 + 4 * HOUR)).toBe(20 * 3600);
    expect(budget.retryAfterSeconds('acct', 3072 * GIB, t0 + 24 * HOUR + 60_000)).toBe(0);
    expect(budget.used('acct', t0 + 27 * HOUR)).toBe(0);
    expect(budget.retryAfterSeconds('other', 3072 * GIB, t0)).toBe(0);
  });

  it('adds many requests in the same minute together, so a day of use stays small in memory', () => {
    const budget = new CountryBudget();
    const t0 = 10 * 24 * HOUR;
    for (let i = 0; i < 5000; i++) budget.add('acct', GIB, t0 + (i % 60) * 1000);
    expect(budget.used('acct', t0 + 60_000)).toBe(5000 * GIB);
    expect((budget as any).spent.get('acct').size).toBe(1);
  });

  it('lets a fast burst through untouched: a few hundred GiB in minutes is far inside the day', () => {
    const query = { country: 'US' };
    const now = 10 * 24 * HOUR;
    for (let i = 0; i < 2000; i++) {
      expect(() => checkCountryBudget(query, user('acct'), now + i * 500)).not.toThrow();
      inRequest([job(0.35 * GIB)], () => chargeCountryBudget(query, user('acct'), now + i * 500));
    }
    expect(countryBudget.used('acct', now + HOUR)).toBeCloseTo(700 * GIB, -6);
  });

  it('refuses with a 429 once the day is spent, for that account only, until the spending ages out', () => {
    process.env.COUNTRY_LEVEL_DAILY_GIB = '40';
    const query = { country: 'US' };
    const now = 10 * 24 * HOUR;
    for (let i = 0; i < 3; i++) inRequest([job(14 * GIB)], () => chargeCountryBudget(query, user('acct'), now));
    let thrown: HttpException | undefined;
    const store = { requestId: 'r', startTime: 0, jobs: [] as any[], error: undefined as string | undefined };
    usageStorage.run(store, () => {
      try {
        checkCountryBudget(query, user('acct'), now + HOUR);
      } catch (error) {
        thrown = error as HttpException;
      }
    });
    expect(thrown?.getStatus()).toBe(429);
    expect(thrown?.getResponse()).toMatchObject({ error: 'country_level_daily_limit', retry_after_seconds: 23 * 3600 });
    expect(store.error).toBe('country_level_daily_limit');
    expect(() => checkCountryBudget(query, user('other'), now + HOUR)).not.toThrow();
    expect(() => checkCountryBudget(query, user('acct'), now + 24 * HOUR + 60_000)).not.toThrow();
  });

  it('words the wait in hours or minutes', () => {
    expect(countryBudgetMessage(23 * 3600)).toContain('about 23 hours');
    expect(countryBudgetMessage(40 * 60)).toContain('about 40 minutes');
    expect(countryBudgetMessage(20)).toContain('about 1 minute.');
  });

  it('never applies to radius queries, cached responses, exempt accounts or when switched off', () => {
    process.env.COUNTRY_LEVEL_DAILY_GIB = '10';
    inRequest([job(50 * GIB)], () => chargeCountryBudget({ country: 'US', lat: 1, lng: 2 }, user('acct')));
    expect(countryBudget.used('acct')).toBe(0);
    inRequest([], () => chargeCountryBudget({ country: 'US' }, user('acct')));
    expect(countryBudget.used('acct')).toBe(0);
    inRequest([job(50 * GIB)], () => chargeCountryBudget({ country: 'US' }, user('acct')));
    expect(() => checkCountryBudget({ country: 'US' }, user('acct'))).toThrow(HttpException);
    expect(() => checkCountryBudget({ country: 'US', lat: 1, lng: 2 }, user('acct'))).not.toThrow();
    process.env.COUNTRY_LEVEL_BUDGET_EXEMPT = 'acct';
    expect(() => checkCountryBudget({ country: 'US' }, user('acct'))).not.toThrow();
    delete process.env.COUNTRY_LEVEL_BUDGET_EXEMPT;
    process.env.COUNTRY_LEVEL_DAILY_GIB = '0';
    expect(() => checkCountryBudget({ country: 'US' }, user('acct'))).not.toThrow();
  });
});
