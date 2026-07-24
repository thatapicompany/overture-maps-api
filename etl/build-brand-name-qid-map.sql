-- Self-sourced brand-name → Wikidata-QID map for enrichment fallback.
--
-- Problem: ~88% of branded Overture places have a null `brand.wikidata`, so the
-- brand-enrichment layer (logo/website/industry, keyed by QID) can't fire for
-- them — even for household chains that clearly exist in Wikidata.
--
-- Fix: the SAME brand name usually appears WITH a QID on some Overture rows and
-- WITHOUT on others. We learn `name → QID` from the populated rows and apply it
-- to the null ones. No external matching, and the QID is guaranteed to already
-- be in the brands-enrichment artifact (both are sourced from Overture's own
-- non-null wikidata values).
--
-- Run monthly, right after `etl:brands-enrichment`. Region: US.
-- Project/dataset: overture-maps-api.enrichment

-- 1) Persistent manual decisions. Created once; NEVER dropped by the rebuild,
--    so human review of the ambiguous/low-confidence rows survives every month.
CREATE SCHEMA IF NOT EXISTS `overture-maps-api.enrichment`
OPTIONS (location = 'US');

CREATE TABLE IF NOT EXISTS `overture-maps-api.enrichment.brand_name_qid_overrides` (
  name_norm  STRING NOT NULL,  -- LOWER(TRIM(brand.names.primary))
  qid        STRING,           -- QID to apply; NULL = explicitly suppress this name
  approved   BOOL NOT NULL,    -- TRUE = apply, FALSE = never apply (suppress)
  country    STRING,           -- optional ISO-2 scope for names that differ by country ('' / NULL = all)
  note       STRING,
  decided_by STRING,
  decided_at TIMESTAMP
);

-- 2) Rebuild the candidate map from Overture (monthly, full refresh).
CREATE OR REPLACE TABLE `overture-maps-api.enrichment.brand_name_qid_candidates` AS
WITH base AS (
  SELECT LOWER(TRIM(brand.names.primary)) AS name_norm, brand.wikidata AS qid
  FROM `bigquery-public-data.overture_maps.place`
  WHERE brand.names.primary IS NOT NULL AND TRIM(brand.names.primary) != ''
),
known AS (  -- rows that carry a valid QID
  SELECT name_norm, qid, COUNT(*) AS n
  FROM base
  WHERE qid IS NOT NULL AND REGEXP_CONTAINS(qid, '^Q[0-9]+$')
  GROUP BY 1, 2
),
mp AS (
  SELECT
    name_norm,
    COUNT(*)                                    AS distinct_qids,
    SUM(n)                                       AS known_support,
    ARRAY_AGG(qid ORDER BY n DESC)[OFFSET(0)]    AS best_qid,
    MAX(n)                                       AS best_support
  FROM known GROUP BY 1
),
miss AS (  -- rows missing a QID, per name (the upside)
  SELECT name_norm, COUNT(*) AS null_places
  FROM base
  WHERE qid IS NULL OR NOT REGEXP_CONTAINS(qid, '^Q[0-9]+$')
  GROUP BY 1
)
SELECT
  m.name_norm,
  m.best_qid,
  m.known_support,
  m.distinct_qids,
  ROUND(SAFE_DIVIDE(m.best_support, m.known_support), 3) AS dominance,
  IFNULL(mi.null_places, 0)                              AS null_places_recoverable,
  CASE
    WHEN m.distinct_qids = 1 AND m.known_support >= 5                                    THEN 'high'
    WHEN m.distinct_qids > 1 AND SAFE_DIVIDE(m.best_support, m.known_support) >= 0.95    THEN 'review_high_dominance'
    WHEN m.distinct_qids > 1                                                             THEN 'review_ambiguous'
    ELSE 'review_low_support'
  END                                                   AS confidence
FROM mp m
LEFT JOIN miss mi USING (name_norm);

-- 3) The APPLIED map the API consumes: auto-approved HIGH tier, plus manual
--    approvals, minus manual suppressions. Only unambiguous, well-supported
--    names ship automatically; everything else waits for a human decision.
CREATE OR REPLACE TABLE `overture-maps-api.enrichment.brand_name_qid_map` AS
WITH auto AS (
  SELECT name_norm, best_qid AS qid
  FROM `overture-maps-api.enrichment.brand_name_qid_candidates`
  WHERE confidence = 'high'
),
suppressed AS (
  SELECT name_norm FROM `overture-maps-api.enrichment.brand_name_qid_overrides`
  WHERE approved = FALSE
),
approved AS (
  SELECT name_norm, qid FROM `overture-maps-api.enrichment.brand_name_qid_overrides`
  WHERE approved = TRUE AND qid IS NOT NULL
)
SELECT name_norm, qid FROM auto WHERE name_norm NOT IN (SELECT name_norm FROM suppressed)
UNION DISTINCT
SELECT name_norm, qid FROM approved;

-- 4) Review queue: candidates that aren't auto-high and haven't been decided yet.
--    Eyeball these (highest `null_places_recoverable` first) and record decisions
--    in brand_name_qid_overrides. See the accompanying review notes.
CREATE OR REPLACE VIEW `overture-maps-api.enrichment.brand_name_qid_review` AS
SELECT c.*
FROM `overture-maps-api.enrichment.brand_name_qid_candidates` c
LEFT JOIN `overture-maps-api.enrichment.brand_name_qid_overrides` o USING (name_norm)
WHERE c.confidence != 'high' AND o.name_norm IS NULL
ORDER BY c.null_places_recoverable DESC;
