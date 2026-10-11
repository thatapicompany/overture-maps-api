import { User } from '../decorators/authed-user.decorator';
import { ResolvedPlan } from '../tiers/plan-lookup.service';

// Monthly request limits per Stripe price, from QUOTA_PLAN_LIMITS: a JSON
// object of { "<price id>": { "plan": "Free", "allowance": n, "hardLimit": n } }.
// `allowance` is the advertised monthly allowance (Stripe `monthly_requests`)
// and `hardLimit` the point where requests are refused (`soft_limit_requests`).
// Between the two an account keeps working but every response carries an
// X-Quota-Warning header.
//
// Plan configuration is deployment config, not code: this repo is open
// source. With QUOTA_PLAN_LIMITS unset, nothing is capped.

export interface PlanLimits {
  plan: string;
  allowance: number;
  hardLimit: number;
}

export function planLimitsTable(): Record<string, PlanLimits> {
  const raw = process.env.QUOTA_PLAN_LIMITS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, PlanLimits>;
  } catch {
    return {};
  }
}

/** Limits for lapsed or empty plans (planId 0, canceled): the first Free price's. */
function freeLimits(table: Record<string, PlanLimits>): PlanLimits | undefined {
  const firstFree = (process.env.FREE_PLAN_PRICE_IDS || '').split(',').map((x) => x.trim()).filter(Boolean)[0];
  return firstFree ? table[firstFree] : undefined;
}

export type QuotaPolicy =
  | { kind: 'limited'; limits: PlanLimits }
  | { kind: 'unlimited'; reason: string };

/**
 * Which monthly limit applies. Anything uncertain is unlimited: an unknown
 * plan (Firestore down, no org doc) or a paid price we have no limits for must
 * never be what blocks a customer.
 */
export function resolveQuotaPolicy(user: User | undefined, plan: ResolvedPlan): QuotaPolicy {
  if (!user?.accountId) return { kind: 'unlimited', reason: 'no account' };
  if (user.isDemoAccount) return { kind: 'unlimited', reason: 'demo key (has its own location and size limits)' };
  if (user.isPaidAccount) return { kind: 'unlimited', reason: 'PAID_ACCOUNT_IDS / key metadata override' };
  const table = planLimitsTable();
  if (plan.status === 'unknown') return { kind: 'unlimited', reason: 'plan unknown (fail open)' };
  if (plan.status === 'free') {
    // Free price, or a lapsed/empty plan (planId 0, canceled): Free limits.
    const limits = (plan.planId && table[plan.planId]) || freeLimits(table);
    return limits ? { kind: 'limited', limits } : { kind: 'unlimited', reason: 'no Free limits configured' };
  }
  const limits = plan.planId ? table[plan.planId] : undefined;
  return limits ? { kind: 'limited', limits } : { kind: 'unlimited', reason: `no limits configured for paid price ${plan.planId}` };
}
