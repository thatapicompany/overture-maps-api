# OSM contact enrichment — investigation & plan

_Goal: strengthen location + brand + website + phone for places, sourcing gaps
from OpenStreetMap. No web crawler for now (needs its own planning; an SMB
contact database may be a better route). Triggered by the first Premium
customer ("IwannaFind"), who is building a UK used-car-dealer finder and
explicitly requested website + brand data._

## Headline finding: a parser bug was hiding most of the data

Before building anything, we measured fill rates on 400 live `used_car_dealer`
places in GB (`min_confidence=0.50`):

| Field | Fill rate (as served) | Notes |
|-------|----------------------|-------|
| phones | 100% | populated |
| addresses | 100% | populated |
| socials | 33% | populated |
| brand (Wikidata) | 23% | populated |
| **websites** | **0%** | **bug — see below** |
| **emails** | **0%** | **bug — see below** |

`websites` and `emails` are Overture `array<string>` columns, returned by
BigQuery in the `{ list: [{ element }] }` shape — identical to `phones` and
`socials`. The parser read `phones`/`socials` via `.list.map(x => x.element)`
but read `websites`/`emails` via `.split(',')`, which is `undefined` on the
list object, so **every websites and emails value was silently dropped from
every response** since that code shipped.

Fixed in `fix/places-websites-emails-parser` (parser + regression tests). This
is the single highest-value change here and directly serves the customer who
asked for websites. **Action: deploy, then re-measure fill rates before
committing to any OSM build — the website "gap" may largely disappear, since
Overture already ingests OSM as a source.**

## Do we still need OSM?

Re-measure post-deploy. Overture merges OSM, Meta and Microsoft, so native
coverage is often better than assumed (phones already at 100% here). OSM
enrichment is only worth building for the residual gap after the fix — likely
phone/website on long-tail SMBs Overture hasn't matched. Treat the numbers
below the fix as the real opportunity size; anything under ~10–15% incremental
coverage probably isn't worth the pipeline.

## Where should the enrichment live? (the architecture question)

**Recommendation: a materialised BigQuery table, joined at query time, rebuilt
monthly from an OSM extract. Not a new Postgres database.**

Why BigQuery over Postgres:

- The API's core data (Overture places) already lives in BigQuery and every
  places request already runs a BQ query. A `LEFT JOIN` to an
  `enrichment.osm_contacts` table keeps everything in one query, server-side,
  with no cross-store fan-out and no second round-trip per request.
- The workload is read-only, batch-refreshed, and static between refreshes —
  exactly what a materialised table is for. Postgres buys us transactions,
  low-latency point writes and a standing service to run, secure, back up and
  scale; we need none of those, so it's pure operational liability here.
- Monthly rebuild matches Overture's monthly release cadence — we already
  refresh on that schedule.
- Cost stays low if the table is narrow (join key + phone + website + source +
  licence) and **clustered/partitioned on the join key**, so the join adds
  trivial bytes on top of the places scan the query already pays for.

When Postgres _would_ win: low-latency lookups outside a BQ context, frequent
writes, or transactional updates. None apply. (For contrast, the Wikidata
brands enrichment uses an in-memory GCS artifact because it's tiny, ~3k QIDs.
A global OSM contacts table is far too large to hold in memory per Cloud Run
instance, so the in-memory pattern doesn't transfer — BQ join is the scalable
equivalent.)

### Sketch

```
enrichment.osm_contacts  (clustered by join_key)
  join_key      STRING   -- GERS id if matched, else osm_type||osm_id
  gers_id       STRING   -- nullable
  phone         STRING
  website       STRING
  source        STRING   -- 'openstreetmap'
  licence       STRING   -- 'ODbL-1.0'
  osm_updated   TIMESTAMP
  built_at      TIMESTAMP
```

Places query gains, only when the caller opts in via `enrichment_fields`:

```sql
LEFT JOIN `enrichment.osm_contacts` c
  ON c.gers_id = p.id            -- primary path
-- spatial+name fallback handled at build time, not query time
```

## The hard part: the join key

- **Best case — GERS/OSM concordance.** Overture places carry `sources` with
  the originating dataset and record id; where OSM is a source, we can join on
  the OSM id directly and attach any OSM tags Overture didn't carry through.
- **Fallback — spatial + name match.** For OSM POIs with no GERS link, match on
  proximity (e.g. within 50–100 m) + normalised name similarity. This is fuzzy
  and must be done and scored **at build time** (monthly), never per request,
  so the runtime join stays a simple key lookup. Keep a confidence score and
  only surface high-confidence matches.

## Licensing

OpenStreetMap is **ODbL**. Any OSM-derived field we serve requires attribution
("© OpenStreetMap contributors") and the share-alike terms need a legal read
before this is customer-facing — materially different from the CC0/CDLA data
already served. Flag `source`/`licence` per enriched field so responses can
attribute correctly and callers can filter by licence if they need to.

## Phased plan

1. **Ship the parser fix** (done, pending deploy) and re-measure fill rates for
   websites/emails across a few categories and countries. This may satisfy the
   customer outright.
2. **Quantify the residual OSM gap** against the post-fix baseline. Decide
   go/no-go on ~10–15% incremental coverage.
3. If go: **build the monthly ETL** — extract OSM POIs with `phone`/`website`
   tags for target countries, resolve the join key (GERS concordance first,
   scored spatial+name fallback second), write `enrichment.osm_contacts`.
   Reuse the existing monthly-workflow + schema-drift patterns.
4. **Wire the LEFT JOIN** behind an `enrichment_fields` opt-in (e.g.
   `osm_contacts`), with per-field `source`/`licence` attribution.
5. **Legal sign-off on ODbL** before it's exposed to paying customers.

## Immediate customer action

Independent of any of the above: tell IwannaFind that `websites` and `phones`
are already returned by default (no `enrichment_fields` needed) — once the
parser fix deploys, websites will populate. That alone likely covers their
stated need; OSM is the follow-on for coverage depth.
