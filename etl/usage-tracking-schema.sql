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
  user_agent         STRING,             -- User-Agent header, capped at 512 chars
  origin             STRING,             -- Origin header (browser cross-origin calls)
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

-- Migration for tables created before user_agent/origin existed. Run this
-- BEFORE deploying an API build that writes these fields: streaming inserts
-- with unknown fields are rejected, and the API SA cannot alter the table.
--
--   ALTER TABLE `usage.api_requests`
--     ADD COLUMN IF NOT EXISTS user_agent STRING,
--     ADD COLUMN IF NOT EXISTS origin STRING;

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
