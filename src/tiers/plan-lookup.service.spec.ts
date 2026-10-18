import { activeOverride, classifyPlan, PlanLookupService } from './plan-lookup.service';

const FREE = 'price_test_free';
const PREMIUM = 'price_test_premium';

describe('classifyPlan (record shapes the portal writes)', () => {
  const free = new Set([FREE]);
  it.each([
    ['Free price, active (Free is a $0 Stripe subscription)', { planId: FREE, subscriptionStatus: 'active' }, 'free'],
    ['Free price, status "free"', { planId: FREE, subscriptionStatus: 'free' }, 'free'],
    ['planId 0, canceled', { planId: 0, subscriptionStatus: 'canceled' }, 'free'],
    ['planId 0, free', { planId: 0, subscriptionStatus: 'free' }, 'free'],
    ['paid price, active', { planId: PREMIUM, subscriptionStatus: 'active' }, 'paid'],
    ['paid price, trialing', { planId: PREMIUM, subscriptionStatus: 'trialing' }, 'paid'],
    ['paid price, past_due (grace: still paid)', { planId: PREMIUM, subscriptionStatus: 'past_due' }, 'paid'],
    ['a paid price we have never seen, active (new tier works with no code change)', { planId: 'price_new_tier', subscriptionStatus: 'active' }, 'paid'],
    ['paid price, canceled', { planId: PREMIUM, subscriptionStatus: 'canceled' }, 'free'],
    ['paid price, no status (unknown, fail open)', { planId: PREMIUM }, 'unknown'],
    ['paid price, unrecognised status (unknown, fail open)', { planId: PREMIUM, subscriptionStatus: 'paused' }, 'unknown'],
    ['empty doc', { planId: null, subscriptionStatus: null }, 'unknown'],
  ])('%s', (_label, rec, expected) => {
    expect(classifyPlan(rec as any, free)).toBe(expected);
  });
  it('treats a missing doc as unknown', () => {
    expect(classifyPlan(null, free)).toBe('unknown');
  });
  it('treats every plan as unknown (fail open) when no Free price ids are configured', () => {
    expect(classifyPlan({ planId: FREE, subscriptionStatus: 'active' }, new Set())).toBe('unknown');
    expect(classifyPlan({ planId: PREMIUM, subscriptionStatus: 'active' }, new Set())).toBe('unknown');
  });
});

describe('PlanLookupService', () => {
  let now = 1_000_000;
  const prevFree = process.env.FREE_PLAN_PRICE_IDS;
  beforeEach(() => {
    now = 1_000_000;
    process.env.FREE_PLAN_PRICE_IDS = FREE;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (prevFree === undefined) delete process.env.FREE_PLAN_PRICE_IDS; else process.env.FREE_PLAN_PRICE_IDS = prevFree;
  });

  it('caches a known plan for the TTL, then re-reads (an upgrade shows within a minute)', async () => {
    const svc = new PlanLookupService();
    const reader = jest.fn()
      .mockResolvedValueOnce({ planId: FREE, subscriptionStatus: 'active' })
      .mockResolvedValueOnce({ planId: PREMIUM, subscriptionStatus: 'active' });
    svc.setReader(reader);
    expect(await svc.getPlanStatus('acct')).toBe('free');
    now += 59_000;
    expect(await svc.getPlanStatus('acct')).toBe('free');
    expect(reader).toHaveBeenCalledTimes(1);
    now += 2_000;
    // Expired: served stale once while a background read refreshes it.
    expect(await svc.getPlanStatus('acct')).toBe('free');
    await new Promise((r) => setImmediate(r));
    expect(reader).toHaveBeenCalledTimes(2);
    expect(await svc.getPlanStatus('acct')).toBe('paid');
  });

  it('returns unknown (fail open) when Firestore errors, and retries sooner than the full TTL', async () => {
    const svc = new PlanLookupService();
    (svc as any).logger = { warn: jest.fn(), error: jest.fn() };
    const reader = jest.fn()
      .mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
      .mockResolvedValueOnce({ planId: PREMIUM, subscriptionStatus: 'active' });
    svc.setReader(reader);
    expect(await svc.getPlanStatus('acct')).toBe('unknown');
    now += 11_000;
    await svc.getPlanStatus('acct'); // stale-while-revalidate kicks off the retry
    await new Promise((r) => setImmediate(r));
    expect(reader).toHaveBeenCalledTimes(2);
    expect(await svc.getPlanStatus('acct')).toBe('paid');
  });

  it('returns unknown (fail open) when Firestore is slower than the timeout', async () => {
    jest.restoreAllMocks();
    const prev = process.env.PLAN_LOOKUP_TIMEOUT_MS;
    process.env.PLAN_LOOKUP_TIMEOUT_MS = '20';
    try {
      const svc = new PlanLookupService();
      (svc as any).logger = { warn: jest.fn(), error: jest.fn() };
      svc.setReader(() => new Promise((r) => setTimeout(() => r({ planId: FREE, subscriptionStatus: 'active' }), 200)));
      expect(await svc.getPlanStatus('slow')).toBe('unknown');
    } finally {
      if (prev === undefined) delete process.env.PLAN_LOOKUP_TIMEOUT_MS; else process.env.PLAN_LOOKUP_TIMEOUT_MS = prev;
    }
  });

  it('returns the Stripe price id with the classification', async () => {
    const svc = new PlanLookupService();
    svc.setReader(jest.fn().mockResolvedValue({ planId: PREMIUM, subscriptionStatus: 'active' }));
    expect(await svc.getPlan('acct')).toEqual({ status: 'paid', planId: PREMIUM });
  });

  it('collapses concurrent first lookups for one account into a single read', async () => {
    const svc = new PlanLookupService();
    const reader = jest.fn().mockResolvedValue({ planId: FREE, subscriptionStatus: 'active' });
    svc.setReader(reader);
    await Promise.all([svc.getPlan('acct'), svc.getPlan('acct'), svc.getPlan('acct')]);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('returns unknown when the org has no Firestore doc', async () => {
    const svc = new PlanLookupService();
    (svc as any).logger = { warn: jest.fn(), error: jest.fn() };
    svc.setReader(jest.fn().mockResolvedValue(null));
    expect(await svc.getPlanStatus('missing')).toBe('unknown');
  });

  it('treats an active override as paid, even on the Free price', async () => {
    const svc = new PlanLookupService();
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const until = new Date(now + 86_400_000);
    svc.setReader(jest.fn().mockResolvedValue({ planId: FREE, subscriptionStatus: 'active', planOverride: { plan: 'Growth', until: until.toISOString(), reason: 'test' } }));
    const plan = await svc.getPlan('acct');
    expect(plan.status).toBe('paid');
    expect(plan.planId).toBe(FREE);
    expect(plan.override).toEqual({ plan: 'Growth', until, reason: 'test' });
  });

  it('re-reads as soon as a cached override expires, rather than serving it stale', async () => {
    const svc = new PlanLookupService();
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const reader = jest.fn().mockResolvedValue({ planId: FREE, subscriptionStatus: 'active', planOverride: { plan: 'Growth', until: new Date(now + 1_000) } });
    svc.setReader(reader);
    expect(await svc.getPlanStatus('acct')).toBe('paid');
    now += 1_001; // past the override, still inside the 60s cache TTL
    expect(await svc.getPlanStatus('acct')).toBe('free');
    expect(reader).toHaveBeenCalledTimes(2);
  });
});

describe('activeOverride', () => {
  const now = Date.parse('2026-10-18T00:00:00Z');
  it.each([
    ['ISO date string', { plan: 'Growth', until: '2026-11-30' }],
    ['Date', { plan: 'Growth', until: new Date('2026-11-30') }],
    ['Firestore Timestamp', { plan: 'unlimited', until: { toDate: () => new Date('2026-11-30') } }],
  ])('accepts a future override as %s', (_label, planOverride) => {
    expect(activeOverride({ planOverride }, now)).toMatchObject({ plan: planOverride.plan, until: new Date('2026-11-30') });
  });
  it.each([
    ['expired', { plan: 'Growth', until: '2026-10-01' }],
    ['no until (an override must expire)', { plan: 'Growth' }],
    ['unparseable until', { plan: 'Growth', until: 'soon' }],
    ['no plan', { until: '2026-11-30' }],
    ['blank plan', { plan: '  ', until: '2026-11-30' }],
    ['not an object', 'Growth'],
  ])('ignores an override that is %s', (_label, planOverride) => {
    expect(activeOverride({ planOverride } as any, now)).toBeUndefined();
  });
  it('ignores a missing record', () => {
    expect(activeOverride(null, now)).toBeUndefined();
  });
});
