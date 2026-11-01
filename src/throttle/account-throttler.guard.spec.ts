import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AccountThrottlerGuard, rateLimitedMessage } from './account-throttler.guard';
import { usageStorage, UsageStore } from '../usage/usage.context';

// Fake values only: no real accounts here.
function ctxFor(user: any, ip = '10.0.0.1') {
  const headers: Record<string, any> = {};
  const res: any = { locals: { user }, header: (k: string, v: any) => { headers[k] = v; } };
  const req: any = { ip, headers: {}, res, user };
  class FakeController {}
  const context = {
    getClass: () => FakeController,
    getHandler: () => function handler() {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

async function makeGuard(planStatus: 'paid' | 'free' | 'unknown' | 'throws') {
  const plans: any = {
    getPlan: jest.fn(async () => {
      if (planStatus === 'throws') throw new Error('firestore down');
      return { status: planStatus };
    }),
  };
  const storage = new ThrottlerStorageService();
  const guard = new AccountThrottlerGuard({ throttlers: [{ ttl: 60000, limit: 3 }] } as any, storage, new Reflector(), plans);
  await guard.onModuleInit();
  return { guard, storage };
}

async function hits(guard: AccountThrottlerGuard, context: ExecutionContext, n: number) {
  let blocked = 0;
  for (let i = 0; i < n; i++) {
    try { await guard.canActivate(context); } catch (e) { if (e instanceof HttpException && e.getStatus() === 429) blocked++; else throw e; }
  }
  return blocked;
}

describe('AccountThrottlerGuard', () => {
  const prev = process.env.THROTTLE_LIMIT_PAID;
  beforeEach(() => { process.env.THROTTLE_LIMIT_PAID = '5'; });
  afterEach(() => { if (prev === undefined) delete process.env.THROTTLE_LIMIT_PAID; else process.env.THROTTLE_LIMIT_PAID = prev; });

  it('gives Free accounts the base limit', async () => {
    const { guard, storage } = await makeGuard('free');
    const { context, headers } = ctxFor({ accountId: 'acct-free-1' });
    expect(await hits(guard, context, 5)).toBe(2);
    expect(headers['X-RateLimit-Limit']).toBe(3);
    storage.onApplicationShutdown();
  });

  it('gives paid accounts the paid limit', async () => {
    const { guard, storage } = await makeGuard('paid');
    const { context } = ctxFor({ accountId: 'acct-paid-1' });
    expect(await hits(guard, context, 6)).toBe(1);
    storage.onApplicationShutdown();
  });

  it('uses the paid limit when the plan is unknown or the lookup fails', async () => {
    for (const status of ['unknown', 'throws'] as const) {
      const { guard, storage } = await makeGuard(status);
      const { context } = ctxFor({ accountId: `acct-${status}` });
      expect(await hits(guard, context, 5)).toBe(0);
      storage.onApplicationShutdown();
    }
  });

  it('counts per account, so two accounts on one IP do not share a bucket', async () => {
    const { guard, storage } = await makeGuard('free');
    const a = ctxFor({ accountId: 'acct-a' }, '10.0.0.9');
    const b = ctxFor({ accountId: 'acct-b' }, '10.0.0.9');
    expect(await hits(guard, a.context, 3)).toBe(0);
    expect(await hits(guard, b.context, 3)).toBe(0);
    storage.onApplicationShutdown();
  });

  it('counts the shared demo account per IP', async () => {
    const { guard, storage } = await makeGuard('free');
    const one = ctxFor({ accountId: 'demo', isDemoAccount: true }, '10.0.0.1');
    const two = ctxFor({ accountId: 'demo', isDemoAccount: true }, '10.0.0.2');
    expect(await hits(guard, one.context, 4)).toBe(1);
    expect(await hits(guard, two.context, 3)).toBe(0);
    storage.onApplicationShutdown();
  });

  it('names the limit in the 429 body, with an upgrade link only for Free', async () => {
    expect(rateLimitedMessage(60, 60000, false)).toMatch(/allows 60 requests a minute.*upgrade/);
    expect(rateLimitedMessage(120, 60000, true)).not.toMatch(/upgrade/);
    const { guard, storage } = await makeGuard('free');
    const { context } = ctxFor({ accountId: 'acct-free-2' });
    await hits(guard, context, 3);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ response: { error: 'rate_limited' } });
    storage.onApplicationShutdown();
  });

  it('records rate_limited on the usage row when it refuses', async () => {
    const { guard, storage } = await makeGuard('free');
    const { context } = ctxFor({ accountId: 'acct-free-3' });
    const store: UsageStore = { requestId: 'req-1', startTime: Date.now(), jobs: [] };
    await usageStorage.run(store, async () => {
      await hits(guard, context, 3);
      expect(store.error).toBeUndefined();
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    });
    expect(store.error).toBe('rate_limited');
    storage.onApplicationShutdown();
  });
});
