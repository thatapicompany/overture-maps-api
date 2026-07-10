# Wikidata Brand Enrichment — Investigation

**Status: INVESTIGATION ONLY — nothing implemented.**
Premise: every branded Overture place already carries `brand.wikidata` (a QID). Joining Wikidata turns that dangling ID into logos, websites, corporate hierarchy and industry — high perceived value, and the key numbers make it almost free to build.

## Verified findings (2026-07-08, service account + live SPARQL)

### Overture side

| Metric | Value |
|---|---|
| Total places | 75.6M |
| Places with a `brand.wikidata` QID | **1,551,383** |
| **Distinct brand QIDs** | **3,019** ← the number that matters |
| Top QID brands | ダイドー (76k places), Wildberries (55k), Western Union (40k), サントリー (36k), Amazon Locker (33k)... noticeable JP skew |

3,019 distinct entities means **no dumps, no big ETL** — the entire enrichment dataset is a ~3k-row table refreshed monthly. (Caveat: `COUNTIF(brand IS NOT NULL)` returns ~60M but that's a struct artifact; 1.55M places with QIDs is the real reach, ~2% of places — but they're exactly the chains customers ask about.)

### Wikidata access paths

1. **SPARQL (WDQS)** — verified live: batched `VALUES` queries return per QID: label, **logo** (P154, as a Commons `Special:FilePath` URL — hotlinkable and resizable with `?width=200`), **official website** (P856), **parent org** (P749) / owner (P127), **industry** (P452), **stock ticker** (P249), plus available if wanted: social handles (P2002/P2003/P2013), founded (P571), HQ (P159). 3,019 QIDs ≈ ~30 batched queries — minutes, well inside rate limits (set a proper User-Agent).
2. **`bigquery-public-data.wikipedia.wikidata`** — 90.7M rows / 1.7TB, **actively maintained (last modified yesterday)**. Useful as an in-warehouse supplement for multilingual labels/descriptions (en/ja/es/fr/de — the JA labels matter given the brand skew) and `instance_of`/`industry`. But it's a trimmed projection: **no logo/website/parent/ticker columns**, so SPARQL remains the primary source.
3. Per-entity REST (`Special:EntityData/{QID}.json`) — fallback if WDQS misbehaves.

### Licensing — the good news story

Wikidata data is **CC0**. No attribution requirement, no share-alike, fully commercial-safe — the cleanest licence of any dataset we've looked at. One nuance: **logo image files** live on Wikimedia Commons with per-file licences (most corporate logos are `PD-textlogo`, but trademark law still applies to *use*). We serve the logo **URL**, we don't rehost; docs should state that trademark-compliant usage is the customer's responsibility. Standard practice across the industry.

## Proposed architecture

**ETL (monthly, GitHub Actions — this one's small enough):**
1. One cheap BigQuery query → distinct QIDs from `place.brand.wikidata` (also catches new brands as Overture adds them).
2. Batched SPARQL → fields above; optional join to `wikipedia.wikidata` for ja/es/fr/de labels + descriptions.
3. Sanity gates (Wikidata is world-editable): logo URL must be `commons.wikimedia.org`, website must be http(s), field-level diff vs previous snapshot with a review threshold — a vandalised month must be rollback-able. Keep dated snapshots in GCS.
4. Output: `brands.ndjson.gz` artifact in GCS (~3k rows) + a small BigQuery table for warehouse joins.

**Serving — the elegant part:** 3,019 rows fits in process memory. Load the artifact at startup exactly like the divisions search index (`GcsService`, daily staleness check, `isReady()` fallback). Enrichment is then a zero-latency, zero-BigQuery-cost in-memory lookup by QID at response time.

**API surface (all additive):**
1. `/places/brands` — add `ext_logo_url`, `ext_website`, `ext_industry`, `ext_parent`, `ext_ticker` per brand. Instant visual upgrade for anyone building brand pickers.
2. `/places` — opt-in `enrichment_fields=brand` (or `includes=ext_brand`) decorating each branded place from the in-memory table. Note: this path doesn't need the BQ enrichment adapter since it's QID-keyed, not GERS-keyed.
3. Later, if pull exists: `GET /brands/{qid}` detail endpoint (brand metadata + place counts by country — the count query we already run for `/places/brands`).

## Risks / caveats

- **Reach is 3,019 brands, not all brands** — plenty of Overture brand structs have names but no QID. Honest docs: enrichment applies where Overture ↔ Wikidata linkage exists. (Upstream contribution angle: missing QIDs are fixable in Overture/Wikidata — good community optics.)
- **Fill-rate unknown until we run it** — not every QID has a logo/website. Phase 0 measures this; guess: logos ~70%+, websites ~85%+ for chain brands.
- **Vandalism/drift** — mitigated by snapshot + diff gates above; monthly cadence limits exposure.
- **WDQS reliability** — occasional brownouts; ETL retries + last-good-snapshot fallback make this a non-event.

## Suggested path

| Phase | Scope | Effort |
|---|---|---|
| 0. Fill-rate spike | Run the full 3,019-QID SPARQL extract once, measure logo/website/industry/parent/ticker coverage, eyeball top-100 brands for quality | ~half a day |
| 1. ETL + `/places/brands` ext fields | Monthly workflow, GCS artifact, in-memory service, response fields, docs | small |
| 2. `/places` brand enrichment + blog | `enrichment_fields=brand`, attribution/trademark note in docs, launch post | small |

**Recommendation:** do it — this is the best effort-to-value ratio of the three datasets investigated (demographics, GTFS, Wikidata). CC0 licence, 3k-row scale, reuses two patterns we already have (GCS-artifact ETL + in-memory index), and it makes the API visibly richer in demos: logos next to place results sell themselves. Sensible sequencing: Wikidata first (days), GTFS pilot second (weeks), demographics when validated.
