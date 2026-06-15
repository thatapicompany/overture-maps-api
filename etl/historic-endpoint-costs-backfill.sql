-- ============================================================================
-- Historic endpoint cost backfill  (one-time, time-sensitive)
-- ============================================================================
-- Per-account attribution is NOT possible for historic jobs: the account_id /
-- request_id labels only began with the usage-tracking deploy (2026-06-15), all
-- API jobs ran as a single runtime service account, and query filters are bound
-- parameters (never in the SQL text). The only historic signal is the ENDPOINT,
-- from the "-- Overture Maps API: <endpoint>" comment each query carries.
--
-- This snapshots endpoint-level unit economics from INFORMATION_SCHEMA.JOBS,
-- which only retains 180 days — so run this before the oldest data rolls off.
--
-- IMPORTANT — avoid double counting:
--   Multi-statement endpoints (buildings/addresses/transportation/divisions/
--   base, and places+buildings) run as SCRIPT jobs. The SCRIPT parent already
--   aggregates its child statements' billed bytes AND carries the comment, while
--   the child SELECT jobs do not carry the comment. Summing every job therefore
--   double counts script children. We keep only top-level jobs (parent_job_id IS
--   NULL): SCRIPT parents (aggregated) + standalone SELECTs. (Naively summing all
--   jobs reports ~$483/180d; the correct top-level figure is ~$279.)

CREATE OR REPLACE TABLE `usage.historic_endpoint_costs`
PARTITION BY usage_date AS
SELECT
  DATE(creation_time)                                              AS usage_date,
  TRIM(REGEXP_EXTRACT(query, r"-- Overture Maps API: ([^\n]+)"))   AS endpoint,
  COUNT(*)                                                         AS jobs,
  SUM(total_bytes_billed)                                          AS bytes_billed,
  ROUND(SUM(total_bytes_billed) / 1e12 * 5, 6)                     AS cost_usd,
  CAST(APPROX_QUANTILES(total_bytes_billed, 100)[OFFSET(50)] AS INT64) AS p50_bytes_billed,
  CAST(APPROX_QUANTILES(total_bytes_billed, 100)[OFFSET(95)] AS INT64) AS p95_bytes_billed,
  CURRENT_TIMESTAMP()                                             AS snapshot_ts
FROM `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
  AND job_type = 'QUERY'
  AND parent_job_id IS NULL                 -- top-level only; SCRIPT parents aggregate children
  AND query LIKE '-- Overture Maps API%'    -- only API-issued queries
GROUP BY usage_date, endpoint;

-- ----------------------------------------------------------------------------
-- Read-back: endpoint unit economics over the snapshot window
-- ----------------------------------------------------------------------------
-- SELECT
--   endpoint,
--   SUM(jobs)                                   AS jobs,
--   ROUND(SUM(cost_usd), 2)                     AS cost_usd,
--   ROUND(SUM(cost_usd) / SUM(jobs), 6)         AS avg_cost_per_call,
--   ROUND(MAX(p95_bytes_billed) / 1e9, 2)       AS worst_day_p95_gb
-- FROM `usage.historic_endpoint_costs`
-- GROUP BY endpoint
-- ORDER BY cost_usd DESC;
