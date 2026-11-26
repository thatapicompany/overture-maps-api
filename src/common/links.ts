// Links used in error messages. Self-hosted deployments can point these at
// their own pages.

// Sign up and sign in.
export const ACCOUNT_URL = process.env.ACCOUNT_URL || 'https://app.overturemapsapi.com';

// Plans and prices, for refusals an upgrade would fix (paid-only queries,
// the monthly request limit).
export const PRICING_URL = process.env.PRICING_URL || 'https://www.overturemapsapi.com/pricing';

// Our own sites, where Google Analytics and the app's sign-up source read
// campaign tags.
const OUR_SITES = /(^|\.)overturemapsapi\.com$/;

/**
 * Adds campaign tags to a link to our own sites, so a visit or sign-up that
 * started from an API response is counted as one instead of as direct. A
 * self-hosted deployment's own links are left as they are. `campaign` says
 * where in the API the link was given, such as `demo_limit` or `paid_only`.
 */
export function tagged(url: string, campaign: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!OUR_SITES.test(parsed.hostname)) return url;
  parsed.searchParams.set('utm_source', 'overture_api');
  parsed.searchParams.set('utm_medium', 'api_response');
  parsed.searchParams.set('utm_campaign', campaign);
  return parsed.toString();
}
