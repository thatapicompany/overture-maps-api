-- Country-clustered mirror of the Overture place table, for /places queries
-- that have NO lat/lng (country-level queries: country + name, country +
-- categories, country + brand, and the /places/brands, /places/categories and
-- /places/countries aggregates).
--
-- Why a second mirror: `overture.place` is clustered by geometry, which is
-- what makes radius queries prune. A predicate on
-- `addresses.list[OFFSET(0)].element.country` cannot use that cluster, so
-- every country-level request scanned the whole table (45.5 GiB, ~A$0.38)
-- regardless of how narrow the other filters were. That one shape was 85% of
-- BigQuery spend in September 2026 and all of the 14 Sep and 5 Oct spikes
-- (see docs/cost-budget-rate-limiting.md). Clustering on a derived top-level
-- `country` column means a country query reads one country's slice instead.
--
-- Same schema as the source plus two derived columns the API filters on:
--   country     the first address's ISO country code (what the API has always
--               filtered on), hoisted to a top-level column so it can cluster
--   name_lower  LOWER(names.primary), so name matching is a plain equality
--               instead of LOWER() over every row
-- `SELECT *` keeps the parser (bq-place-row.parser.ts) unchanged; it ignores
-- columns it does not read.
--
-- Point the API at it with
--   PLACE_COUNTRY_TABLE=overture-maps-api.overture.place_by_country
-- Rebuild MONTHLY, after `overture.place` (see .github/workflows/
-- places-country-mirror.yml). Reads the geometry mirror, not the public table,
-- so the two stay in step and the rebuild is one ~45 GiB scan (~A$0.38).
-- Storage is ~45 GiB more, about US$1/month.

CREATE SCHEMA IF NOT EXISTS `overture-maps-api.overture`
OPTIONS (location = 'US');

CREATE OR REPLACE TABLE `overture-maps-api.overture.place_by_country`
CLUSTER BY country, basic_category, name_lower
AS
SELECT
  addresses.list[SAFE_OFFSET(0)].element.country AS country,
  LOWER(names.primary) AS name_lower,
  *
FROM `overture-maps-api.overture.place`;

-- Sanity check after building: a country query should bill one country's
-- slice (low single-digit GiB for IT), not 45 GiB.
--   SELECT COUNT(*) FROM `overture-maps-api.overture.place_by_country`
--   WHERE country = 'IT' AND name_lower = 'bar centrale';
