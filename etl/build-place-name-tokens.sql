-- The country mirror once per distinct word of each place's name, so a
-- country-level name_prefix query reads only the words it can match.
--
-- name_prefix matches a name that starts with the prefix, or has a word that
-- does (`STARTS_WITH(name_folded, p) OR STRPOS(name_folded, ' ' || p) > 0`).
-- `overture.place_by_country` is clustered by country, basic_category and
-- name_lower, which cannot prune "any word starts with", so every such query
-- read the whole country slice: about 13 GiB for the US, whatever the page.
--
-- Here each place appears once for every distinct word of its folded name
-- (lower case, no accents; split on single spaces, the same boundary the predicate uses), in a
-- `name_token` column, clustered by country and name_token. The API reads the
-- rows whose token falls in the prefix's range, keeps one row per id, and
-- then applies the unchanged name_prefix predicate, so results are identical
-- to reading the mirror (src/bigquery/bigquery.service.ts,
-- namePrefixTokenRange). Places with no name are left out: name_prefix can
-- never match them.
--
-- Point the API at it with
--   PLACE_NAME_TOKEN_TABLE=overture-maps-api.overture.place_name_tokens
-- Rebuild MONTHLY, straight after the country mirror it is built from
-- (.github/workflows/places-country-mirror.yml), so the two stay in step.
-- The build reads the mirror once. Storage is a few times the mirror's,
-- since most names have two or three words.

CREATE OR REPLACE TABLE `overture-maps-api.overture.place_name_tokens`
CLUSTER BY country, name_token
AS
SELECT p.*, name_token
FROM `overture-maps-api.overture.place_by_country` AS p,
  UNNEST(ARRAY(
    SELECT DISTINCT t FROM UNNEST(SPLIT(p.name_folded, ' ')) AS t WHERE t != ''
  )) AS name_token
WHERE p.country IS NOT NULL
  AND p.name_folded IS NOT NULL;
