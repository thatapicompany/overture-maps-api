import { resolveQuotaPolicy } from './plan-limits';
import { TEST_FREE, TEST_GROWTH, TEST_PREMIUM, TEST_SCALE, useTestPlanConfig } from './test-plan-config';

const u = { accountId: 'a', userId: 'u' };

describe('resolveQuotaPolicy', () => {
  let restore: () => void;
  beforeEach(() => (restore = useTestPlanConfig()));
  afterEach(() => restore());

  it.each([
    ['Free', TEST_FREE, 'free', 100, 200],
    ['Premium', TEST_PREMIUM, 'paid', 1_000, 2_000],
    ['Growth', TEST_GROWTH, 'paid', 4_000, 6_000],
    ['Scale', TEST_SCALE, 'paid', 10_000, 20_000],
  ])('%s: allowance and soft limit from QUOTA_PLAN_LIMITS', (plan, planId, status, allowance, hardLimit) => {
    expect(resolveQuotaPolicy(u, { status: status as any, planId })).toEqual({ kind: 'limited', limits: { plan, allowance, hardLimit } });
  });

  describe('plan override on the org record', () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 1_000);
    it('uses the named plan\'s limits, matched case-insensitively', () => {
      expect(resolveQuotaPolicy(u, { status: 'paid', planId: TEST_FREE, override: { plan: 'growth', until: future } }))
        .toEqual({ kind: 'limited', limits: { plan: 'Growth', allowance: 4_000, hardLimit: 6_000 } });
    });
    it('is uncapped for "unlimited"', () => {
      expect(resolveQuotaPolicy(u, { status: 'paid', planId: TEST_FREE, override: { plan: 'unlimited', until: future } }).kind).toBe('unlimited');
    });
    it('fails open when the named plan has no configured limits', () => {
      expect(resolveQuotaPolicy(u, { status: 'paid', planId: TEST_FREE, override: { plan: 'Enterprise', until: future } }).kind).toBe('unlimited');
    });
    it('is ignored once expired', () => {
      expect(resolveQuotaPolicy(u, { status: 'free', planId: TEST_FREE, override: { plan: 'Growth', until: past } }))
        .toMatchObject({ kind: 'limited', limits: { plan: 'Free' } });
    });
  });

  it('gives lapsed or empty plans (planId 0, canceled) the Free limits', () => {
    expect(resolveQuotaPolicy(u, { status: 'free', planId: '0' })).toEqual({ kind: 'limited', limits: { plan: 'Free', allowance: 100, hardLimit: 200 } });
    expect(resolveQuotaPolicy(u, { status: 'free' })).toMatchObject({ kind: 'limited', limits: { plan: 'Free' } });
  });

  it.each([
    ['unknown plan (Firestore down, no org doc)', u, { status: 'unknown' }],
    ['a paid price with no configured limits', u, { status: 'paid', planId: 'price_new_tier' }],
    ['the demo key', { ...u, isDemoAccount: true }, { status: 'free', planId: TEST_FREE }],
    ['the PAID_ACCOUNT_IDS override', { ...u, isPaidAccount: true }, { status: 'free', planId: TEST_FREE }],
    ['no account id', undefined, { status: 'free', planId: TEST_FREE }],
  ])('is unlimited (fail open) for %s', (_label, user, plan) => {
    expect(resolveQuotaPolicy(user as any, plan as any).kind).toBe('unlimited');
  });

  it('caps nothing when QUOTA_PLAN_LIMITS is unset (self-hosted or misconfigured)', () => {
    delete process.env.QUOTA_PLAN_LIMITS;
    expect(resolveQuotaPolicy(u, { status: 'free', planId: TEST_FREE }).kind).toBe('unlimited');
    expect(resolveQuotaPolicy(u, { status: 'paid', planId: TEST_PREMIUM }).kind).toBe('unlimited');
  });

  it('caps nothing when QUOTA_PLAN_LIMITS is not valid JSON', () => {
    process.env.QUOTA_PLAN_LIMITS = '{not json';
    expect(resolveQuotaPolicy(u, { status: 'free', planId: TEST_FREE }).kind).toBe('unlimited');
  });
});
