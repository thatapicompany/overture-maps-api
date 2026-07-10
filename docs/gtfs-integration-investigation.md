# GTFS Integration — Investigation

**Status: INVESTIGATION ONLY — nothing implemented.**
Question: can we join open transit data (GTFS) with Overture data to ship customer-facing transit features, and what would it take?

## Source assessment: the Mobility Database (verified 2026-07-08)

Analysed the live catalog (`https://files.mobilitydatabase.org/feeds_v2.csv`, 6,342 rows):

| Metric | Value |
|---|---|
| Active GTFS schedule feeds | **2,722** (plus 1,707 active GTFS-Realtime; 941 deprecated / 697 inactive excluded) |
| Countries covered | **87** |
| Top countries (active GTFS) | US 918, JP 539, FR 484, CA 136, ES 118, IT 88, SE 60, DE 39, GB 38, PL 37, AU 30, PT 26 |
| Feeds with a **stable mirrored download URL** (`urls.latest` on files.mobilitydatabase.org) | **2,623 / 2,740 (96%)** |
| Feeds with a bounding box in the catalog | 2,585 / 2,740 (94%) |
| Feeds with a licence URL | **1,534 / 2,740 (56%)** ⚠️ |

Key operational facts:

- MobilityData re-checks every producer URL **daily at midnight UTC** and mirrors new versions — so we ETL from their stable mirror, not from 2,700 flaky agency URLs. This removes the classic GTFS-aggregation pain.
- The catalog CSV is public, no auth. Their **API** (feed metadata, latest-dataset hashes for incremental sync) needs a free account + refresh token.
- The catalog itself is commercially usable (their FAQ/terms) — but the catalog's licence is **not** the feeds' licences (see risks).
- Note: DE/GB look under-represented as raw counts because they publish **national aggregate feeds** (one feed = whole country via their National Access Points) — coverage is better than counts suggest.

### What's already in BigQuery public (spoiler: not much)

Only stale city one-offs: `san_francisco_transit_muni`, `new_york_subway`, citibike/bikeshare tables. Nothing global, nothing maintained. **We'd be building our own transit dataset in BigQuery — which is also the moat.** Nobody else offers "Overture places + transit proximity" as one API.

## Data model (v1)

Parse only the small, high-value GTFS files; skip the giant ones initially:

| GTFS file | Keep? | Notes |
|---|---|---|
| `stops.txt` | ✅ core | id, name, lat/lng, location_type, wheelchair_boarding, parent_station. Global estimate: **~3–6M stops** across active feeds — small for BigQuery. |
| `routes.txt` | ✅ core | route type (bus/rail/metro/tram/ferry), short/long name, agency. ~100k rows. |
| `agency.txt` | ✅ core | operator names, tz. |
| `stop_times.txt` + `calendar*.txt` | ⚠️ aggregate only | Hundreds of GB globally as raw rows. v1: reduce at ETL time to per-stop **service metrics** (routes serving the stop, avg weekday departures, first/last departure) and discard the raw rows. Raw schedules/routing = explicit non-goal. |
| `shapes.txt` | ❌ v1 | Route geometries — nice later for map overlay; big and low query value initially. |
| GTFS-Realtime | ❌ v1 | Different infra (streaming); revisit if customers ask for live arrivals. |

Target: `overture-maps-api.transit.{feeds, agencies, routes, stops, stop_route_summary}` with `stops` **clustered by a GEOGRAPHY point column** — same trick as everything else, so radius queries bill ~0 GB.

## ETL design

Weekly Cloud Run job (GitHub Actions can't comfortably hold ~15–30GB of zips):

1. Pull catalog CSV → active GTFS feeds with a mirrored `urls.latest`.
2. Incremental: compare Mobility Database API's latest-dataset hash per feed vs our last-loaded hash; download only changed feeds (typically a few hundred/week, not 2,700).
3. Per feed: stream-unzip, parse the 4 small files + aggregate stop_times → load staging → swap into BigQuery (per-feed partitions keyed by feed id, so one bad feed never poisons the table).
4. Data quality gate: MobilityData publishes Canonical GTFS Validator reports per feed — skip feeds with fatal validation errors, record why.
5. Provenance columns on every row: `feed_id`, `provider`, `feed_licence_url`, `fetched_at` — mirrors how we surface Overture `sources[].license`.

Dedupe caveat: overlapping feeds exist (agency feed + regional aggregate + national aggregate → same physical stop 2–3×). v1 mitigation: prefer `is_official` feeds and de-prioritise aggregates where an official feed covers the same bbox; accept imperfection, document it.

## API surface (all additive, consistent with existing conventions)

1. **`GET /transit/stops?lat&lng&radius`** — stops nearby with name, modes, operators, wheelchair flag, `ext_distance`, per-stop service summary. Same DTO/guard/cache/format patterns as every other endpoint.
2. **`ext_nearest_transit` on `/places`** (opt-in via `includes` or `enrichment_fields`) — nearest stop + distance + modes per place. Precomputed monthly into an enrichment table keyed by GERS ID (places × geo-clustered stops join), so serving is a key lookup — the enrichment adapter already supports exactly this.
3. **`/divisions/{id}` transit summary** (later) — stop count / modes / operators within a division. Cheap once stops are geo-clustered.
4. **Site-selection composite** (later, premium): places + demographics + transit proximity in one call — the differentiated product this all builds towards.

## Risks & open questions

1. **Licensing is the real risk.** 44% of active feeds list no licence URL, and the rest are heterogeneous (CC-BY, ODbL, custom agency terms; some prohibit redistribution without attribution, a few require agreements). Mitigation: carry per-feed licence in responses, publish an attribution page, and consider a conservative launch set (feeds with clear open licences — still likely 1,500+ feeds incl. all the big NAP countries). Needs a proper pass in the pilot; worth a quick legal sanity check before GA.
2. **Feed quality variance** — validator-gated ingest (above) handles the worst; expect long-tail weirdness (stops at 0,0 etc.); add sanity filters (stop within feed bbox).
3. **Dedupe across overlapping feeds** — accepted v1 imperfection, see above.
4. **Freshness claims** — weekly ETL on daily-checked mirrors ⇒ "stops updated within ~8 days"; fine for schedule-level data, must not be marketed as realtime.
5. **stop_times aggregation cost** — the one heavy compute step (national feeds are GBs). Prototype with `stop_times` streaming aggregation on 3 exemplar feeds (one small agency, one French NAP national, one Japanese aggregate) before committing to per-stop departure metrics in v1; drop to "routes-per-stop" only if too heavy.
6. Does GBFS (bikeshare docks — realtime-ish station info, MIT-licensed catalog) ride along for near-free later? Probably, same pipeline shape.

## Suggested path

| Phase | Scope |
|---|---|
| 0. Pilot (1–2 weeks) | ETL prototype on ~10 feeds across US/FR/JP/AU incl. one national aggregate; validate parse + stop_times aggregation cost; licence audit of top-50 feeds by coverage |
| 1. `/transit/stops` | Full ETL (validator-gated, licence-tagged), geo-clustered stops table, endpoint + docs + blog |
| 2. Places enrichment | Precomputed `ext_nearest_transit` via enrichment adapter |
| 3. Divisions summary + GBFS + shapes | Demand-driven |

**Recommendation:** worth doing — the source is healthier than expected (96% stable mirrored URLs, daily upstream checks, validator reports for free), volumes are BigQuery-trivial once stop_times is aggregated at ETL time, and it composes with what we shipped this week (taxonomy filtering + demographics later = site-selection API). Licensing diligence is the gate: do the Phase 0 licence audit before promising customers anything.
