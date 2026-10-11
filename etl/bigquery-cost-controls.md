# BigQuery cost controls

Runbook for the fixes to the July 2026 BigQuery cost spike.

## Root cause

Every `/places` request runs `SELECT * FROM place WHERE ST_DWithin(...)`. The
source table (`bigquery-public-data.overture_maps.place`) is **not clustered**,
so each call scanned the whole table — median = max = **45.4 GB billed per
request** (~US$0.28). A few hundred requests/day = the spike:

- Peaked on 21 Jul and tailed off over the next two days.
- Drivers, all `/places`: the public **demo key** (603 reqs), a free
  user (300 reqs), an older account (226 reqs, 5k results
  from 7 TiB — hugely inefficient). `/base` was cheap; not the cause.

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

### 6. Cluster the building table (`/places/buildings`, `/buildings`)

Fix #1 clustered the *place* table, but `getPlacesWithNearestBuilding()` and
`getBuildingsNearby()` also read `bigquery-public-data.overture_maps.building`,
which was never mirrored. The nearest-building join was flagged in code as
costing **~$2.25/query** (vs a ~$0.02 target) and, unlike `/places`, cost and
latency get materially worse as radius grows — a 2–5 km nearest-building
request can time out against the unclustered source.

**In code (this branch):** the API now reads `BUILDING_TABLE`
(`src/bigquery/bigquery.service.ts`), defaulting to the public table, used by
both `getPlacesWithNearestBuilding()` (both the `match_nearest_building=true`
and `=false` paths) and `getBuildingsNearby()`. `etl/build-buildings-mirror.sql`
+ `.github/workflows/buildings-mirror.yml` build a geometry-clustered mirror
`overture-maps-api.overture.building`, same pattern as the place mirror.

As an immediate stopgap independent of the mirror, `/places/buildings` now
caps `radius` at **2000 m** (vs 25000 m on `/places`) — see
`GetPlacesWithBuildingsDto` — since the buildings side doesn't prune until the
mirror is live.

**To deploy:**
1. Trigger the `Rebuild Buildings Mirror` workflow once (or run
   `bq query --location=US --use_legacy_sql=false < etl/build-buildings-mirror.sql`).
2. Set `BUILDING_TABLE=overture-maps-api.overture.building` on the Cloud Run
   service and deploy. Re-measure cost/latency at 2–10 km radius before
   raising the 2000 m cap back up.
3. The workflow rebuilds it monthly, offset 30 min after the places mirror.

### 7. Country-clustered mirror + country-level is paid only (Oct 2026)

Fix 1 made radius queries prune, but a `/places` query with `country` and no
lat/lng still read the whole 45 GB table: the geometry cluster cannot prune
`addresses.list[OFFSET(0)].element.country`, and `name`, `categories` and
`brand_name` do not prune either. That shape was 9% of requests and 85% of
September's spend, and caused the 14 Sep (7.1 TiB) and 5 Oct (4.85 TiB,
109 Free-plan country + name calls in three hours) spikes.

**In code:**
- `etl/build-places-country-mirror.sql` + `.github/workflows/places-country-mirror.yml`
  build `overture-maps-api.overture.place_by_country`: the geometry mirror plus a
  top-level `country` and a `name_lower` column, clustered by
  `country, basic_category, name_lower`. Rebuilt monthly, an hour after the
  geometry mirror it reads from.
- `BigQueryService.placeSource()` routes queries with no lat/lng to
  `PLACE_COUNTRY_TABLE` with `country = @country` / `name_lower = LOWER(@name)`
  predicates; radius queries keep `PLACE_TABLE` and the raw-schema predicates.
  Covers `/places`, `/places/brands`, `/places/categories`, `/places/countries`.
  Unset `PLACE_COUNTRY_TABLE` means the old behaviour.
- Country-level `/places` is **paid plans only**: Free gets a 403 before any
  BigQuery job (`places/places-cost-guards.ts`). Paid is resolved live from the
  portal's Firestore (`tiers/plan-lookup.service.ts`), with `PAID_ACCOUNT_IDS` or
  `isPaidAccount: true` in TheAuthAPI key metadata as an override
  (`middleware/account-tier.ts`). Never from a TheAuthAPI call.
- `cost_usd` now prices at US$6.25 per TiB (was US$5 per decimal TB, ~12% low).

**Measured 11 Oct 2026** on the built mirror (73.6M rows, 47.5 GB), real runs
with the query shapes the API sends (dry-run estimates ignore cluster pruning):

| Query | Before (geometry mirror) | After (country mirror) |
|---|---|---|
| small country + `name` (the 5 Oct shape) | 45.5 GiB | 1.51 GiB |
| small country + `categories` (Sep shape) | 40 to 45 GiB | 0.56 GiB |
| `country=US&categories=restaurant` (largest country) | ~45 GiB | 10.7 GiB |
| `/places/countries` aggregate | full struct scan | 2.97 GiB |

The US slice is the ceiling. The categories filter ORs across `categories`,
`taxonomy` and `basic_category`, so only the `country` cluster key prunes it.
Column projection would not help much: `parsePlaceRow()` reads nearly every
column, so `SELECT *` stays.

**To deploy:**
1. Build the mirror once (workflow dispatch, or
   `bq query --location=US --use_legacy_sql=false < etl/build-places-country-mirror.sql`).
2. On the Cloud Run service set
   `PLACE_COUNTRY_TABLE=overture-maps-api.overture.place_by_country`. Paid is
   resolved **live from the portal's Firestore** (`your-portal-project`,
   `organizations/{accountId}`: `planId` is the Stripe price, paid = not a Free
   price and status active/trialing/past_due), cached 60s per account, so an
   upgrade takes effect within a minute with no deploy or env change. The
   runtime service account needs `roles/datastore.viewer` on `your-portal-project`.
   Anything uncertain (no doc, unrecognised status, Firestore error or timeout)
   **allows**, so a lookup problem can cost money but never locks out a paying
   customer; watch the logs for `Plan lookup failed`. `PAID_ACCOUNT_IDS` is now
   only an override for accounts Stripe does not model. The paying account
   at the time ran hundreds of country-level queries in July and resolves as
   paid.

   Verified 11 Oct 2026: that account's real country-level parameter sets
   (categories, taxonomy + has_contact) and the 5 Oct name query return the
   same ids, order and `total_count` on the country mirror as on the old path.
3. Deploy, then watch `usage.api_requests.total_bytes_billed` for country rows.

### 8. Id-clustered division_area mirror (`/divisions/:id`, Oct 2026)

`getDivisionById()` read `bigquery-public-data.overture_maps.division_area`
(9.7 GB, clustered by geometry) with `WHERE id = @id`, which cannot prune: about
9 GiB billed for a single-row lookup, 1.6 TiB in the 30 days to 11 Oct 2026, 72 GiB
from one Free account on 10 Oct.

**In code:** `DIVISION_AREA_TABLE` (unset = public table, unchanged behaviour)
points the by-id lookup at `overture-maps-api.overture.division_area`, clustered
by `id` (`etl/build-division-area-mirror.sql`, monthly workflow
`.github/workflows/division-area-mirror.yml`). If the mirror lacks an id (it lags
the public table for up to a few weeks after each release) the lookup falls back
to the public table, so a lagging mirror can never cause a 404. The rare
NULL-geometry sibling fallback still reads the public table.

**To deploy:**
1. Build the mirror once:
   `bq query --location=US --use_legacy_sql=false < etl/build-division-area-mirror.sql`
   (~9.7 GB scan, ~A$0.08).
2. Set `DIVISION_AREA_TABLE=overture-maps-api.overture.division_area` on the
   Cloud Run service, then deploy.

### 9. Monthly request cap, enforced in the API (Oct 2026)

Replaces fix 4 (the auth-api quota that never left `log` mode). `MonthlyQuotaGuard`
(`src/quota/`) runs on every authenticated, non-demo request, after the
per-minute throttler.

| Plan (Stripe price) | Allowance (`monthly_requests`) | Refused from (`soft_limit_requests`) |
|---|---|---|
| Free | 100 | 200 |
| Premium | 1,000 | 2,000 |
| Growth | 4,000 | 6,000 |
| Scale | 10,000 | 20,000 |

Between allowance and limit requests work and carry `X-Quota-Warning`. At the
limit: 429 `monthly_quota_exceeded`, `Retry-After` to 00:00 UTC on the 1st, a
message naming the plan and the upgrade URL. Every response carries
`X-Quota-Plan/-Limit/-Hard-Limit/-Used/-Remaining/-Reset` (exposed via CORS).
Paid plans are capped at their own limit too (decided 11 Oct 2026).

Only requests finishing below 400 count. Auth failures, validation errors, the
paid-only 403 and all 429s are free. The demo key and `PAID_ACCOUNT_IDS` are
exempt. Plan comes from the Firestore lookup; an unknown plan or a paid price
with no configured limits is uncapped.

Counters: Firestore `your-portal-project` / `api_usage_monthly`, doc
`{accountId}_{YYYY-MM}`, incremented in 2s batches per instance (Firestore takes
about one write per second per doc; one account made 11,000 requests in two hours).
A new account-month is seeded from that month's successful rows in
`usage.api_requests` (10 MB per seed), so enforcement mid-month counts from the
1st. Overshoot across instances is a few seconds of traffic. Every failure
(Firestore, BigQuery, timeout) allows the request.

**To deploy:**
1. Grant the runtime service account write access to the counters:
   `gcloud projects add-iam-policy-binding your-portal-project --member=serviceAccount:<runtime-service-account> --role=roles/datastore.user`.
   Without it the guard fails open: headers are missing and nobody is blocked.
2. Deploy. `QUOTA_MODE` defaults to `enforce`; set `QUOTA_MODE=log` on the
   service to dry-run, or `off` to disable, without a code change.
3. Watch logs for `UsageCounterStore` errors and `Seeded ...` lines.

## Order of impact
1 (clustering) removes ~90% of the cost. 5 and 3 stop the abuse patterns. 4 is
the per-user ceiling. 2 is already done. 6 does for `/places/buildings` and
`/buildings` what 1 did for `/places` — until it's deployed, those two
endpoints are the main remaining per-request cost risk, including for paid
tiers where the plan's own margin could otherwise be wiped out by one
large-radius buildings request.
