import { Injectable, Logger } from '@nestjs/common';
import { portalFirestore, portalFirestoreConfigured } from './portal-firestore';

// Live plan resolution for paid-only features, read from the account
// portal's Firestore (project PLAN_FIRESTORE_PROJECT_ID, collection
// `organizations`, document id = the API's accountId). The portal writes
// `planId` (the Stripe price id) and `subscriptionStatus` when a subscription
// changes, so an upgrade is visible here as soon as that write lands, plus at
// most one cache TTL (60s by default).
//
// `subscriptionStatus` alone is not enough: a Free plan can be a $0 Stripe
// subscription, which reads `active`. Paid is decided by `planId` not being
// one of FREE_PLAN_PRICE_IDS. Any price id not listed as Free counts as paid,
// so a new paid tier works without a code change.
//
// Hosted-service configuration (the Firestore project and the Free price ids)
// comes from env, never from code: this repo is open source. With either
// unset, every plan resolves `unknown`.
//
// An org can also carry a manual override, for comped access, agreed pricing
// that is not in Stripe yet, or unblocking an account while billing is sorted:
//
//   planOverride: { plan: "Growth", until: <timestamp or ISO date>, reason: "..." }
//
// `plan` names a plan in QUOTA_PLAN_LIMITS, or "unlimited". `until` is required
// so nobody stays exempt by accident. While it is in the future the account is
// paid, and the monthly cap uses that plan's limits; once it passes, the org
// is classified from Stripe as usual. A malformed or expired override is
// ignored.
//
// Every uncertain outcome is `unknown`, and callers must treat `unknown` as
// ALLOW: missing config, a missing doc, an odd status, a Firestore error or a
// slow read must never lock a paying customer out. The cost of failing open is
// bounded by the BigQuery backstops; the cost of failing closed is a
// customer's integration breaking.

export type PlanStatus = 'paid' | 'free' | 'unknown';

export interface OrgPlanRecord {
  planId?: unknown;
  subscriptionStatus?: unknown;
  planOverride?: unknown;
}

export interface PlanOverride {
  /** A plan name from QUOTA_PLAN_LIMITS (case-insensitive), or "unlimited". */
  plan: string;
  until: Date;
  reason?: string;
}

export type OrgReader = (accountId: string) => Promise<OrgPlanRecord | null>;

/** A resolved plan: the classification plus the Stripe price id behind it. */
export interface ResolvedPlan {
  status: PlanStatus;
  planId?: string;
  /** Present while a manual override is active; status is then 'paid'. */
  override?: PlanOverride;
}

const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);
const LAPSED_STATUSES = new Set(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'free']);

export function freePriceIds(): Set<string> {
  return new Set(
    (process.env.FREE_PLAN_PRICE_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Pure classification of one Firestore organizations record. */
export function classifyPlan(rec: OrgPlanRecord | null, free: Set<string> = freePriceIds()): PlanStatus {
  if (!rec) return 'unknown';
  // Without the Free price ids we cannot tell Free from paid.
  if (free.size === 0) return 'unknown';
  const status = typeof rec.subscriptionStatus === 'string' ? rec.subscriptionStatus : '';
  const planId = rec.planId === null || rec.planId === undefined ? '' : String(rec.planId);
  if (!status && !planId) return 'unknown';
  if (!planId || planId === '0' || free.has(planId)) return 'free';
  if (PAID_STATUSES.has(status)) return 'paid';
  if (LAPSED_STATUSES.has(status)) return 'free';
  return 'unknown';
}

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  // Firestore Timestamp
  if (v && typeof (v as any).toDate === 'function') {
    const d = (v as any).toDate();
    return d instanceof Date ? d : undefined;
  }
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return undefined;
}

/** The record's override if it is well formed and has not expired, else undefined. */
export function activeOverride(rec: OrgPlanRecord | null, now: number = Date.now()): PlanOverride | undefined {
  const raw = rec?.planOverride as any;
  if (!raw || typeof raw !== 'object') return undefined;
  const plan = typeof raw.plan === 'string' ? raw.plan.trim() : '';
  const until = toDate(raw.until);
  if (!plan || !until || Number.isNaN(until.getTime()) || until.getTime() <= now) return undefined;
  return { plan, until, reason: typeof raw.reason === 'string' ? raw.reason : undefined };
}

const envInt = (name: string, fallback: number): number => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

@Injectable()
export class PlanLookupService {
  private readonly logger = new Logger('PlanLookupService');
  private readonly cache = new Map<string, { plan: ResolvedPlan; expires: number }>();
  private readonly refreshing = new Map<string, Promise<ResolvedPlan>>();
  private reader?: OrgReader;
  private static readonly MAX_ENTRIES = 10_000;

  /** Test seam; production lazily builds a Firestore reader on first use. */
  setReader(reader: OrgReader): void {
    this.reader = reader;
    this.cache.clear();
  }

  async getPlanStatus(accountId: string): Promise<PlanStatus> {
    return (await this.getPlan(accountId)).status;
  }

  /**
   * The account's plan. Fresh cache hits return immediately. An expired entry
   * is served stale while one background read refreshes it, so ordinary
   * requests never wait on Firestore after an account's first lookup on this
   * instance (the monthly quota consults this on every request). Only an
   * account with no cache entry at all waits for the read.
   */
  async getPlan(accountId: string): Promise<ResolvedPlan> {
    const hit = this.cache.get(accountId);
    // An override that expired while cached must not outlive its date.
    if (hit?.plan.override && hit.plan.override.until.getTime() <= Date.now()) {
      return this.refresh(accountId);
    }
    if (hit) {
      if (hit.expires <= Date.now()) void this.refresh(accountId);
      return hit.plan;
    }
    return this.refresh(accountId);
  }

  private refresh(accountId: string): Promise<ResolvedPlan> {
    const inflight = this.refreshing.get(accountId);
    if (inflight) return inflight;
    const p = this.fetch(accountId)
      .then((plan) => {
        // Cache known answers for the full TTL; retry unknowns sooner so a brief
        // Firestore blip does not hide an account's real plan for a whole minute.
        const ttl = plan.status === 'unknown' ? envInt('PLAN_UNKNOWN_CACHE_TTL_MS', 10_000) : envInt('PLAN_CACHE_TTL_MS', 60_000);
        if (this.cache.size >= PlanLookupService.MAX_ENTRIES) this.cache.clear();
        this.cache.set(accountId, { plan, expires: Date.now() + ttl });
        return plan;
      })
      .finally(() => this.refreshing.delete(accountId));
    this.refreshing.set(accountId, p);
    return p;
  }

  private async fetch(accountId: string): Promise<ResolvedPlan> {
    // Live reads measured 280-890ms cold (11 Oct 2026, incl. client start);
    // 2.5s leaves headroom so a slow first read does not fail open needlessly.
    const timeoutMs = envInt('PLAN_LOOKUP_TIMEOUT_MS', 2_500);
    let timer: NodeJS.Timeout | undefined;
    try {
      const reader = this.reader ?? (this.reader = this.firestoreReader());
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      });
      const rec = await Promise.race([reader(accountId), timeout]);
      const planId = rec?.planId === null || rec?.planId === undefined ? undefined : String(rec.planId);
      const override = activeOverride(rec);
      if (override) {
        this.logger.log(`Plan override for account ${accountId}: ${override.plan} until ${override.until.toISOString()}.`);
        return { status: 'paid', planId, override };
      }
      const status = classifyPlan(rec);
      if (status === 'unknown') {
        this.logger.warn(`Plan unknown for account ${accountId} (${rec ? 'unrecognised plan/status' : 'no organizations doc'}); allowing paid-only features.`);
      }
      return { status, planId };
    } catch (err: any) {
      this.logger.error(`Plan lookup failed for account ${accountId}: ${err?.message ?? err}; allowing paid-only features.`);
      return { status: 'unknown' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private firestoreReader(): OrgReader {
    if (!portalFirestoreConfigured()) {
      this.logger.error('PLAN_FIRESTORE_PROJECT_ID is not set: every plan resolves unknown and paid-only features are not restricted.');
      return async () => null;
    }
    const db = portalFirestore();
    const collection = process.env.PLAN_FIRESTORE_COLLECTION || 'organizations';
    return async (accountId: string) => {
      const snap = await db.collection(collection).doc(accountId).get();
      return snap.exists ? (snap.data() as OrgPlanRecord) : null;
    };
  }
}
