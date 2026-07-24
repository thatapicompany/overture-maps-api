# BigQuery cost controls

Runbook for the fixes to the July 2026 BigQuery cost spike.

## Root cause

Every `/places` request runs `SELECT * FROM place WHERE ST_DWithin(...)`. The
source table (`bigquery-public-data.overture_maps.place`) is **not clustered**,
so each call scanned the whole table — median = max = **45.4 GB billed per
request** (~US$0.28). A few hundred requests/day = the spike:

- Jul 21 US$140, Jul 22 US$40, Jul 23 US$25 (matches the billing chart).
- Drivers, all `/places`: the public **demo key ~US$100** (603 reqs), a free
  user **~US$69** (300 reqs), an older account **~US$39** (226 reqs, 5k results
  from 7 TiB — hugely inefficient). `/base` was cheap (US$1.26); not the cause.

The API's own usage log (`overture-maps-api.usage.api_requests`) records
`cost_usd` / `total_bytes_billed` per request — use it to monitor going forward.

## The five fixes

### 1. Cluster the place table (the structural fix — do this first)

**In code (this branch):** the API now reads `PLACE_TABLE`
(`src/bigquery/bigquery.service.ts`), defaulting to the public table.
`etl/build-places-mirror.sql` + `.github/workflows/places-mirror.yml` build a
geometry-clustered mirror `overture-maps-api.overture.place`. BigQuery prunes
`ST_DWithin` against a clustered `GEOGRAPHY` column, so a 25 km radius query
should drop from ~45 GB to a few hundred MB — a ~40–100× cut for every user.

**To deploy:**
1. Grant the mirror's service account BigQuery dataset-create + table-write on
   `overture-maps-api` (read on `bigquery-public-data` it already has).
2. Trigger the `Rebuild Places Mirror` workflow once (or run
   `bq query --location=US --use_legacy_sql=false < etl/build-places-mirror.sql`).
   One-time ~45 GB scan (~US$0.30).
3. Set `PLACE_TABLE=overture-maps-api.overture.place` on the Cloud Run service and
   deploy. Watch `usage.api_requests.total_bytes_billed` fall.
4. The workflow rebuilds it monthly after each Overture release.

*Note:* clustering is by `geometry`, which fixes the dominant radius queries.
Country-level queries (filtered on the nested `addresses…country`) don't prune on
geometry — fix #5 blocks the unfiltered ones; if country+filter queries later
become costly, add a derived top-level `country` column as a second cluster key.

### 2. Caching — already working, no change needed

Redis caching (`src/cache`) is live: non-demo cache-hit is ~28%. The remaining
cost is cache **misses**, each of which paid the full 45 GB scan — fixed by #1.
Keep `REDIS_URL` provisioned. `CACHE_TTL_SECONDS` defaults to 24h; safe to raise
(Overture data only changes monthly) via env with no redeploy.

### 3. Clamp the demo key

**In code (this branch):** `places.controller` caps demo requests to
`radius ≤ 2000 m` and `limit ≤ 25`. Combined with #1, each demo query becomes
cheap. The region restriction (`ValidateLatLngUser`) already limits demo to a few
cities. *Optional follow-up:* a hard per-day request cap on the demo key — the
demo key short-circuits `AuthAPIMiddleware` before TheAuthAPI, so it currently
skips the per-key rate limiter; a small Redis counter keyed on the demo user id
would add a daily ceiling.

### 4. Enforce the monthly quota (auth-api)

The quota system exists but runs in `MONTHLY_QUOTA_MODE=log` (never blocks). To
turn it on:
1. **Backfill** `monthly_limit` / `monthly_soft_limit` onto existing keys'
   `rate_limit_configurations` from their Stripe tier metadata (the backfill
   script is not yet written — auth-api repo; quotas otherwise only attach to
   keys created post-deploy).
2. Set `MONTHLY_QUOTA_MODE=enforce` on the auth-api deployment.
3. Watch Cloud Logging for "Monthly quota crossed" for a few days first (already
   in log mode), then flip. This caps a single free user from running hundreds of
   scans/day.

### 5. Clamp over-broad `/places` queries

**In code (this branch):**
- Default `limit` reduced from **25000 → 100** (`get-by-location.dto.ts`) — the
  old default returned up to 25k full rows per call. Max stays 25000, paginate
  with `page` for more.
- Radius already capped at 25 km.
- Country-level queries now **require** a narrowing filter (`categories`,
  `taxonomy`, `brand_name` or `brand_wikidata`); unfiltered whole-country dumps
  return 400 (`places.controller`). Stops the "7 TiB for 5k results" pattern.

## Order of impact
1 (clustering) removes ~90% of the cost. 5 and 3 stop the abuse patterns. 4 is
the per-user ceiling. 2 is already done.
