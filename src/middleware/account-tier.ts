// Which accounts are on a paid plan, resolved without a call to TheAuthAPI.
//
// Interim source: the PAID_ACCOUNT_IDS env var, a comma-separated list of
// account ids (Twenty `orgId` / TheAuthAPI `customAccountId`). The planned
// replacement is a tiers.json artifact in GCS written from Twenty's
// subscriptionPlan (docs/cost-budget-rate-limiting.md); this module is the
// one place that swap happens. Unknown accounts are Free, which is the safe
// default: a new signup gets Free behaviour until the tier source says
// otherwise.
//
// Read per call so tests and runtime config changes take effect without a
// module reload.

/**
 * True when a paid-tier source is configured at all. Gates that restrict
 * features to paid plans must fail OPEN when this is false: a missing or
 * mistyped env var on deploy must never lock a paying customer out. The cost
 * of failing open is bounded by the per-job and project BigQuery backstops;
 * the cost of failing closed is a paying customer's integration breaking.
 */
export function paidTierSourceConfigured(): boolean {
  return paidAccountIds().size > 0;
}

function paidAccountIds(): Set<string> {
  return new Set(
    (process.env.PAID_ACCOUNT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * True when the account is on a paid plan. `metaData` is TheAuthAPI's
 * customMetaData for the key, honoured when it carries an explicit
 * `isPaidAccount: true`, so a key can be marked paid there as well as via env.
 */
export function isPaidAccount(accountId: string | undefined, metaData?: Record<string, any>): boolean {
  if (metaData?.isPaidAccount === true) return true;
  if (!accountId) return false;
  return paidAccountIds().has(accountId);
}
