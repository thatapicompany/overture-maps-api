import { httpPlanSource, planSourceFromEnv } from './plan-source';

describe('plan sources', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('defaults to none when nothing is configured', () => {
    delete process.env.PLAN_SOURCE;
    delete process.env.PLAN_FIRESTORE_PROJECT_ID;
    expect(planSourceFromEnv().name).toBe('none');
  });

  it('defaults to firestore when a Firestore project is set', () => {
    delete process.env.PLAN_SOURCE;
    process.env.PLAN_FIRESTORE_PROJECT_ID = 'some-project';
    expect(planSourceFromEnv().name).toBe('firestore');
  });

  it('uses http when asked, and falls back to none without a URL', () => {
    process.env.PLAN_SOURCE = 'http';
    delete process.env.PLAN_SOURCE_URL;
    expect(planSourceFromEnv().name).toBe('none');
    process.env.PLAN_SOURCE_URL = 'https://plans.example.com/accounts';
    expect(planSourceFromEnv().name).toBe('http');
  });

  it('http reads the record, treats 404 as none, and throws on other errors', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const fake = (status: number, body?: unknown) => (async (url: any, init: any) => {
      calls.push({ url: String(url), auth: init?.headers?.authorization });
      return { status, ok: status >= 200 && status < 300, json: async () => body } as any;
    }) as typeof fetch;

    const ok = httpPlanSource('https://plans.example.com/accounts/', 'tok', fake(200, { planId: 'price_x', subscriptionStatus: 'active' }));
    await expect(ok.read('acct 1')).resolves.toEqual({ planId: 'price_x', subscriptionStatus: 'active' });
    expect(calls[0]).toEqual({ url: 'https://plans.example.com/accounts/acct%201', auth: 'Bearer tok' });

    await expect(httpPlanSource('https://p', undefined, fake(404)).read('a')).resolves.toBeNull();
    await expect(httpPlanSource('https://p', undefined, fake(500)).read('a')).rejects.toThrow('500');
  });
});
