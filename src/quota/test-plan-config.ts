// Fake plan configuration for tests. Real price ids live in deployment env,
// never in this open-source repo.
export const TEST_FREE = 'price_test_free';
export const TEST_PREMIUM = 'price_test_premium';
export const TEST_GROWTH = 'price_test_growth';
export const TEST_SCALE = 'price_test_scale';

export const TEST_PLAN_LIMITS = {
  [TEST_FREE]: { plan: 'Free', allowance: 100, hardLimit: 200 },
  [TEST_PREMIUM]: { plan: 'Premium', allowance: 1_000, hardLimit: 2_000 },
  [TEST_GROWTH]: { plan: 'Growth', allowance: 4_000, hardLimit: 6_000 },
  [TEST_SCALE]: { plan: 'Scale', allowance: 10_000, hardLimit: 20_000 },
};

const KEYS = ['QUOTA_PLAN_LIMITS', 'FREE_PLAN_PRICE_IDS'] as const;

/** Set the fake plan env for a test file; returns a restore function. */
export function useTestPlanConfig(): () => void {
  const prev = KEYS.map((k) => process.env[k]);
  process.env.QUOTA_PLAN_LIMITS = JSON.stringify(TEST_PLAN_LIMITS);
  process.env.FREE_PLAN_PRICE_IDS = TEST_FREE;
  return () =>
    KEYS.forEach((k, i) => {
      if (prev[i] === undefined) delete process.env[k];
      else process.env[k] = prev[i];
    });
}
