import { HttpException } from '@nestjs/common';
import { checkCountryLevelAllowed, isCountryLevel, COUNTRY_LEVEL_PAID_ONLY_MESSAGE, PlanSource } from './places-cost-guards';
import { PlanStatus } from '../tiers/plan-lookup.service';

const plans = (status: PlanStatus) => {
  const getPlanStatus = jest.fn().mockResolvedValue(status);
  return { getPlanStatus } as PlanSource & { getPlanStatus: jest.Mock };
};

describe('places cost guards: country-level is paid only', () => {
  it('points Free users at the account page, which exists, not a pricing page that does not', () => {
    expect(COUNTRY_LEVEL_PAID_ONLY_MESSAGE).toContain('https://account.overturemapsapi.com');
    expect(COUNTRY_LEVEL_PAID_ONLY_MESSAGE).not.toContain('/pricing');
  });

  const free = { accountId: 'free-acct', userId: 'u1' };
  const paid = { accountId: 'paid-acct', userId: 'u2' };

  it('identifies a country filter with no lat/lng as country-level', () => {
    expect(isCountryLevel({ country: 'GB' })).toBe(true);
    expect(isCountryLevel({ country: 'GB', lat: 51.5074, lng: -0.1278 })).toBe(false);
    expect(isCountryLevel({ lat: 51.5074, lng: -0.1278 })).toBe(false);
    expect(isCountryLevel({ country: 'GB', lat: NaN, lng: NaN })).toBe(true);
  });

  it('rejects a Free account country+name query with 403 (the 5 Oct 2026 shape)', async () => {
    const err = await checkCountryLevelAllowed({ country: 'GB' }, free, plans('free')).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toBe(COUNTRY_LEVEL_PAID_ONLY_MESSAGE);
  });

  it('allows a paid account resolved live from Firestore', async () => {
    const p = plans('paid');
    await expect(checkCountryLevelAllowed({ country: 'GB' }, paid, p)).resolves.toBeUndefined();
    expect(p.getPlanStatus).toHaveBeenCalledWith(paid.accountId);
  });

  it('FAILS OPEN when the plan is unknown (no doc, odd status, Firestore down, timeout)', async () => {
    await expect(checkCountryLevelAllowed({ country: 'GB' }, paid, plans('unknown'))).resolves.toBeUndefined();
  });

  it('lets the static override through without a Firestore lookup', async () => {
    const p = plans('free');
    await expect(checkCountryLevelAllowed({ country: 'GB' }, { ...free, isPaidAccount: true }, p)).resolves.toBeUndefined();
    expect(p.getPlanStatus).not.toHaveBeenCalled();
  });

  it('rejects a request with no account id without a lookup', async () => {
    const p = plans('paid');
    await expect(checkCountryLevelAllowed({ country: 'GB' }, undefined, p)).rejects.toBeInstanceOf(HttpException);
    expect(p.getPlanStatus).not.toHaveBeenCalled();
  });

  it('never blocks, or even looks up, radius queries whatever the plan', async () => {
    const p = plans('free');
    await expect(checkCountryLevelAllowed({ country: 'GB', lat: 51.5074, lng: -0.1278 }, free, p)).resolves.toBeUndefined();
    await expect(checkCountryLevelAllowed({ lat: 51.5074, lng: -0.1278 }, free, p)).resolves.toBeUndefined();
    expect(p.getPlanStatus).not.toHaveBeenCalled();
  });
});
