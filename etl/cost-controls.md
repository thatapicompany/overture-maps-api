# Cost controls

How the API keeps BigQuery spend predictable. Every limit here is configured by
environment variable; nothing is hard-coded to the hosted service.

## Query shape

- **Clustered mirrors.** Place, building and division queries read copies of the
  Overture tables clustered for the filters the API uses (`etl/build-*-mirror.sql`),
  so a radius or id lookup reads a small slice rather than the whole table.
- **Country-level `/places` is paid only.** A `country` with no lat/lng returns
  403 `country_level_paid_only` on Free, and 400 for the demo key. These read a
  country-clustered mirror (`overture.place_by_country`).
- **Point-only endpoints** (`/buildings`, `/addresses`, `/base`,
  `/transportation`, `/places/buildings`) return 400 for country-only calls.
- **Caching.** Identical requests are served from cache (`GCS_BUCKET_NAME`).

## Request limits

- **Per minute,** per account and by plan (`THROTTLE_LIMIT`,
  `THROTTLE_LIMIT_PAID`), keyed by IP for the demo key and anonymous calls.
  429 `rate_limited` with `X-RateLimit-*` headers.
- **Per month,** per account (`src/quota/`, `QUOTA_MODE`, limits from
  `QUOTA_PLAN_LIMITS`). Requests between the allowance and the limit work and
  carry `X-Quota-Warning`; at the limit, 429 `monthly_quota_exceeded` until
  00:00 UTC on the 1st. Only responses below 400 count. Plans resolve through
  the plan lookup (`src/tiers/`); anything uncertain is allowed.
- **Plan overrides.** An org record can carry `planOverride: { plan, until,
  reason }`, which applies a named plan's limits until `until`.

## Backstops on actual bytes

BigQuery checks a per-job `maximumBytesBilled` against its upfront estimate,
which for clustered tables is the whole table, so a per-job cap refuses
legitimate queries. `BQ_MAX_BYTES_BILLED` is therefore off by default. Use these
instead:

- **Large-job warning:** any job billing more than `BQ_WARN_BYTES_BILLED` is
  logged as "BigQuery: large job billed". Alert on that log line.
- **Project quota:** BigQuery "Query usage per day" on the project.
- **Billing budget** with alerts on the billing account.

## Usage table

Every request writes one row to `usage.api_requests` (schema and IAM in
`etl/usage-tracking-schema.sql`), including bytes billed and `cost_usd`, so
cost per account and per endpoint can be measured.
