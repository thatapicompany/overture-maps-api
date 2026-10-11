import { HttpException } from '@nestjs/common';
import { checkCountryLevelAllowed, isCountryLevel, COUNTRY_LEVEL_PAID_ONLY_MESSAGE, PlanSource } from './places-cost-guards';
import { PlanStatus } from '../tiers/plan-lookup.service';

const plans = (status: PlanStatus) => {
  const getPlanStatus = jest.fn().mockResolvedValue(status);
  return { getPlanStatus } as PlanSource & { getPlanStatus: jest.Mock };
};

describe('places cost guards: country-level is paid only', () => {
  const free = { accountId: '2255a93b-1a13-4cad-aee2-b71c7b9abd10', userId: 'u1' };
  const iwannaFind = { accountId: '88756c26-b11b-476f-9aeb-4e817b1daf92', userId: 'u2' };

  it('identifies a country filter with no lat/lng as country-level', () => {
    expect(isCountryLevel({ country: 'IT' })).toBe(true);
    expect(isCountryLevel({ country: 'IT', lat: 38.14, lng: 15.52 })).toBe(false);
    expect(isCountryLevel({ lat: 38.14, lng: 15.52 })).toBe(false);
    expect(isCountryLevel({ country: 'IT', lat: NaN, lng: NaN })).toBe(true);
  });

  it('rejects a Free account country+name query with 403 (the 5 Oct 2026 shape)', async () => {
    const err = await checkCountryLevelAllowed({ country: 'IT' }, free, plans('free')).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toBe(COUNTRY_LEVEL_PAID_ONLY_MESSAGE);
  });

  it('allows a paid account resolved live from Firestore (IwannaFind ran 325 of these in July)', async () => {
    const p = plans('paid');
    await expect(checkCountryLevelAllowed({ country: 'BM' }, iwannaFind, p)).resolves.toBeUndefined();
    expect(p.getPlanStatus).toHaveBeenCalledWith(iwannaFind.accountId);
  });

  it('FAILS OPEN when the plan is unknown (no doc, odd status, Firestore down, timeout)', async () => {
    await expect(checkCountryLevelAllowed({ country: 'BM' }, iwannaFind, plans('unknown'))).resolves.toBeUndefined();
  });

  it('lets the static override through without a Firestore lookup', async () => {
    const p = plans('free');
    await expect(checkCountryLevelAllowed({ country: 'BM' }, { ...free, isPaidAccount: true }, p)).resolves.toBeUndefined();
    expect(p.getPlanStatus).not.toHaveBeenCalled();
  });

  it('rejects a request with no account id without a lookup', async () => {
    const p = plans('paid');
    await expect(checkCountryLevelAllowed({ country: 'IT' }, undefined, p)).rejects.toBeInstanceOf(HttpException);
    expect(p.getPlanStatus).not.toHaveBeenCalled();
  });

  it('never blocks, or even looks up, radius queries whatever the plan', async () => {
    const p = plans('free');
    await expect(checkCountryLevelAllowed({ country: 'IT', lat: 38.14, lng: 15.52 }, free, p)).resolves.toBeUndefined();
    await expect(checkCountryLevelAllowed({ lat: 38.14, lng: 15.52 }, free, p)).resolves.toBeUndefined();
    expect(p.getPlanStatus).not.toHaveBeenCalled();
  });
});
