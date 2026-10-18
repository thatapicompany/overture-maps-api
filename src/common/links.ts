// Links used in error messages. Self-hosted deployments can point these at
// their own pages.

// Sign up and sign in.
export const ACCOUNT_URL = process.env.ACCOUNT_URL || 'https://account.overturemapsapi.com';

// Plans and prices, for refusals an upgrade would fix (paid-only queries,
// the monthly request limit).
export const PRICING_URL = process.env.PRICING_URL || 'https://www.overturemapsapi.com/pricing';
