import { Injectable, Logger } from '@nestjs/common';
import { portalFirestore } from './portal-firestore';

// Live plan resolution for paid-only features, read from the account
// portal's Firestore (project `overture-api`, collection `organizations`,
// document id = the API's accountId). The portal writes `planId` (the Stripe
// price id) and `subscriptionStatus` when a subscription changes, so an
// upgrade is visible here as soon as that write lands, plus at most one cache
// TTL (60s by default). Replaces waiting on a scheduled export.
//
// Firestore's `subscriptionStatus` alone is useless: Free is a real $0 Stripe
// subscription, so ~500 Free orgs read `active`. Paid is decided by `planId`
// not being a Free price. Any price id we do not recognise as Free counts as
// paid, so a new paid tier works without a code change.
//
// Every uncertain outcome is `unknown`, and callers must treat `unknown` as
// ALLOW: a missing doc, an odd status, a Firestore error or a slow read must
// never lock a paying customer out. The cost of failing open is bounded by
// the BigQuery backstops; the cost of failing closed is a customer's
// integration breaking.

export type PlanStatus = 'paid' | 'free' | 'unknown';

export interface OrgPlanRecord {
  planId?: unknown;
  subscriptionStatus?: unknown;
}

export type OrgReader = (accountId: string) => Promise<OrgPlanRecord | null>;

/** A resolved plan: the classification plus the Stripe price id behind it. */
export interface ResolvedPlan {
  status: PlanStatus;
  planId?: string;
}

// The Free plan's Stripe price id, as written by the portal (517 orgs checked
// 11 Oct 2026: 508 on this price, 1 on a paid price, the rest canceled/empty).
const DEFAULT_FREE_PRICE_IDS = 'price_1RyU95Kqcwz1EdQWSn6vxFzs';
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);
const LAPSED_STATUSES = new Set(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'free']);

export function freePriceIds(): Set<string> {
  return new Set(
    (process.env.FREE_PLAN_PRICE_IDS || DEFAULT_FREE_PRICE_IDS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Pure classification of one Firestore organizations record. */
export function classifyPlan(rec: OrgPlanRecord | null, free: Set<string> = freePriceIds()): PlanStatus {
  if (!rec) return 'unknown';
  const status = typeof rec.subscriptionStatus === 'string' ? rec.subscriptionStatus : '';
  const planId = rec.planId === null || rec.planId === undefined ? '' : String(rec.planId);
  if (!status && !planId) return 'unknown';
  if (!planId || planId === '0' || free.has(planId)) return 'free';
  if (PAID_STATUSES.has(status)) return 'paid';
  if (LAPSED_STATUSES.has(status)) return 'free';
  return 'unknown';
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
      const status = classifyPlan(rec);
      if (status === 'unknown') {
        this.logger.warn(`Plan unknown for account ${accountId} (${rec ? 'unrecognised plan/status' : 'no organizations doc'}); allowing paid-only features.`);
      }
      const planId = rec?.planId === null || rec?.planId === undefined ? undefined : String(rec.planId);
      return { status, planId };
    } catch (err: any) {
      this.logger.error(`Plan lookup failed for account ${accountId}: ${err?.message ?? err}; allowing paid-only features.`);
      return { status: 'unknown' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private firestoreReader(): OrgReader {
    const db = portalFirestore();
    const collection = process.env.PLAN_FIRESTORE_COLLECTION || 'organizations';
    return async (accountId: string) => {
      const snap = await db.collection(collection).doc(accountId).get();
      return snap.exists ? (snap.data() as OrgPlanRecord) : null;
    };
  }
}
