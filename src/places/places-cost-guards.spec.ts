import { HttpException } from '@nestjs/common';
import { assertCountryLevelAllowed, isCountryLevel, COUNTRY_LEVEL_PAID_ONLY_MESSAGE } from './places-cost-guards';

describe('places cost guards: country-level is paid only', () => {
  const free = { accountId: 'free-acct', userId: 'u1' };
  const paid = { accountId: 'paid-acct', userId: 'u2', isPaidAccount: true };
  const prev = process.env.PAID_ACCOUNT_IDS;
  beforeEach(() => { process.env.PAID_ACCOUNT_IDS = 'paid-acct'; });
  afterEach(() => {
    if (prev === undefined) delete process.env.PAID_ACCOUNT_IDS; else process.env.PAID_ACCOUNT_IDS = prev;
  });

  it('identifies a country filter with no lat/lng as country-level', () => {
    expect(isCountryLevel({ country: 'IT' })).toBe(true);
    expect(isCountryLevel({ country: 'IT', lat: 38.14, lng: 15.52 })).toBe(false);
    expect(isCountryLevel({ lat: 38.14, lng: 15.52 })).toBe(false);
    // NaN lat (unparseable query param) counts as absent, so it is still country-level.
    expect(isCountryLevel({ country: 'IT', lat: NaN, lng: NaN })).toBe(true);
  });

  it('rejects a Free account country+name query with 403 before any BigQuery call (the 5 Oct 2026 shape)', () => {
    let thrown: HttpException | undefined;
    try {
      assertCountryLevelAllowed({ country: 'IT' }, free);
    } catch (e) {
      thrown = e as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(403);
    expect(thrown!.message).toBe(COUNTRY_LEVEL_PAID_ONLY_MESSAGE);
  });

  it('rejects an anonymous (undefined) user the same way', () => {
    expect(() => assertCountryLevelAllowed({ country: 'IT' }, undefined)).toThrow(HttpException);
  });

  it('allows a paid account to run country-level queries', () => {
    expect(() => assertCountryLevelAllowed({ country: 'IT' }, paid)).not.toThrow();
  });

  it('fails OPEN when no paid-tier source is configured, so a missed env var cannot lock out a paying customer', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(() => assertCountryLevelAllowed({ country: 'IT' }, free)).not.toThrow();
    expect(() => assertCountryLevelAllowed({ country: 'BM' }, { accountId: '88756c26-b11b-476f-9aeb-4e817b1daf92', userId: 'u' })).not.toThrow();
  });

  it('never blocks radius queries, whatever the plan', () => {
    expect(() => assertCountryLevelAllowed({ country: 'IT', lat: 38.14, lng: 15.52 }, free)).not.toThrow();
    expect(() => assertCountryLevelAllowed({ lat: 38.14, lng: 15.52 }, free)).not.toThrow();
  });
});
