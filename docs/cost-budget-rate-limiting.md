# Rate limiting and cost control inside the API (no auth-api dependency)

Status: plan, 10 Oct 2026, revised after review. Sections 2 and 3 built on
`feat/places-country-mirror`, 11 Oct 2026. Follows the July 2026 runbook
in `etl/bigquery-cost-controls.md`; fix 4 there (monthly quota enforced in the
auth-api via `MONTHLY_QUOTA_MODE=enforce`) is replaced by this.

## Why

5 and 6 Oct 2026 cost about A$70 of BigQuery Analysis in two days against a
baseline under A$1 a day. Both accounts were Free-plan signups, not test
accounts, and nothing we run stopped them:

- TobiaScivoletto (`2255a93b…`, signed up 16:59 UTC on 5 Oct) made 109
  `/places?name=…&country=IT` calls from 17:09. Each scanned the full 45.5 GiB
  place mirror because nothing in the predicate prunes a geometry-clustered
  table. 4.85 TiB, about A$41, in three hours.
- Suntria (`ac81fa05…`, `quotaState=EXCEEDED` in Twenty since 15 Sep) swept
  Oklahoma City with 11,278 `/buildings?radius=40` calls in two hours on 6 Oct.
  8,917 were 429'd, 2,361 ran at 1.4 GiB each. 3.25 TiB, about A$27.

The same `/places` country shape produced the 14 Sep spike (Codoma.tech,
7.1 TiB) and smaller hits from Dreamer-Land, JoinAppex and petsns. Country
queries are 9% of requests and 85% of spend. Total Overture MRR is US$25
(IwannaFind, Premium).

What exists today and why it did not help:

| Control | Where | Gap |
|---|---|---|
| TheAuthAPI per-key limit (100/min Free, 120/min paid) | auth-api | Per minute only. 100 country scans a minute is A$38 a minute. |
| Monthly cap 100 / soft 200 | auth-api, `MONTHLY_QUOTA_MODE=log` | Never enforced. Backfill script never written. 27 Free accounts are over it. |
| `ThrottlerGuard` 60/min | API, global | Keyed per IP, tier-blind. |
| Country-level needs a narrowing filter | `places.controller` | `name`, `categories`, `brand_name` count as narrowing but none of them prune. |
| `quotaState` SOFT / EXCEEDED | Twenty, written by the outreach job | Read by nobody at request time. |
| Redis response cache | API | Only helps repeated identical queries. Every name was different. |

## Principles

1. **The customer-facing limit is requests per month and per minute**, which
   is what the pricing page says and what a user can count. Bytes are never
   a number a customer has to reason about.
2. **Make a request cost roughly the same whatever its parameters**, so a
   request count is a fair proxy for cost. Today one request can bill 20 MiB
   or 45 GiB; the count cannot tell them apart. Enforcing 100 a month on
   Tobia would still have cost about A$38.
3. **Shapes that cannot be made cheap are gated by plan, not by a hidden
   threshold.** Country-level without lat/lng is paid tiers only.
4. **Byte caps exist only as backstops**, set where no legitimate query can
   reach them, so nobody discovers them by trial and error.
5. Nothing here calls TheAuthAPI. The auth middleware keeps resolving the
   key as now; everything below reads only the `accountId` and
   `isDemoAccount` it already puts on `res.locals.user`.

## Design

### 1. Request counts, enforced in the API

A `QuotaGuard` registered as a global guard after `ThrottlerGuard`. Two
counters per account in Firestore (atomic `FieldValue.increment`, in the
`overture-api` project the plan lookup already reads), with an in-process
`Map` behind the same interface for tests. There is no Redis: confirmed 11 Oct
2026 that no Memorystore API is enabled, the service has no VPC path, and none
of its 50 revisions ever set `REDIS_URL`.

- `quota:{accountId}:min:{epochMinute}` for the per-minute limit.
- `quota:{accountId}:month:{YYYY-MM}` for the monthly allowance.

Limits per tier, from the Stripe product metadata so pricing has one home:
Free 100/month at 100/min, Premium 1,000/month at 120/min, Growth and Scale
per their metadata. Demo key: 100/day, lat/lng only, as now.

Only requests that reach a controller count. 401s, 400s from validation and
the guard's own 429s do not, so a user cannot be charged allowance for being
rate limited. Cache hits do count: the allowance is for API calls, not
BigQuery jobs, and the docs already say so.

Soft and hard:

- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
  `X-RateLimit-Reset` for the minute window, and `X-Quota-Limit`,
  `X-Quota-Remaining`, `X-Quota-Reset` for the month. Add them to CORS
  `exposedHeaders`.
- Soft is a threshold, not a block: at 80% of the month a log line is
  written and the outreach job's existing `quotaState=SOFT` becomes true in
  the API's own counters rather than Twenty's guess.
- Hard: 429 with `Retry-After` (seconds to the next minute, or to the first
  of next month UTC) and a body naming the allowance and the upgrade URL.
  No BigQuery job is created.

Tier resolution (built 11 Oct 2026, `tiers/plan-lookup.service.ts`): read
live from the portal's Firestore, `organizations/{accountId}`. `planId` is the
Stripe price; paid = not a Free price and status active/trialing/past_due.
Cached 60s per account, so an upgrade takes effect within a minute. Unknown
(no doc, error, timeout) allows paid-only features. `PAID_ACCOUNT_IDS` is an
override only. The quota guard reads the same lookup for per-tier limits.

Enforcing the monthly cap for the first time will 429 the 27 Free accounts
currently over it. The outreach job already emails upgrade candidates;
make sure the 429 body and that email say the same thing, and give a dated
notice before the switch.

### 2. Country-level queries are paid tiers only

In `places.controller`, when `country` is set and lat/lng are not, a Free
or demo account gets a 403 with:

> Country-level queries are available on paid plans. Free plans query by
> lat, lng and radius (up to 25 km). See overturemapsapi.com/pricing.

This is deterministic, documented, and matches the radius error text that
already says "Increase plan or request data at a country level". It removes
85% of spend from the tier that produces no revenue, and it would have
stopped every one of the September and October incidents at request one.
Built: `places/places-cost-guards.ts`, tier from `PAID_ACCOUNT_IDS` or
`isPaidAccount: true` in TheAuthAPI key metadata (`middleware/account-tier.ts`).

Paid tiers keep country-level queries, and the mirror below makes them
cheap enough that the request count is a fair charge for them: worst case
is a US query at 10.7 GiB, about US$0.065.

### 3. Country-clustered mirror, so country queries prune

Clustering by geometry fixed radius queries in August. Country-only queries
never had an equivalent. Build a second mirror, rebuilt monthly alongside
the places mirror:

```sql
CREATE OR REPLACE TABLE `overture-maps-api.overture.place_by_country`
CLUSTER BY country, basic_category
AS
SELECT addresses.list[SAFE_OFFSET(0)].element.country AS country,
       LOWER(names.primary) AS name_lower,
       *
FROM `overture-maps-api.overture.place`;
```

`getPlacesNearby()` reads `PLACE_TABLE` when lat/lng are present and
`PLACE_COUNTRY_TABLE` otherwise, filtering on the top-level `country`
column so the cluster prunes. `name` matches `name_lower` instead of
`LOWER()` at query time. Extra storage is about 47.5 GB at US$0.02 per
GiB-month. Also routed: `/places/brands`, `/places/categories` and
`/places/countries` when they have no lat/lng.

Built and measured 11 Oct 2026, real runs (dry-run estimates ignore cluster
pruning):

| Query | Before | After |
|---|---|---|
| `country=IT&name=...` (the 5 Oct shape) | 45.5 GiB | 1.51 GiB |
| `country=AR&categories=inn` (September shape) | 40 to 45 GiB | 0.56 GiB |
| `country=US&categories=restaurant` (largest country) | ~45 GiB | 10.7 GiB |
| `/places/countries` aggregate | full struct scan | 2.97 GiB |

The US slice is the ceiling: the categories filter ORs across `categories`,
`taxonomy` and `basic_category`, so only the `country` key prunes it. Column
projection was considered and dropped, because `parsePlaceRow()` reads nearly
every column and it would save little.

### 4. Backstops nobody should ever see

**Per job.** `BigQueryService.runQuery()` passes `maximumBytesBilled` on
`createQueryJob`. BigQuery enforces it on actual bytes billed after pruning,
and a job that exceeds it fails with `bytesBilledLimitExceeded` and is not
charged. The last 30 days of `usage.api_requests` split cleanly: every
legitimate shape bills under 1.5 GiB, divisions-by-id with geometry bills
8.8 GiB, and then nothing until the 40 to 45 GiB whole-table scans. Set the
cap at **16 GiB** and it never touches a real query (the US country slice,
the largest shape, bills 10.7 GiB). When it does fire,
`runQuery()` maps it to a 400 whose message names the fix (add lat/lng, or
narrow the country filter) and the usage row records `bytes_billed = 0`
with `error = bytes_billed_limit_exceeded`. Do not lower it below 12 GiB
while the US slice is 10.7 GiB. This is not a documented limit and should not appear in the
pricing or docs; it is there for the shape we have not thought of yet.

**Per project.** In the Cloud console, IAM & Admin > Quotas > BigQuery API:
"Query usage per day" for the project at 2 TiB (about A$17), and "Query
usage per day per user" for `overture-maps-api-runtime-sa` at 1 TiB. Over
that the API returns 503s for the rest of the UTC day, which is the right
failure when the alternative is an unbounded bill. Plus a Cloud Billing
budget at A$150 a month with alerts at 50, 80 and 100 per cent. No deploy
needed; can be done today.

### Also fix

- `runQuery()` prices at US$5 per decimal TB. On-demand is US$6.25 per
  TiB, so `cost_usd` in `usage.api_requests` is about 12% low. Change to
  `6.25 / 2**40` per byte and record the rate on the row.
- Re-key `ThrottlerGuard` on `accountId` with IP fallback for anonymous
  traffic, or retire it once `QuotaGuard` carries the per-minute limit.
- The outreach job's `quotaState` should be derived from the API's counters
  (exported nightly to `usage.account_monthly_usage`) rather than computed
  separately, so the dashboard, the 429 body and the email agree.

## Rollout

1. Today, no deploy: project quotas and billing budget. Optionally email
   Tobia and Kyle; both hit a wall they could not see.
2. Done 11 Oct 2026 on `feat/places-country-mirror`: country-level
   paid-only gate with the plan read live from Firestore, `cost_usd` rate
   fix, country mirror and id-clustered division_area mirror built in
   BigQuery, routing, workflows. Still to do from the original PR A:
   `maximumBytesBilled` at 16 GiB with the 400 mapping and usage row fields.
3. Monthly cap built 11 Oct 2026 on `feat/monthly-request-cap`
   (`src/quota/`, runbook section 9): Free warns at 100 and is refused from
   200; paid plans are refused at their own soft limit (Premium 2,000, Growth
   6,000, Scale 20,000); enforced on deploy with the month seeded from
   BigQuery. Still to do: re-key `ThrottlerGuard` per account.
   Unit tests with a fake clock across minute and month boundaries. E2E with
   BigQuery mocked, replaying the 5 and 6 Oct parameter sets from
   `usage.api_requests`: the 109 name scans 403 at request one, the
   buildings sweep 429s at request 101.
4. Enforcement on deploy was chosen over a notice period (11 Oct 2026).
   At that date 7 Free accounts were already past 200 for October: Suntria,
   CWYC, Joey, PawPrints Dispatch, TobiaScivoletto, Cost Seg Smart, tasneem.
5. Country mirror: done in step 2. Measured; the backstop stays at 16 GiB.
6. Observability: scheduled query producing per-account daily requests and
   bytes into `usage.account_daily_usage`; log-based alert on any account
   over 50 GiB in a day.

## Decisions taken

- Request counts are the customer-facing limit; byte caps are backstops only
  (10 Oct 2026).
- Country-level queries without lat/lng are paid tiers only (10 Oct 2026).
- Country-level queries read `overture.place_by_country`, clustered by
  country (built 11 Oct 2026).
- Paid plan is read live from the portal's Firestore, not an env list or a
  scheduled export; uncertain lookups allow (11 Oct 2026).
- Quota counters live in Firestore; there is no Redis (11 Oct 2026).
- Monthly cap: allowance and refusal point from Stripe metadata
  (`monthly_requests`, `soft_limit_requests`); paid plans are capped at their
  soft limit too; enforce on deploy (11 Oct 2026).

## Open

- Whether to remove `ThrottlerGuard` entirely once `QuotaGuard` carries the
  per-minute limit, or keep it as the anonymous-traffic limiter.
- Whether the 16 GiB backstop should be lower for Free (radius queries bill
  under 1.5 GiB) once divisions-by-id has its own fix. Not needed for the
  incident class we have seen.
