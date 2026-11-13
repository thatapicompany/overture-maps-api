import { QuotaEventPublisher, quotaEventKind, QuotaEvent } from './quota-events';

describe('quotaEventKind', () => {
  it('is null under the allowance, allowance past it, limit at the hard limit', () => {
    expect(quotaEventKind(99, 100, 200)).toBeNull();
    expect(quotaEventKind(100, 100, 200)).toBe('allowance');
    expect(quotaEventKind(200, 100, 200)).toBe('limit');
  });
});

describe('QuotaEventPublisher', () => {
  const base = { accountId: 'acct-1', plan: 'Free', used: 150, allowance: 100, hardLimit: 200 };
  const now = new Date('2026-11-13T00:00:00Z');
  let sent: { topic: string; event: QuotaEvent }[];
  let pub: QuotaEventPublisher;

  beforeEach(() => {
    sent = [];
    pub = new QuotaEventPublisher();
    pub.configure(async (topic, event) => { sent.push({ topic, event }); });
    process.env.QUOTA_EVENTS_TOPIC = 'quota-events';
    delete process.env.QUOTA_EVENTS_INTERVAL_MINUTES;
  });
  afterAll(() => { delete process.env.QUOTA_EVENTS_TOPIC; });

  it('does nothing without a topic', async () => {
    delete process.env.QUOTA_EVENTS_TOPIC;
    expect(await pub.publish({ ...base, now })).toBe('off');
    expect(sent).toHaveLength(0);
  });

  it('publishes the event with its kind and time', async () => {
    expect(await pub.publish({ ...base, now })).toBe('published');
    expect(sent[0]).toEqual({ topic: 'quota-events', event: { ...base, kind: 'allowance', at: now.toISOString() } });
  });

  it('publishes once per account and kind per interval, and again when the kind changes', async () => {
    await pub.publish({ ...base, now });
    expect(await pub.publish({ ...base, used: 160, now: new Date(now.getTime() + 10 * 60_000) })).toBe('throttled');
    expect(await pub.publish({ ...base, used: 200, now: new Date(now.getTime() + 11 * 60_000) })).toBe('published');
    expect(await pub.publish({ ...base, used: 170, now: new Date(now.getTime() + 61 * 60_000) })).toBe('published');
    expect(sent.map((s) => s.event.kind)).toEqual(['allowance', 'limit', 'allowance']);
  });

  it('never throws, and retries on the next request after a failure', async () => {
    pub.configure(async () => { throw new Error('boom'); });
    expect(await pub.publish({ ...base, now })).toBe('failed');
    pub.configure(async (topic, event) => { sent.push({ topic, event }); });
    expect(await pub.publish({ ...base, now })).toBe('published');
  });
});
