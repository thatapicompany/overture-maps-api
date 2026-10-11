// Static paid-account OVERRIDE, resolved without a call to TheAuthAPI.
//
// The live source of truth is the portal's Firestore (tiers/plan-lookup.service.ts),
// which sees an upgrade within a minute. This override is for accounts Stripe
// does not model (enterprise deals, comped access) or an emergency: list
// account ids in PAID_ACCOUNT_IDS, or set `isPaidAccount: true` in the key's
// TheAuthAPI metadata, and the account is treated as paid with no lookup.
//
// Read per call so tests and runtime config changes take effect without a
// module reload.

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
