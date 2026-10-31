import { composeNotice, nextPlan, NoticeBackend, noticeKindFor, QuotaNoticeService } from './quota-notices';
import { useTestPlanConfig } from './test-plan-config';

const NOW = new Date(Date.UTC(2026, 9, 18, 12));
const HOUR = 3_600_000;
const ctx = (used: number, plan = 'Free', allowance = 100, hardLimit = 200, now = NOW) => ({ accountId: 'acct-1', plan, used, allowance, hardLimit, now });

function fakes(opts: { claimed?: boolean; emails?: string[]; mailerThrows?: boolean; firstSeen?: Date; recent?: boolean | 'throw' } = {}) {
  const claims = new Set<string>();
  const seen = new Map<string, Date>();
  // By default the account passed its allowance two days ago, so the delay is over.
  seen.set('acct-1_2026-10:allowance', opts.firstSeen ?? new Date(NOW.getTime() - 48 * HOUR));
  const backend: NoticeBackend & { records: any[] } = {
    records: [],
    claim: jest.fn(async (doc, kind) => {
      if (opts.claimed === false || claims.has(`${doc}:${kind}`)) return false;
      claims.add(`${doc}:${kind}`);
      return true;
    }),
    firstSeen: jest.fn(async (doc, kind, at) => {
      const k = `${doc}:${kind}`;
      if (!seen.has(k)) seen.set(k, at);
      return seen.get(k) as Date;
    }),
    record: jest.fn(async (doc, kind, data) => void backend.records.push({ doc, kind, data })),
    recipients: jest.fn(async () => ({ orgName: 'Example Co', emails: opts.emails ?? ['a@example.com', 'b@example.com'] })),
  };
  const mailer = jest.fn(async () => {
    if (opts.mailerThrows) throw new Error('postmark down');
    return 'msg-1';
  });
  const history = jest.fn(async () => {
    if (opts.recent === 'throw') throw new Error('postmark down');
    return opts.recent === true;
  });
  const svc = new QuotaNoticeService();
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.configure(backend, mailer, history);
  return { svc, backend, mailer, history, claims };
}

describe('quota notices', () => {
  const prevMode = process.env.QUOTA_NOTICE_MODE;
  let restore: () => void;
  beforeEach(() => {
    restore = useTestPlanConfig();
    process.env.QUOTA_NOTICE_MODE = 'send';
  });
  afterEach(() => {
    restore();
    if (prevMode === undefined) delete process.env.QUOTA_NOTICE_MODE; else process.env.QUOTA_NOTICE_MODE = prevMode;
  });

  it('picks the notice from usage', () => {
    expect(noticeKindFor(99, 100, 200)).toBeNull();
    expect(noticeKindFor(100, 100, 200)).toBe('allowance');
    expect(noticeKindFor(199, 100, 200)).toBe('allowance');
    expect(noticeKindFor(200, 100, 200)).toBe('limit');
  });

  it('suggests the next plan up, and none above the top plan', () => {
    expect(nextPlan({ plan: 'Free', allowance: 100 })?.plan).toBe('Premium');
    expect(nextPlan({ plan: 'Premium', allowance: 1_000 })?.plan).toBe('Growth');
    expect(nextPlan({ plan: 'Scale', allowance: 10_000 })).toBeUndefined();
  });

  it('writes an allowance email with the numbers, reset date and next plan', () => {
    const { subject, text } = composeNotice('allowance', ctx(150), 'Example Co');
    expect(subject).toContain('passed its monthly allowance');
    expect(text).toContain('Your Example Co account has made 150 requests');
    expect(text).toContain('past the 100 included in the Free plan');
    expect(text).toContain('Requests keep working up to 200');
    expect(text).toContain('00:00 UTC on 1 November');
    expect(text).toContain('the Premium plan includes 1,000 requests a month');
    expect(text).not.toMatch(/[–—]/);
  });

  it('writes a limit email, and offers a custom plan above the top plan', () => {
    const free = composeNotice('limit', ctx(200), undefined);
    expect(free.subject).toContain('reached its monthly limit');
    expect(free.text).toContain('Your account has reached 200 requests');
    expect(free.text).toContain('keeps serving up to 2,000');
    const scale = composeNotice('limit', ctx(20_000, 'Scale', 10_000, 20_000), 'Example Co');
    expect(scale.text).toContain('custom plan');
    expect(scale.text).not.toMatch(/[–—]/);
  });

  it('does nothing when off (the default)', async () => {
    delete process.env.QUOTA_NOTICE_MODE;
    const f = fakes();
    await expect(f.svc.notify(ctx(150))).resolves.toBe('off');
    expect(f.backend.claim).not.toHaveBeenCalled();
    expect(f.mailer).not.toHaveBeenCalled();
  });

  it('only logs in log mode, writing and sending nothing', async () => {
    process.env.QUOTA_NOTICE_MODE = 'log';
    const f = fakes();
    await expect(f.svc.notify(ctx(150))).resolves.toBe('logged');
    expect(f.backend.recipients).toHaveBeenCalled();
    expect(f.backend.claim).not.toHaveBeenCalled();
    expect(f.mailer).not.toHaveBeenCalled();
  });

  it('claims, sends to every member and records the message id, once per kind per month', async () => {
    const f = fakes();
    await expect(f.svc.notify(ctx(150))).resolves.toBe('sent');
    expect(f.mailer).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@example.com', 'b@example.com'] }));
    expect(f.backend.records[0]).toMatchObject({ doc: 'acct-1_2026-10', kind: 'allowance', data: { status: 'sent', messageId: 'msg-1' } });
    await expect(f.svc.notify(ctx(160))).resolves.toBe('handled');
    expect(f.mailer).toHaveBeenCalledTimes(1);
    // Reaching the limit is a separate notice.
    await expect(f.svc.notify(ctx(200))).resolves.toBe('sent');
    expect(f.mailer).toHaveBeenCalledTimes(2);
  });

  it('holds the allowance notice for a day after the account passes its allowance', async () => {
    const f = fakes({ firstSeen: NOW });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('waiting');
    expect(f.backend.claim).not.toHaveBeenCalled();
    // Same instance, an hour later: still inside the delay, not even looked up again.
    await expect(f.svc.notify(ctx(160, 'Free', 100, 200, new Date(NOW.getTime() + HOUR)))).resolves.toBe('handled');
    // A day later and still under the limit: it goes.
    await expect(f.svc.notify(ctx(170, 'Free', 100, 200, new Date(NOW.getTime() + 25 * HOUR)))).resolves.toBe('sent');
    expect(f.mailer).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining('passed its monthly allowance') }));
  });

  it('sends only the limit notice when an account burns through both in one go', async () => {
    const f = fakes({ firstSeen: NOW });
    await expect(f.svc.notify(ctx(120))).resolves.toBe('waiting');
    await expect(f.svc.notify(ctx(200, 'Free', 100, 200, new Date(NOW.getTime() + 6 * 60_000)))).resolves.toBe('sent');
    expect(f.mailer).toHaveBeenCalledTimes(1);
    expect(f.mailer).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining('reached its monthly limit') }));
    // The allowance notice is marked as covered, so it can never follow later.
    expect(f.claims.has('acct-1_2026-10:allowance')).toBe(true);
  });

  it('holds the allowance notice while the team has had another email in the last day', async () => {
    const f = fakes({ recent: true });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('recently-emailed');
    expect(f.backend.claim).not.toHaveBeenCalled();
    expect(f.mailer).not.toHaveBeenCalled();
  });

  it('treats a failed mail history check as recent and waits', async () => {
    const f = fakes({ recent: 'throw' });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('recently-emailed');
    expect(f.mailer).not.toHaveBeenCalled();
  });

  it('sends the limit notice even after a recent email, because requests are being refused', async () => {
    const f = fakes({ recent: true });
    await expect(f.svc.notify(ctx(200))).resolves.toBe('sent');
    expect(f.history).not.toHaveBeenCalled();
  });

  it('sends nothing when another instance already claimed it', async () => {
    const f = fakes({ claimed: false });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('claimed-elsewhere');
    expect(f.mailer).not.toHaveBeenCalled();
  });

  it('records a failed send and does not retry it', async () => {
    const f = fakes({ mailerThrows: true });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('failed');
    expect(f.backend.records[0]).toMatchObject({ kind: 'allowance', data: { status: 'failed', error: 'postmark down' } });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('handled');
    expect(f.mailer).toHaveBeenCalledTimes(1);
  });

  it('records when an account has no member emails', async () => {
    const f = fakes({ emails: [] });
    await expect(f.svc.notify(ctx(150))).resolves.toBe('no-recipients');
    expect(f.mailer).not.toHaveBeenCalled();
    expect(f.backend.records[0].data.status).toBe('no-recipients');
  });

  it('never throws, even when the backend does', async () => {
    const f = fakes();
    (f.backend.claim as jest.Mock).mockRejectedValueOnce(new Error('firestore down'));
    await expect(f.svc.notify(ctx(150))).resolves.toBe('failed');
  });

  it('gives up waiting after QUOTA_NOTICE_TIMEOUT_MS', async () => {
    process.env.QUOTA_NOTICE_TIMEOUT_MS = '20';
    const f = fakes();
    (f.backend.claim as jest.Mock).mockImplementationOnce(() => new Promise(() => undefined));
    await expect(f.svc.notify(ctx(150))).resolves.toBe('handled');
    delete process.env.QUOTA_NOTICE_TIMEOUT_MS;
  });
});
