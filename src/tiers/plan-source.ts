import { portalFirestore, portalFirestoreConfigured } from './portal-firestore';
import type { OrgPlanRecord } from './plan-lookup.service';

// Where the plan lookup reads an account's plan record from. Chosen by
// PLAN_SOURCE:
//
//   firestore  a Firestore document per account (PLAN_FIRESTORE_PROJECT_ID,
//              collection PLAN_FIRESTORE_COLLECTION, default `organizations`).
//              The default when PLAN_FIRESTORE_PROJECT_ID is set.
//   http       GET {PLAN_SOURCE_URL}/{accountId} with an optional bearer
//              PLAN_SOURCE_TOKEN. 200 returns the record as JSON, 404 means
//              no record. Lets plan data live in any service you run.
//   none       no plan data: every plan resolves unknown and is allowed.
//              The default when nothing is configured, as for self-hosting.
//
// Every source returns the same shape: { planId, subscriptionStatus,
// planOverride? }. See plan-lookup.service.ts for how it is classified.

export interface PlanSource {
  readonly name: string;
  read(accountId: string): Promise<OrgPlanRecord | null>;
}

export function firestorePlanSource(): PlanSource {
  const collection = process.env.PLAN_FIRESTORE_COLLECTION || 'organizations';
  return {
    name: 'firestore',
    async read(accountId) {
      const snap = await portalFirestore().collection(collection).doc(accountId).get();
      return snap.exists ? (snap.data() as OrgPlanRecord) : null;
    },
  };
}

export function httpPlanSource(baseUrl: string, token?: string, fetchImpl: typeof fetch = fetch): PlanSource {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    name: 'http',
    async read(accountId) {
      const res = await fetchImpl(`${base}/${encodeURIComponent(accountId)}`, {
        headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`plan source returned ${res.status}`);
      return (await res.json()) as OrgPlanRecord;
    },
  };
}

export const noPlanSource: PlanSource = { name: 'none', read: async () => null };

export function planSourceFromEnv(): PlanSource {
  const kind = (process.env.PLAN_SOURCE || (portalFirestoreConfigured() ? 'firestore' : 'none')).toLowerCase();
  if (kind === 'firestore') return portalFirestoreConfigured() ? firestorePlanSource() : noPlanSource;
  if (kind === 'http') {
    const url = process.env.PLAN_SOURCE_URL;
    return url ? httpPlanSource(url, process.env.PLAN_SOURCE_TOKEN) : noPlanSource;
  }
  return noPlanSource;
}
