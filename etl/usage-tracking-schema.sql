-- ============================================================================
-- Usage / cost tracking — immutable per-request usage table
-- ============================================================================
-- The API writes one append-only row per request via streaming inserts
-- (see src/usage/usage.sink.ts). The table is auto-created on startup when
-- USAGE_TRACKING_ENABLED=true, but this file is the source of truth for the
-- schema, partitioning, and the IAM that makes it immutable.
--
-- Marginal cost per query = bytes_billed / 1e12 * $5 (BigQuery on-demand).
-- Note for modelling: the 1 TB/month free tier is per BILLING ACCOUNT, not per
-- customer — allocate it at the account level, do not subtract it per request.

CREATE SCHEMA IF NOT EXISTS `usage` OPTIONS (location = 'US');

CREATE TABLE IF NOT EXISTS `usage.api_requests`
(
  request_id         STRING    NOT NULL,  -- uuid; also the streaming insertId (dedup)
  request_ts         TIMESTAMP NOT NULL,
  account_id         STRING,              -- authed customer; NULL = anonymous
  user_id            STRING,
  is_demo            BOOL,
  api_key_hash       STRING,              -- sha256(key); NEVER the raw key
  method             STRING,
  route              STRING,              -- matched route pattern, e.g. '/places'
  path               STRING,              -- actual request path
  query_params       STRING,             -- JSON text of the request filters
  status_code        INT64,
  cache_hit          BOOL,               -- served from cache => $0 BigQuery cost
  response_count     INT64,              -- from X-Total-Count
  duration_ms        INT64,              -- end-to-end request latency
  bq_job_count       INT64,
  total_bytes_billed INT64,
  cost_usd           FLOAT64,            -- marginal BigQuery cost, summed over jobs
  env                STRING,
  api_version        STRING,
  error              STRING,
  jobs ARRAY<STRUCT<                     -- per-BigQuery-job breakdown
    job_id          STRING,
    bytes_processed INT64,
    bytes_billed    INT64,
    cost_usd        FLOAT64,
    duration_ms     INT64,
    statement_type  STRING
  >>
)
PARTITION BY DATE(request_ts)
CLUSTER BY account_id, route
OPTIONS (
  description = 'Immutable per-request API usage and BigQuery cost. Append-only.',
  require_partition_filter = TRUE
);

-- ----------------------------------------------------------------------------
-- Immutability via IAM (run once; replace PROJECT / SA placeholders)
-- ----------------------------------------------------------------------------
-- The API service account must be able to INSERT but not UPDATE/DELETE history.
-- Create a custom role with only data-append permissions and grant it on the
-- dataset, instead of the broad roles/bigquery.dataEditor:
--
--   gcloud iam roles create usageAppender --project=PROJECT \
--     --title="Usage Appender" \
--     --permissions=bigquery.tables.get,bigquery.tables.getData,bigquery.tables.updateData
--
--   bq add-iam-policy-binding \
--     --member="serviceAccount:API_SA@PROJECT.iam.gserviceaccount.com" \
--     --role="projects/PROJECT/roles/usageAppender" \
--     PROJECT:usage
--
-- Do NOT grant the API SA dataEditor/dataOwner on this dataset — those allow DML
-- DELETE/UPDATE. Keep delete/admin rights to a separate human/admin principal.

-- ============================================================================
-- Pricing-model queries
-- ============================================================================

-- Cost & volume per customer per month (the core pricing input)
SELECT
  account_id,
  FORMAT_DATE('%Y-%m', DATE(request_ts))                AS month,
  COUNT(*)                                              AS requests,
  COUNTIF(cache_hit)                                    AS cached_requests,
  SUM(cost_usd)                                         AS bq_cost_usd,
  SAFE_DIVIDE(SUM(cost_usd), COUNT(*))                  AS avg_cost_per_request,
  APPROX_QUANTILES(cost_usd, 100)[OFFSET(95)]           AS p95_request_cost
FROM `usage.api_requests`
WHERE request_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  AND NOT is_demo
GROUP BY account_id, month
ORDER BY bq_cost_usd DESC;

-- Where the cost goes by endpoint (informs per-endpoint / tiered pricing)
SELECT
  route,
  COUNT(*)                              AS requests,
  SUM(cost_usd)                         AS cost_usd,
  SAFE_DIVIDE(SUM(cost_usd), COUNT(*))  AS avg_cost_per_request,
  SAFE_DIVIDE(COUNTIF(cache_hit), COUNT(*)) AS cache_hit_rate
FROM `usage.api_requests`
WHERE request_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY route
ORDER BY cost_usd DESC;

-- Top customers by cost this month (find who needs a higher tier)
SELECT
  account_id,
  SUM(cost_usd)        AS bq_cost_usd,
  COUNT(*)             AS requests
FROM `usage.api_requests`
WHERE DATE(request_ts) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
  AND account_id IS NOT NULL
GROUP BY account_id
ORDER BY bq_cost_usd DESC
LIMIT 50;

-- Reconcile the usage table against BigQuery's authoritative billed bytes
-- (jobs are labelled with request_id in src/bigquery/bigquery.service.ts).
-- INFORMATION_SCHEMA.JOBS has ~180-day retention, so use it as a backstop.
--   SELECT l.value AS request_id, SUM(total_bytes_billed) AS bytes_billed
--   FROM `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT, UNNEST(labels) AS l
--   WHERE l.key = 'request_id' AND creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
--   GROUP BY request_id;
