import { User } from '../decorators/authed-user.decorator';
import { ResolvedPlan } from '../tiers/plan-lookup.service';

// Monthly request limits per Stripe price, copied from the Overture products'
// metadata in Stripe (11 Oct 2026): `monthly_requests` is the advertised
// allowance and `soft_limit_requests` the point where requests are refused.
// Between the two an account keeps working but every response carries an
// X-Quota-Warning header. Override or extend with QUOTA_PLAN_LIMITS, a JSON
// object of { "<price id>": { "plan": "...", "allowance": n, "hardLimit": n } }.

export interface PlanLimits {
  plan: string;
  allowance: number;
  hardLimit: number;
}

export const FREE_PRICE_ID = 'price_test_free';

const DEFAULT_LIMITS: Record<string, PlanLimits> = {
  [FREE_PRICE_ID]: { plan: 'Free', allowance: 100, hardLimit: 200 },
  price_test_premium: { plan: 'Premium', allowance: 1_000, hardLimit: 2_000 },
  price_test_growth: { plan: 'Growth', allowance: 4_000, hardLimit: 6_000 },
  price_test_scale: { plan: 'Scale', allowance: 10_000, hardLimit: 20_000 },
};

export function planLimitsTable(): Record<string, PlanLimits> {
  const raw = process.env.QUOTA_PLAN_LIMITS;
  if (!raw) return DEFAULT_LIMITS;
  try {
    return { ...DEFAULT_LIMITS, ...(JSON.parse(raw) as Record<string, PlanLimits>) };
  } catch {
    return DEFAULT_LIMITS;
  }
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
    return { kind: 'limited', limits: (plan.planId && table[plan.planId]) || table[FREE_PRICE_ID] };
  }
  const limits = plan.planId ? table[plan.planId] : undefined;
  return limits ? { kind: 'limited', limits } : { kind: 'unlimited', reason: `no limits configured for paid price ${plan.planId}` };
}
