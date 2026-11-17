-- Two small tables that make country-level /places queries cheap when the
-- filter is not one the country mirror is clustered on.
--
-- `overture.place_by_country` is clustered by country, basic_category and
-- name. A country-level query filtered by taxonomy or brand could not use
-- that clustering, and neither could the categories filter (it matches
-- taxonomy.primary OR basic_category, and an OR across a clustered and an
-- unclustered column prunes nothing). Each such request read the whole
-- country slice with every column: about 13 GiB for the US, 0.85 GiB for
-- Australia, whatever the page size.
--
-- 1. place_filter_index: per country, for each taxonomy value (primary or
--    any ancestor in the hierarchy) the basic categories it occurs in, and
--    for each brand Wikidata id the brand names it goes by. A few MiB. The
--    API looks a value up, then adds `basic_category IN (...)` to the query,
--    which the mirror's clustering prunes. Almost every taxonomy value maps
--    to a single basic category. A value with no entry has no places in that
--    country, so the API answers without querying the place table at all.
--
-- 2. place_by_brand: only the places that have a brand (about 6% of rows),
--    clustered by country and brand name, with the same columns as the
--    country mirror plus a top-level `brand_name`. A brand query reads that
--    brand's rows instead of the country.
--
-- Measured November 2026, 200 rows a page, all columns:
--   US + taxonomy=auto_dealer      12.6 GiB -> 0.6 GiB
--   US + categories=museum         12.6 GiB -> 0.5 GiB
--   US + brand_name (14,010 rows)  13.2 GiB -> 0.15 GiB
--   AU + taxonomy=auto_dealer      0.85 GiB -> 0.11 GiB
-- Results are identical with and without them.
--
-- Point the API at them with
--   PLACE_FILTER_INDEX_TABLE=overture-maps-api.overture.place_filter_index
--   PLACE_BRAND_TABLE=overture-maps-api.overture.place_by_brand
-- Rebuild MONTHLY, straight after the country mirror they are built from
-- (.github/workflows/places-country-mirror.yml), so the three stay in step:
-- an index older than the mirror could hide places whose category changed.
-- The build reads about 8 GiB for the index and the whole mirror once for the
-- brand table. Storage is about 4 GiB.

CREATE OR REPLACE TABLE `overture-maps-api.overture.place_filter_index`
CLUSTER BY country, kind, value
AS
WITH src AS (
  SELECT
    country,
    basic_category,
    ARRAY(
      SELECT DISTINCT v
      FROM UNNEST(ARRAY_CONCAT(
        [taxonomy.primary],
        IFNULL(ARRAY(SELECT h.element FROM UNNEST(taxonomy.hierarchy.list) AS h), [])
      )) AS v
      WHERE v IS NOT NULL
    ) AS taxonomy_values,
    brand.names.primary AS brand_name,
    brand.wikidata AS brand_wikidata
  FROM `overture-maps-api.overture.place_by_country`
  WHERE country IS NOT NULL
)
SELECT country, 'taxonomy' AS kind, value, basic_category AS narrow, COUNT(*) AS places
FROM src, UNNEST(taxonomy_values) AS value
GROUP BY country, value, basic_category
UNION ALL
SELECT country, 'brand_wikidata', brand_wikidata, brand_name, COUNT(*)
FROM src
WHERE brand_wikidata IS NOT NULL
GROUP BY country, brand_wikidata, brand_name;

CREATE OR REPLACE TABLE `overture-maps-api.overture.place_by_brand`
CLUSTER BY country, brand_name
AS
SELECT
  brand.names.primary AS brand_name,
  *
FROM `overture-maps-api.overture.place_by_country`
WHERE country IS NOT NULL
  AND (brand.names.primary IS NOT NULL OR brand.wikidata IS NOT NULL);
