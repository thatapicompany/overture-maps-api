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
    expect(isCountryLevel({ country: 'GB' })).toBe(true);
    expect(isCountryLevel({ country: 'GB', lat: 51.5074, lng: -0.1278 })).toBe(false);
    expect(isCountryLevel({ lat: 51.5074, lng: -0.1278 })).toBe(false);
    // NaN lat (unparseable query param) counts as absent, so it is still country-level.
    expect(isCountryLevel({ country: 'GB', lat: NaN, lng: NaN })).toBe(true);
  });

  it('rejects a Free account country+name query with 403 before any BigQuery call (the 5 Oct 2026 shape)', () => {
    let thrown: HttpException | undefined;
    try {
      assertCountryLevelAllowed({ country: 'GB' }, free);
    } catch (e) {
      thrown = e as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(403);
    expect(thrown!.message).toBe(COUNTRY_LEVEL_PAID_ONLY_MESSAGE);
  });

  it('rejects an anonymous (undefined) user the same way', () => {
    expect(() => assertCountryLevelAllowed({ country: 'GB' }, undefined)).toThrow(HttpException);
  });

  it('allows a paid account to run country-level queries', () => {
    expect(() => assertCountryLevelAllowed({ country: 'GB' }, paid)).not.toThrow();
  });

  it('fails OPEN when no paid-tier source is configured, so a missed env var cannot lock out a paying customer', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(() => assertCountryLevelAllowed({ country: 'GB' }, free)).not.toThrow();
    expect(() => assertCountryLevelAllowed({ country: 'GB' }, { accountId: 'paid-acct', userId: 'u' })).not.toThrow();
  });

  it('never blocks radius queries, whatever the plan', () => {
    expect(() => assertCountryLevelAllowed({ country: 'GB', lat: 51.5074, lng: -0.1278 }, free)).not.toThrow();
    expect(() => assertCountryLevelAllowed({ lat: 51.5074, lng: -0.1278 }, free)).not.toThrow();
  });
});
