# Overture Schema Migration Plan — July 2026

**Goal: zero breaking changes for existing API clients.** All response fields keep their current names and shapes. New Overture schema properties are exposed as additive fields only.

> **Status (2026-07-08): Phases 1–4 implemented and verified** — build green, 61 unit tests passing (incl. new parser shim tests), live smoke queries against `bigquery-public-data.overture_maps` confirmed for the dual-vocabulary category filter, taxonomy hierarchy filter, operating_status filter, getCategories, and the divisions admin_level filter. Remaining manual steps: rebuild the divisions search index (`npm run etl:divisions-search-index`) so index-served responses carry `admin_level`/`is_land`/`is_territorial`/`division_id`, and add the `bq-schema-drift.yml` workflow secrets check on first run.

## Verified state of the BigQuery mirror (checked 2026-07-08)

Checked `bigquery-public-data.overture_maps.*` table metadata using the repo service account (`github-actions-runner@overture-maps-api`). All tables last modified **2026-06-18**, i.e. the mirror is already on Overture release `2026-06-17.0` / schema v1.17.0.

| Column | Table | Status in mirror |
|---|---|---|
| `basic_category` (STRING) | `place` | ✅ live |
| `taxonomy` (RECORD: `primary`, `hierarchy`, `alternates`) | `place` | ✅ live |
| `operating_status` (STRING, nullable) | `place` | ✅ live |
| `categories` (RECORD: `primary`, `alternate`) | `place` | ✅ still present — **removed by Overture in September 2026** |
| `admin_level` (INTEGER) | `division_area` | ✅ live |
| `is_land`, `is_territorial`, `division_id` | `division_area` | ✅ live (were never mapped by us) |
| `bbox.*` | all | still FLOAT in BQ — the March FLOAT→DOUBLE note was Parquet-only, no action needed |

Also confirmed: `place`, `segment`, `division_area` tables have **no** `theme`, `type`, or `update_time` columns — our row parsers that read `row.update_time` / `row.theme` / `row.type` on those tables are already silently emitting `undefined`. Pre-existing, not urgent, but worth tidying while we're in there.

## Exposure to the September `categories` removal

When Google mirrors the September release, the `categories` column disappears. Impact by call site in `src/bigquery/bigquery.service.ts`:

1. **Hard failures (SQL errors → 500s):**
   - `getCategories()` (~line 138): `SELECT DISTINCT categories.primary ... WHERE categories.primary IS NOT NULL` — the whole `/places/categories` endpoint dies.
   - `category` filter on `/places` and `/places/buildings`: `categories.primary IN UNNEST(@categories)` at ~lines 216, 365, 779 — any request using the filter dies.
2. **Silent data loss:** `bq-place-row.parser.ts` maps `categories{primary,alternate}` — the response field becomes `undefined`/absent for every place. Clients reading `categories.primary` break.

## Plan

### Phase 1 — additive fields (now, no client impact)

Ship purely additive changes:

- `bq-place-row.parser.ts`, `Place` interface, `PlaceResponseDto`: add `operating_status`, `basic_category`, `taxonomy` (primary, hierarchy, alternates). Keep `categories` exactly as-is.
- `bq-division-row.parser.ts` + divisions DTO: add `admin_level` (and optionally `is_land`, `is_territorial`, `division_id` since they're free).
- Sources parsing: add the `license` field (added schema-wide in v1.12, currently dropped).
- Optional new query params (additive, so safe): `operating_status` filter on `/places`, `admin_level` filter on `/divisions`.

New JSON fields on existing responses are backwards compatible for any reasonable REST client.

### Phase 2 — decouple from the doomed column (target: mid-August, hard deadline before the September release lands in the mirror, ~17 Sep)

Keep the public contract identical; change what feeds it:

- **Response shim:** in the place parser, populate the outgoing `categories` field from the source column if present, else derive it: `categories.primary ← taxonomy.primary` (fallback `basic_category`), `categories.alternate ← taxonomy.alternates`. Field name and shape never change. Caveat to document: taxonomy values are a different classification set, so the *strings* inside `categories` will shift after September. That's an upstream data change, not an API shape change — call it out in the changelog/docs.
- **Filter shim:** change the `category` filter SQL to match against taxonomy: during transition, `(categories.primary IN UNNEST(@categories) OR taxonomy.primary IN UNNEST(@categories))`; after removal, taxonomy only. Guard with a `COLUMN_EXISTS`-style feature flag (see Phase 3) rather than a date.
- **`/places/categories`:** switch the query to `taxonomy.primary` (or `basic_category`), aliased to the same response keys (`primary`, `counts`). Same response shape, new vocabulary.
- Add a `taxonomy` filter param as the documented go-forward option; mark `category` values from the old vocabulary as deprecated in the dev portal docs, but never remove the param.

### Phase 3 — schema drift monitoring (cheap insurance)

We track Google's mirror with no version pin, so upstream changes land under us silently. Add a scheduled GitHub Actions job (monthly, after Overture's release week) that pulls table metadata (free `tables.get` calls, no query cost — same technique as this verification) and diffs column names/types against a checked-in snapshot, failing loudly on drift. Reuse the existing divisions-search-index workflow pattern.

### Phase 4 — cleanup (opportunistic)

- Fix row parsers reading non-existent columns (`update_time`, `theme`, `type` on place/segment/division_area) — either drop or synthesise them.
- The base theme UNION query (`bigquery.service.ts:568-572`) has a hardcoded column list; no changes upstream this cycle, but the drift monitor from Phase 3 covers it.

## What we will NOT do

- Remove or rename the `categories` response field.
- Remove the `category` query param.
- Change any existing response key, nesting, or type.

## Timeline

| When | What |
|---|---|
| ✅ Done (July 8) | Phases 1–4: additive fields, categories/filter shims, drift monitor, parser cleanup |
| After next deploy | Rebuild divisions search index so it carries admin_level |
| ~17 September | Overture drops `categories`; the column-existence check flips the SQL automatically within 6h, responses keep the `categories` field derived from taxonomy |

## Implementation notes (for the September switchover)

- `BigQueryService.getPlaceColumns()` caches the place table's column list from table metadata (free) for 6h; query builders consult it, so no redeploy is needed when Google mirrors the September release.
- Response `categories` is derived in `bq-place-row.parser.ts` from `taxonomy.primary`/`basic_category` when the source column is absent. The *values* will shift to the new vocabulary at that point — flag in the public changelog ahead of time.
- The `categories` query param matches both vocabularies (`categories.primary OR taxonomy.primary OR basic_category`) while the column exists, taxonomy-only after.
- New additive query params: `taxonomy` (hierarchy-aware) and `operating_status` on `/places` and `/places/buildings`; `admin_level` on `/divisions`.
- `etl/check-bq-schema-drift.ts` + `.github/workflows/bq-schema-drift.yml` (Thursdays 05:00 UTC) diff the mirror's schema against `etl/bq-schema-snapshot.json`; refresh with `npm run etl:check-bq-schema-drift -- --update` after reviewing any drift.
