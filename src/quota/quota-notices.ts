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
//
// Pacing, so nobody gets two of these in a day:
//   - The allowance notice waits QUOTA_ALLOWANCE_NOTICE_DELAY_HOURS (24) after
//     the account first passes its allowance. An account that reaches the limit
//     inside that window gets only the limit notice: scripts that burn through
//     100 and 200 requests in minutes would otherwise get both minutes apart.
//   - The allowance notice also waits while the account's team has had any other
//     email from us (other than sign-in links and the welcome) in the last
//     QUOTA_NOTICE_QUIET_HOURS (24). The limit notice does not wait: it explains
//     why their requests are being refused.

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
  /** When this account first passed its allowance this month; records `at` if it is the first time. */
  firstSeen(docId: string, kind: NoticeKind, at: Date): Promise<Date>;
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

/** Whether any of these addresses had a non-service email from us since `since`. */
export type MailHistory = (emails: string[], since: Date) => Promise<boolean>;

export type NoticeOutcome =
  | 'off' | 'none' | 'handled' | 'logged' | 'claimed-elsewhere' | 'no-recipients' | 'sent' | 'failed'
  | 'waiting' | 'recently-emailed';

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
  /** `${docId}:${kind}` -> earliest time this instance should look at it again. */
  private readonly nextCheck = new Map<string, number>();
  private backend?: NoticeBackend;
  private mailer?: Mailer;
  private history?: MailHistory;

  /** Test seam. Production builds Firestore and Postmark adapters lazily. */
  configure(backend: NoticeBackend, mailer: Mailer, history?: MailHistory): void {
    this.backend = backend;
    this.mailer = mailer;
    this.history = history ?? (async () => false);
    this.nextCheck.clear();
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
    const key = `${docId}:${kind}`;
    const nowMs = ctx.now.getTime();
    if ((this.nextCheck.get(key) ?? 0) > nowMs) return 'handled';
    if (this.nextCheck.size > 10_000) this.nextCheck.clear();
    // Mark before any await, so concurrent requests on this instance do one lookup.
    this.nextCheck.set(key, Number.POSITIVE_INFINITY);

    const backend = this.getBackend();
    const mode = noticeMode();
    const HOUR = 3_600_000;

    if (mode === 'log') {
      const r = await backend.recipients(ctx.accountId);
      const { subject } = composeNotice(kind, ctx, r.orgName);
      this.logger.log(`[log mode] would send "${subject}" to ${r.emails.length} recipient(s) for account ${ctx.accountId} (${fmt(ctx.used)} on ${ctx.plan}).`);
      return 'logged';
    }

    let r: Recipients | undefined;
    if (kind === 'allowance') {
      const delayMs = envInt('QUOTA_ALLOWANCE_NOTICE_DELAY_HOURS', 24) * HOUR;
      const first = await backend.firstSeen(docId, kind, ctx.now);
      if (nowMs - first.getTime() < delayMs) {
        // Look again once the delay is up. If the limit is reached first, the
        // limit notice goes instead and this one never does.
        this.nextCheck.set(key, first.getTime() + delayMs);
        return 'waiting';
      }
      r = await backend.recipients(ctx.accountId);
      const quietMs = envInt('QUOTA_NOTICE_QUIET_HOURS', 24) * HOUR;
      let recent = true;
      try {
        recent = r.emails.length > 0 && (await this.getHistory()(r.emails, new Date(nowMs - quietMs)));
      } catch (err: any) {
        // Unsure counts as recent: this notice can wait, a second email in a day cannot be unsent.
        this.logger.warn(`Quota notice: mail history check failed for account ${ctx.accountId}, waiting: ${err?.message ?? err}`);
      }
      if (recent) {
        this.nextCheck.set(key, nowMs + HOUR);
        return 'recently-emailed';
      }
    }

    const claimed = await backend.claim(docId, kind, { claimedAt: new Date(), plan: ctx.plan, used: ctx.used });
    if (!claimed) return 'claimed-elsewhere';
    if (kind === 'limit') {
      // Covers the allowance notice too, for anyone who has not had it yet.
      await backend.claim(docId, 'allowance', { claimedAt: new Date(), mergedIntoLimit: true }).catch(() => false);
    }

    try {
      r = r ?? (await backend.recipients(ctx.accountId));
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

  private getHistory(): MailHistory {
    if (!this.history) this.history = postmarkHistory();
    return this.history;
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
        if (snap.exists && snap.data()?.notices?.[kind]?.claimedAt) return false;
        tx.set(ref, { notices: { [kind]: data } }, { merge: true });
        return true;
      });
    },
    async firstSeen(docId, kind, at) {
      const ref = counters().doc(docId);
      return db().runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const seen = snap.exists ? snap.data()?.notices?.[kind]?.firstSeenAt : undefined;
        if (seen) return typeof seen.toDate === 'function' ? seen.toDate() : new Date(seen);
        tx.set(ref, { notices: { [kind]: { firstSeenAt: at } } }, { merge: true });
        return at;
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

/** Postmark reads `fromdate` as US Eastern time, so a UTC clock time shifts the window by hours. */
export function postmarkDate(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Mail someone asked for (sign-in links) or the one-off welcome; neither counts against the quiet period. */
const SERVICE_SUBJECTS = [/^sign in to /i, /api key is ready/i];

/** Every customer email goes through the same Postmark server, so its outbound log sees them all. */
export function postmarkHistory(): MailHistory {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) throw new Error('POSTMARK_SERVER_TOKEN must be set to check recent mail.');
  return async (emails, since) => {
    for (const email of emails.slice(0, 10)) {
      const url = `https://api.postmarkapp.com/messages/outbound?count=20&offset=0&recipient=${encodeURIComponent(email)}&fromdate=${encodeURIComponent(postmarkDate(since))}`;
      const res = await fetch(url, { headers: { 'X-Postmark-Server-Token': token, accept: 'application/json' } });
      if (!res.ok) throw new Error(`Postmark ${res.status}`);
      const body: any = await res.json();
      const recent = (body.Messages ?? []).some((m: any) =>
        new Date(m.ReceivedAt).getTime() >= since.getTime() && !SERVICE_SUBJECTS.some((p) => p.test(m.Subject ?? '')));
      if (recent) return true;
    }
    return false;
  };
}
