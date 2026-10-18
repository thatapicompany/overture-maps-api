import { Injectable, Logger } from '@nestjs/common';
import { ACCOUNT_URL, PRICING_URL } from '../common/links';
import { portalFirestore, portalFirestoreConfigured } from '../tiers/portal-firestore';
import { PlanLimits, planLimitsTable } from './plan-limits';
import { monthKey, nextMonthStartUtc } from './usage-counter.store';

// Emails an account's team when its monthly usage passes the plan allowance,
// and again when requests start being refused: at most once each per account
// per UTC month. Called from MonthlyQuotaGuard; never throws and never blocks
// a request for longer than QUOTA_NOTICE_TIMEOUT_MS.
//
// QUOTA_NOTICE_MODE: off (default) | log | send.
//   log   resolves recipients and logs what it would send. Writes nothing.
//   send  claims the notice on the account's monthly counter doc in a
//         Firestore transaction, so exactly one instance sends it, then sends
//         through Postmark's transactional stream.
//
// A claimed notice is never retried. A failed or ambiguous send is recorded on
// the counter doc and logged instead, because retrying after an ambiguous
// failure is how people get the same email twice.
//
// Accounts on a manual plan override get no notices (the guard skips them):
// whoever set the override is already talking to that account.

export type NoticeKind = 'allowance' | 'limit';

export interface NoticeContext {
  accountId: string;
  plan: string;
  used: number;
  allowance: number;
  hardLimit: number;
  now: Date;
}

export interface Recipients {
  orgName?: string;
  emails: string[];
}

export interface NoticeBackend {
  /** Claim this month's notice of this kind. False if it was already claimed. */
  claim(docId: string, kind: NoticeKind, data: Record<string, unknown>): Promise<boolean>;
  /** Record what happened after a claim. */
  record(docId: string, kind: NoticeKind, data: Record<string, unknown>): Promise<void>;
  recipients(accountId: string): Promise<Recipients>;
}

export interface OutgoingNotice {
  to: string[];
  subject: string;
  text: string;
}

/** Sends one email; resolves to the provider's message id. */
export type Mailer = (msg: OutgoingNotice) => Promise<string>;

export type NoticeOutcome = 'off' | 'none' | 'handled' | 'logged' | 'claimed-elsewhere' | 'no-recipients' | 'sent' | 'failed';

const fmt = (n: number) => n.toLocaleString('en-GB');

const envInt = (name: string, fallback: number): number => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function noticeMode(): 'off' | 'log' | 'send' {
  const m = (process.env.QUOTA_NOTICE_MODE || 'off').toLowerCase();
  return m === 'log' || m === 'send' ? m : 'off';
}

/** Which notice this usage calls for, if any. */
export function noticeKindFor(used: number, allowance: number, hardLimit: number): NoticeKind | null {
  if (used >= hardLimit) return 'limit';
  if (used >= allowance) return 'allowance';
  return null;
}

/** The plan with the next larger allowance, from QUOTA_PLAN_LIMITS. */
export function nextPlan(current: { plan: string; allowance: number }): PlanLimits | undefined {
  const byName = new Map<string, PlanLimits>();
  for (const l of Object.values(planLimitsTable())) {
    if (!l?.plan || l.plan.toLowerCase() === current.plan.toLowerCase()) continue;
    const seen = byName.get(l.plan.toLowerCase());
    if (!seen || l.allowance < seen.allowance) byName.set(l.plan.toLowerCase(), l);
  }
  return [...byName.values()].filter((l) => l.allowance > current.allowance).sort((a, b) => a.allowance - b.allowance)[0];
}

export function composeNotice(kind: NoticeKind, ctx: NoticeContext, orgName?: string): { subject: string; text: string } {
  const reset = nextMonthStartUtc(ctx.now).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const account = orgName ? `Your ${orgName} account` : 'Your account';
  const next = nextPlan(ctx);
  const signoff = process.env.QUOTA_NOTICE_FROM_NAME || 'The Overture Maps API team';
  const lines: string[] = ['Hi there,', ''];
  let subject: string;

  if (kind === 'allowance') {
    subject = 'Your Overture Maps API account has passed its monthly allowance';
    lines.push(
      `${account} has made ${fmt(ctx.used)} requests to the Overture Maps API this month, past the ${fmt(ctx.allowance)} included in the ${ctx.plan} plan.`,
      '',
      `Nothing has been cut off. Requests keep working up to ${fmt(ctx.hardLimit)} this month. From then on they are refused until the count resets at 00:00 UTC on ${reset}.`,
      '',
      next
        ? `If this is your usual level of use, the ${next.plan} plan includes ${fmt(next.allowance)} requests a month. Plans are at ${PRICING_URL} and you can change yours at ${ACCOUNT_URL}.`
        : `If you need more than the ${ctx.plan} plan allows, reply to this email and we can set up a custom plan.`,
      '',
      'Every API response also carries X-Quota-Used and X-Quota-Remaining headers, if you would like to track this in your app.',
    );
  } else {
    subject = 'Your Overture Maps API account has reached its monthly limit';
    lines.push(
      `${account} has reached ${fmt(ctx.hardLimit)} requests to the Overture Maps API this month, the limit on the ${ctx.plan} plan. Requests now return a 429 until the count resets at 00:00 UTC on ${reset}.`,
      '',
      next
        ? `Upgrading lifts the limit within a minute. The ${next.plan} plan includes ${fmt(next.allowance)} requests a month and keeps serving up to ${fmt(next.hardLimit)}. You can change plan at ${ACCOUNT_URL}, and every plan is at ${PRICING_URL}.`
        : 'Reply to this email and we can set up a custom plan to get you running again.',
      '',
      "If something unexpected caused this, such as a retry loop, reply and we'll take a look.",
    );
  }
  lines.push('', 'Best,', signoff);
  return { subject, text: lines.join('\n') };
}

@Injectable()
export class QuotaNoticeService {
  private readonly logger = new Logger('QuotaNotices');
  /** `${docId}:${kind}` this instance has already dealt with. */
  private readonly handled = new Set<string>();
  private backend?: NoticeBackend;
  private mailer?: Mailer;

  /** Test seam. Production builds Firestore and Postmark adapters lazily. */
  configure(backend: NoticeBackend, mailer: Mailer): void {
    this.backend = backend;
    this.mailer = mailer;
    this.handled.clear();
  }

  /** Never throws; waits at most QUOTA_NOTICE_TIMEOUT_MS. */
  async notify(ctx: NoticeContext): Promise<NoticeOutcome> {
    if (noticeMode() === 'off') return 'off';
    const ms = envInt('QUOTA_NOTICE_TIMEOUT_MS', 4_000);
    let timer: NodeJS.Timeout | undefined;
    const work = this.run(ctx).catch((err: any) => {
      this.logger.error(`Quota notice for account ${ctx.accountId} failed: ${err?.message ?? err}`);
      return 'failed' as NoticeOutcome;
    });
    const timeout = new Promise<NoticeOutcome>((resolve) => {
      timer = setTimeout(() => resolve('handled'), ms);
      timer.unref?.();
    });
    return Promise.race([work, timeout]).finally(() => timer && clearTimeout(timer));
  }

  private async run(ctx: NoticeContext): Promise<NoticeOutcome> {
    const kind = noticeKindFor(ctx.used, ctx.allowance, ctx.hardLimit);
    if (!kind) return 'none';
    const docId = `${ctx.accountId}_${monthKey(ctx.now)}`;
    const handledKey = `${docId}:${kind}`;
    if (this.handled.has(handledKey)) return 'handled';
    if (this.handled.size > 10_000) this.handled.clear();
    // Mark before any await, so concurrent requests on this instance do one lookup.
    this.handled.add(handledKey);

    const backend = this.getBackend();
    const mode = noticeMode();

    if (mode === 'log') {
      const r = await backend.recipients(ctx.accountId);
      const { subject } = composeNotice(kind, ctx, r.orgName);
      this.logger.log(`[log mode] would send "${subject}" to ${r.emails.length} recipient(s) for account ${ctx.accountId} (${fmt(ctx.used)} on ${ctx.plan}).`);
      return 'logged';
    }

    const claimed = await backend.claim(docId, kind, { claimedAt: new Date(), plan: ctx.plan, used: ctx.used });
    if (!claimed) return 'claimed-elsewhere';

    try {
      const r = await backend.recipients(ctx.accountId);
      if (!r.emails.length) {
        await backend.record(docId, kind, { status: 'no-recipients', at: new Date() });
        this.logger.warn(`Quota notice (${kind}) for account ${ctx.accountId}: no member emails found; nothing sent.`);
        return 'no-recipients';
      }
      const { subject, text } = composeNotice(kind, ctx, r.orgName);
      const messageId = await this.getMailer()({ to: r.emails, subject, text });
      await backend.record(docId, kind, { status: 'sent', at: new Date(), messageId, recipients: r.emails.length });
      this.logger.log(`Sent quota notice (${kind}) for account ${ctx.accountId} to ${r.emails.length} recipient(s).`);
      return 'sent';
    } catch (err: any) {
      // Not retried: the email may have gone even though we saw an error.
      await backend.record(docId, kind, { status: 'failed', at: new Date(), error: String(err?.message ?? err).slice(0, 500) }).catch(() => undefined);
      this.logger.error(`Quota notice (${kind}) for account ${ctx.accountId} failed and will not be retried: ${err?.message ?? err}`);
      return 'failed';
    }
  }

  private getBackend(): NoticeBackend {
    if (!this.backend) this.backend = firestoreNoticeBackend();
    return this.backend;
  }

  private getMailer(): Mailer {
    if (!this.mailer) this.mailer = postmarkMailer();
    return this.mailer;
  }
}

function firestoreNoticeBackend(): NoticeBackend {
  if (!portalFirestoreConfigured()) throw new Error('PLAN_FIRESTORE_PROJECT_ID is not set; quota notices are disabled.');
  const db = () => portalFirestore();
  const counters = () => db().collection(process.env.QUOTA_FIRESTORE_COLLECTION || 'api_usage_monthly');
  return {
    async claim(docId, kind, data) {
      const ref = counters().doc(docId);
      return db().runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data()?.notices?.[kind]) return false;
        tx.set(ref, { notices: { [kind]: data } }, { merge: true });
        return true;
      });
    },
    async record(docId, kind, data) {
      await counters().doc(docId).set({ notices: { [kind]: { result: data } } }, { merge: true });
    },
    async recipients(accountId) {
      const orgs = process.env.PLAN_FIRESTORE_COLLECTION || 'organizations';
      const org = (await db().collection(orgs).doc(accountId).get()).data() || {};
      const members: string[] = Array.isArray(org.members) ? org.members.slice(0, 20) : [];
      const emails = await Promise.all(
        members.map(async (m) => {
          if (typeof m !== 'string') return undefined;
          if (m.includes('@')) return m;
          const user = (await db().collection('users').doc(m).get()).data();
          return typeof user?.email === 'string' ? user.email : undefined;
        }),
      );
      const unique = [...new Set(emails.filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()))];
      return { orgName: typeof org.name === 'string' ? org.name : undefined, emails: unique };
    },
  };
}

/**
 * Postmark transactional stream. Bcc and Reply-To go to the sender so a copy
 * lands in the sender's inbox and replies reach a person.
 */
export function postmarkMailer(): Mailer {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.QUOTA_NOTICE_FROM;
  if (!token || !from) throw new Error('POSTMARK_SERVER_TOKEN and QUOTA_NOTICE_FROM must be set to send quota notices.');
  const name = process.env.QUOTA_NOTICE_FROM_NAME || 'Overture Maps API';
  return async ({ to, subject, text }) => {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': token, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        From: `${name} <${from}>`,
        To: to.join(', '),
        Bcc: from,
        ReplyTo: from,
        Subject: subject,
        TextBody: text,
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
        Tag: 'quota-notice',
        TrackOpens: false,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || (body.ErrorCode && body.ErrorCode !== 0)) {
      throw new Error(`Postmark ${res.status}: ${body.Message ?? 'no message'}`);
    }
    return String(body.MessageID);
  };
}
