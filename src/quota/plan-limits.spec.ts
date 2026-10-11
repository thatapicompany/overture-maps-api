import { FREE_PRICE_ID, resolveQuotaPolicy } from './plan-limits';

const PREMIUM = 'price_1TrXjeKqcwz1EdQW6pCjusja';
const GROWTH = 'price_1U5cMcKqcwz1EdQW6XBfp9n8';
const SCALE = 'price_1TrXrEKqcwz1EdQWVxtForrI';
const u = { accountId: 'a', userId: 'u' };

describe('resolveQuotaPolicy (limits from Stripe product metadata, 11 Oct 2026)', () => {
  it.each([
    ['Free', FREE_PRICE_ID, 'free', 100, 200],
    ['Premium', PREMIUM, 'paid', 1_000, 2_000],
    ['Growth', GROWTH, 'paid', 4_000, 6_000],
    ['Scale', SCALE, 'paid', 10_000, 20_000],
  ])('%s: allowance and soft limit', (plan, planId, status, allowance, hardLimit) => {
    expect(resolveQuotaPolicy(u, { status: status as any, planId })).toEqual({ kind: 'limited', limits: { plan, allowance, hardLimit } });
  });

  it('gives lapsed or empty plans (planId 0, canceled) the Free limits', () => {
    expect(resolveQuotaPolicy(u, { status: 'free', planId: '0' })).toEqual({ kind: 'limited', limits: { plan: 'Free', allowance: 100, hardLimit: 200 } });
    expect(resolveQuotaPolicy(u, { status: 'free' })).toMatchObject({ kind: 'limited', limits: { plan: 'Free' } });
  });

  it.each([
    ['unknown plan (Firestore down, no org doc)', u, { status: 'unknown' }],
    ['a paid price with no configured limits', u, { status: 'paid', planId: 'price_new_tier' }],
    ['the demo key', { ...u, isDemoAccount: true }, { status: 'free', planId: FREE_PRICE_ID }],
    ['the PAID_ACCOUNT_IDS override', { ...u, isPaidAccount: true }, { status: 'free', planId: FREE_PRICE_ID }],
    ['no account id', undefined, { status: 'free', planId: FREE_PRICE_ID }],
  ])('is unlimited (fail open) for %s', (_label, user, plan) => {
    expect(resolveQuotaPolicy(user as any, plan as any).kind).toBe('unlimited');
  });

  it('accepts overrides and new prices from QUOTA_PLAN_LIMITS', () => {
    const prev = process.env.QUOTA_PLAN_LIMITS;
    process.env.QUOTA_PLAN_LIMITS = JSON.stringify({ price_enterprise: { plan: 'Enterprise', allowance: 50_000, hardLimit: 100_000 } });
    try {
      expect(resolveQuotaPolicy(u, { status: 'paid', planId: 'price_enterprise' })).toMatchObject({ kind: 'limited', limits: { hardLimit: 100_000 } });
      expect(resolveQuotaPolicy(u, { status: 'paid', planId: PREMIUM })).toMatchObject({ limits: { hardLimit: 2_000 } });
    } finally {
      if (prev === undefined) delete process.env.QUOTA_PLAN_LIMITS; else process.env.QUOTA_PLAN_LIMITS = prev;
    }
  });
});
