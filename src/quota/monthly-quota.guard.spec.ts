import { EventEmitter } from 'events';
import { HttpException } from '@nestjs/common';
import { MonthlyQuotaGuard } from './monthly-quota.guard';
import { FREE_PRICE_ID } from './plan-limits';

const PREMIUM = 'price_1TrXjeKqcwz1EdQW6pCjusja';

function harness(opts: { plan?: any; used?: number | null; user?: any; planThrows?: boolean }) {
  const plans = {
    getPlan: jest.fn(async () => {
      if (opts.planThrows) throw new Error('boom');
      return opts.plan ?? { status: 'free', planId: FREE_PRICE_ID };
    }),
  };
  const counter = { current: jest.fn(async () => (opts.used === undefined ? 0 : opts.used)), record: jest.fn(), flushSoon: jest.fn() };
  const guard = new MonthlyQuotaGuard(plans as any, counter as any);
  (guard as any).logger = { warn: jest.fn(), error: jest.fn() };
  const res: any = Object.assign(new EventEmitter(), { headers: {} as Record<string, string>, locals: {}, statusCode: 200 });
  res.setHeader = (k: string, v: string) => (res.headers[k] = v);
  const req: any = { user: 'user' in opts ? opts.user : { accountId: 'acct', userId: 'u' } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  return { guard, plans, counter, res, ctx };
}

describe('MonthlyQuotaGuard', () => {
  const prevMode = process.env.QUOTA_MODE;
  afterEach(() => {
    if (prevMode === undefined) delete process.env.QUOTA_MODE; else process.env.QUOTA_MODE = prevMode;
  });

  it('allows a Free account under its allowance and sets usage headers', async () => {
    const h = harness({ used: 40 });
    await expect(h.guard.canActivate(h.ctx)).resolves.toBe(true);
    expect(h.res.headers).toMatchObject({ 'X-Quota-Plan': 'Free', 'X-Quota-Limit': '100', 'X-Quota-Hard-Limit': '200', 'X-Quota-Used': '40', 'X-Quota-Remaining': '60' });
    expect(h.res.headers['X-Quota-Warning']).toBeUndefined();
  });

  it('warns but allows between the allowance (100) and the soft limit (200)', async () => {
    const h = harness({ used: 150 });
    await expect(h.guard.canActivate(h.ctx)).resolves.toBe(true);
    expect(h.res.headers['X-Quota-Remaining']).toBe('0');
    expect(h.res.headers['X-Quota-Warning']).toContain('refused from 200');
  });

  it('blocks a Free account at 200 with 429, Retry-After and a plan-specific message', async () => {
    const h = harness({ used: 200 });
    const err = await h.guard.canActivate(h.ctx).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ error: 'monthly_quota_exceeded' });
    expect(err.getResponse().message).toContain('200 requests this month on the Free plan');
    expect(err.getResponse().message).toContain('00:00 UTC on 1 ');
    expect(Number(h.res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('blocks a paid plan at its own soft limit (Premium: 2,000)', async () => {
    const ok = harness({ plan: { status: 'paid', planId: PREMIUM }, used: 1_999 });
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);
    const blocked = harness({ plan: { status: 'paid', planId: PREMIUM }, used: 2_000 });
    await expect(blocked.guard.canActivate(blocked.ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('starts pending flushes from the request path, where Cloud Run allocates CPU', async () => {
    const h = harness({ used: 10 });
    await h.guard.canActivate(h.ctx);
    expect(h.counter.flushSoon).toHaveBeenCalledTimes(1);
  });

  it('charges only requests that finish below 400', async () => {
    const h = harness({ used: 10 });
    await h.guard.canActivate(h.ctx);
    h.res.statusCode = 200;
    h.res.emit('finish');
    expect(h.counter.record).toHaveBeenCalledTimes(1);
    const bad = harness({ used: 10 });
    await bad.guard.canActivate(bad.ctx);
    bad.res.statusCode = 403;
    bad.res.emit('finish');
    expect(bad.counter.record).not.toHaveBeenCalled();
  });

  it('does not charge the 429 it returns', async () => {
    const h = harness({ used: 500 });
    await h.guard.canActivate(h.ctx).catch(() => undefined);
    h.res.statusCode = 429;
    h.res.emit('finish');
    expect(h.counter.record).not.toHaveBeenCalled();
  });

  it('in log mode, counts and sets headers but never blocks', async () => {
    process.env.QUOTA_MODE = 'log';
    const h = harness({ used: 5_000 });
    await expect(h.guard.canActivate(h.ctx)).resolves.toBe(true);
    expect(h.res.headers['X-Quota-Used']).toBe('5000');
  });

  it('does nothing in off mode', async () => {
    process.env.QUOTA_MODE = 'off';
    const h = harness({ used: 5_000 });
    await expect(h.guard.canActivate(h.ctx)).resolves.toBe(true);
    expect(h.plans.getPlan).not.toHaveBeenCalled();
  });

  it.each([
    ['the counter is unavailable', { used: null }],
    ['the plan lookup throws', { planThrows: true }],
    ['the plan is unknown', { plan: { status: 'unknown' }, used: 10_000 }],
  ])('fails open when %s', async (_l, opts) => {
    const h = harness(opts as any);
    await expect(h.guard.canActivate(h.ctx)).resolves.toBe(true);
  });

  it('skips the demo key, the paid override and unauthenticated requests without a lookup', async () => {
    for (const user of [{ accountId: 'demo-account-id', userId: 'd', isDemoAccount: true }, undefined]) {
      const h = harness({ user, used: 10_000 });
      await expect(h.guard.canActivate(h.ctx)).resolves.toBe(true);
      expect(h.plans.getPlan).not.toHaveBeenCalled();
    }
    const o = harness({ user: { accountId: 'vip', userId: 'v', isPaidAccount: true }, used: 10_000 });
    await expect(o.guard.canActivate(o.ctx)).resolves.toBe(true);
    expect(o.plans.getPlan).not.toHaveBeenCalled();
  });
});
