# Demographics Enrichment Plan — BigQuery Public Data

**Status: PLAN ONLY — nothing implemented yet.**
Goal: enrich Overture places/divisions/locations with demographic data, additively (no breaking changes), using datasets already in BigQuery's `US` multi-region so joins against `bigquery-public-data.overture_maps.*` need no ETL for v1.

## Verified data sources (checked 2026-07-08 with the repo service account)

| Dataset | Coverage | Granularity | Tables (verified) | Notes |
|---|---|---|---|---|
| `bigquery-public-data.census_bureau_acs` | **US only** | block group → tract → county → CBSA → state → ZIP | 278 tables, e.g. `blockgroup_YYYY_5yr`, `censustract_YYYY_5yr`, `county_YYYY_1yr`, `zcta_...` | The rich one: median income, age bands, households, housing, commute, education. **Vintage check needed** — newest visible vintages cluster around 2018–2021; pick latest per geo level in the validation spike. |
| `bigquery-public-data.geo_us_boundaries` | US | states, counties, ZIP codes, CBSAs, urban areas | 16 tables incl. `counties`, `states`, `zip_codes`, `cbsa` | Geometry for point→geo_id joins at coarse levels. Tract/blockgroup geometries live in the separate `geo_census_tracts` / `geo_census_blockgroups` datasets (per-state tables) — confirm in spike. |
| `bigquery-public-data.worldpop.population_grid_1km` | **Global** | 1km grid cells | 1 table: `population_grid_1km` | `geo_id`, `population`, `geog` (GEOGRAPHY), `alpha_3_code`, `last_updated`. Only truly global small-area population source in BQ public data. Huge table — needs an optimised copy (see cost section). |
| `bigquery-public-data.census_bureau_international` | ~200+ countries | **country-level only** | 8 tables: `midyear_population`, `midyear_population_age_sex`, `birth_death_growth_rates`, `mortality_life_expectancy`, `age_specific_fertility_rates`, `country_names_area`, ... | US Census International Database. National population, growth, life expectancy, fertility, age pyramids. |

### What ISN'T in BigQuery public data (answer to "other countries?")

Small-area census data for countries other than the US is **not** in `bigquery-public-data`: no Eurostat/UK ONS/StatCan/ABS equivalents of ACS. The international story is therefore two-tier:

1. **Global 1km population density** via WorldPop (any lat/lng on Earth), and
2. **Country-level indicators** via `census_bureau_international` (plus `world_bank_health_population` / `world_bank_wdi` if we want GDP-adjacent indicators later).

Optional future path: CARTO's Data Observatory publishes some free international layers (e.g. Spatial Features grids with WorldPop + POI density) through BigQuery, but access runs through a CARTO account rather than `bigquery-public-data`, so it's out of scope for v1. Direct ETL of Eurostat NUTS3 / UK ONS output-area data into our own dataset is the long-term option if EU/UK customers ask — flag demand first.

## Product shape (all additive)

### Phase 1 — `GET /demographics` (new endpoint, global)

`?lat&lng&radius` (same conventions as every other endpoint: `GetByLocationDto`, demo-city guard, count header, json/geojson).

Response sketch (follows `api-design.md`: close to source schema, `ext_` for derived):

```json
{
  "location": { "lat": 40.7128, "lng": -74.0060, "radius": 1000 },
  "population": {
    "total": 48213,
    "density_per_km2": 15349,
    "source": "worldpop",
    "year": 2020
  },
  "country": {
    "country": "US",
    "midyear_population": 341000000,
    "life_expectancy": 79.2,
    "growth_rate": 0.5,
    "source": "census_bureau_international",
    "year": 2026
  },
  "us_census": null
}
```

`population` = sum/area-weighted WorldPop cells intersecting the radius. `country` = IDB lookup via the containing Overture division (we already have country resolution). `us_census` populated in Phase 2 for US points, `null` elsewhere — additive when it arrives.

### Phase 2 — US deep-dive (`us_census` block)

Point → containing tract/blockgroup (geometry datasets) → join latest ACS 5yr vintage by `geo_id`. Curated stable field set rather than all 250+ ACS columns: `median_income`, `median_age`, `total_pop`, `households`, `median_rent`, `owner_occupied_housing_units`, `pop_density`, education split, commute time. Keep our field names identical to ACS column names where possible so the docs can link to Census definitions.

### Phase 3 — enrich existing endpoints

- `GET /divisions/{id}`: optional `include=ext_demographics` — aggregate WorldPop over the division geometry (population, density); for US divisions add ACS county/state rollups. Uses the division polygon we already fetch.
- `GET /places`: `enrichment_fields=demographics` via the **existing enrichment adapter** (`PlaceEnrichmentDto`, `ENRICHMENT_BQ_*` pattern) — per-place tract demographics keyed by GERS ID from a precomputed table, so it's a batched key lookup, not a per-request spatial join.

## Cost & performance design (the part that decides feasibility)

1. **WorldPop is the risk.** The public table is global 1km (~hundreds of GB scanned if queried naively). Mitigation, in line with the existing `SOURCE_DATASET` comment ("replace with your own optimised dataset"): one-time copy into `overture-maps-api.optimised.worldpop_1km` **clustered by `geog`** — clustering turns radius queries into small scans (same trick as the existing geometry-clustered queries that bill ~0 GB). Annual refresh at most; add to the drift monitor.
2. **ACS tables are tiny** (dimension tables keyed by `geo_id`) — negligible cost. The spatial step (point → tract) hits tract geometry tables; if per-state tables are awkward, materialise a single national tract-geometry table, also geo-clustered, in the optimised dataset.
3. **IDB country tables are tiny** — free-tier noise. Cache country lookups in-process (static per release, ~200 rows).
4. **Caching:** all three sources update at most annually → the existing cache layer with a long TTL (consider a per-route TTL override; current default 24h is fine to start).
5. **Precompute for places enrichment** (Phase 3): scheduled job joins all US places → tract → curated ACS fields into an enrichment table once per ACS release, keyed by GERS ID. Serving cost is then a keyed lookup.

## Non-goals / guardrails

- No breaking changes; every addition is a new endpoint, new optional param, or new nullable response block.
- No per-request scans of unclustered global tables — optimised copies first.
- Don't promise sub-tract accuracy outside the US; the docs must state granularity per country honestly (WorldPop is modelled data).
- Licensing: WorldPop is CC BY 4.0, Census/ACS/IDB are public domain — attribution goes in the docs page and the `source` fields, consistent with how we surface Overture `sources[].license`.

## Phased delivery

| Phase | Scope | Effort guess |
|---|---|---|
| 0. Validation spike | Confirm latest ACS vintages + tract/blockgroup geometry datasets; WorldPop `last_updated` + dry-run costs before/after clustering; sample the exact field list | small |
| 1. `/demographics` endpoint | WorldPop radius population + IDB country block; optimised WorldPop copy; demo guard; docs | medium |
| 2. `us_census` block | tract/blockgroup ACS join, curated fields, national tract geometry table | medium |
| 3. Enrichment hooks | `ext_demographics` on divisions; `enrichment_fields=demographics` on places (precomputed table) | medium |
| 4. Ops + launch | add datasets to `check-bq-schema-drift` TABLES (needs multi-dataset support — minor refactor); pricing/tier gating via key metadata (same mechanism as `/buildings`); blog post + Igal-style customer notes | small |

## Open questions (to resolve in Phase 0)

1. Latest ACS vintage actually present per geo level (public dataset may lag Census releases by years — affects marketing claims).
2. Tract/blockgroup geometry source: `geo_census_tracts` per-state tables vs TIGER/Line ETL of our own.
3. Whether `/demographics` is a paid-tier endpoint from day one (like `/buildings`) or free with tight radius caps.
4. Population-weighted vs area-weighted apportionment for radius queries that clip WorldPop cells (recommend simple area-weighting v1, documented).
