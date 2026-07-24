# Brand name → Wikidata QID map (enrichment fallback)

Prototype for recovering brand enrichment on places where `brand.wikidata` is
null. Built and measured against `bigquery-public-data.overture_maps.place`
(July 2026). SQL: `build-brand-name-qid-map.sql`.

## The problem

Brand enrichment (logo, official website, industry, parent) is keyed by the
Wikidata QID on `brand.wikidata`. But most branded places don't have one:

| | places |
|---|---|
| branded (have a `brand.names.primary`) | 13,193,513 |
| …of which `brand.wikidata` is null/invalid | **11,642,225 (88%)** |

So enrichment silently no-ops for the vast majority of chains — including Greggs.

## The approach — self-sourced, no external matching

The same brand name usually appears **with** a QID on some Overture rows and
**without** on others. We learn `name → QID` from the populated rows and apply it
to the null ones. Because the QID comes from Overture's own data, it's already in
the brands-enrichment artifact, so enrichment "just works" once the QID is filled.

**Upside:** the map recovers **939,338 null-wikidata places (8.1%)** across
**2,052 brand names**. Greggs is recovered cleanly: `greggs → Q3403981`, 281
supporting rows, dominance 1.0, fixing 2,065 null Greggs.

## Confidence tiers

`dominance` = share of a name's QID-bearing rows that agree on the top QID.

| tier | rule | names | auto-apply? |
|---|---|---|---|
| `high` | 1 QID, ≥5 supporting rows | 1,867 | **yes** |
| `review_high_dominance` | >1 QID but top QID ≥95% | 8 | no — quick confirm |
| `review_ambiguous` | >1 QID, top QID <95% | 22 | no — needs a decision |
| `review_low_support` | 1 QID, <5 supporting rows | 155 | no — spot-check |

Only the **high** tier ships automatically (874k of the 939k places). The other
**185 names need a human look** before they're applied — a wrong logo is worse
than no logo, so the default is "don't apply until reviewed."

## How to review (the ~185 non-high names)

Work `brand_name_qid_review` top-down (it's ordered by `null_places_recoverable`,
so you're always spending review time where it matters most). Record every
decision in `brand_name_qid_overrides` — that table is never dropped by the
monthly rebuild, so your decisions stick.

1. **`review_high_dominance` (8 names — e.g. lidl 0.98, taco bell 0.99, carrefour
   0.96, santander 0.97).** The minority QID is almost always a single mis-tagged
   row. Glance at the `best_qid`, confirm it's the right brand, and approve:
   `INSERT … (name_norm, qid, approved) VALUES ('lidl','Q151954',TRUE)`.

2. **`review_ambiguous` with low dominance (~20 names — the real traps).** The
   name genuinely maps to different companies, usually splitting by country:
   - `aldi` (0.59) — Aldi Nord vs Aldi Süd
   - `travelodge` (0.60) — Travelodge UK and Travelodge US are different companies
   - `woolworths` (0.69) — Australian supermarket vs the defunct UK/US chains
   - `t-mobile`, `staples`, `giant`, `jet`, `sonic`, `billa`, `a&w` … similar
   For these, either **leave them unapproved** (stay null — always safe), or add a
   **country-scoped** override (`country='DE'`, `'GB'`, …) so each region gets the
   right entity. Don't approve a single global QID for these.

3. **`review_low_support` (155 names, <5 rows).** Thin evidence — the risk is one
   mis-tagged record inventing a mapping. Skim the QID; approve the obvious ones,
   ignore the rest. Low volume, low stakes.

Two review files accompany this:
- `brand-map-review.csv` — just the 185 rows needing review.
- `brand-name-qid-map-candidates.csv` — the full 2,052-row map for reference.

## Integrating it (next step, not built yet)

The applied table `brand_name_qid_map` is `name_norm → qid`. To wire it into
serving, mirror the brands-enrichment pattern: export it to a small GCS NDJSON
artifact, load it into memory next to `BrandsEnrichmentService`, and in the place
parser, when `brand.wikidata` is null, resolve `name_norm → qid` then call the
existing `brandsEnrichment.get(qid)`. Stamp provenance on the response
(`ext_brand.matched_by: "wikidata" | "name"`) so consumers can tell sourced from
inferred. Keep it additive (`ext_`) per the backwards-compatibility rule.
