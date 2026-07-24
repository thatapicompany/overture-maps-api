-- Clustered mirror of the Overture place table, held in-project so that
-- /places radius queries PRUNE spatially instead of scanning the whole ~45GB
-- table on every request. Unclustered, each getPlacesNearby() call scanned the
-- full table (median = max = 45.4 GB billed), which drove the July 2026 cost
-- spike (a single /places request ≈ US$0.28, ×hundreds/day).
--
-- Why this works: BigQuery clusters a GEOGRAPHY column by S2 cell and prunes
-- ST_DWithin / ST_Intersects / ST_Within predicates against it — exactly what
-- getPlacesNearby() filters on. The mirror keeps the SAME schema, so the API
-- needs no query change: just point it at the mirror with
--   PLACE_TABLE=overture-maps-api.overture.place
--
-- Rebuild MONTHLY, after each Overture release (see .github/workflows/
-- places-mirror.yml). The rebuild scans the source once (~45GB, ~US$0.30) —
-- negligible next to the per-request savings (a 25km radius query should drop
-- from ~45GB to a few hundred MB or less).
--
-- Requires a service account with dataset create/write in overture-maps-api
-- and read on bigquery-public-data. Run in the US multi-region.

CREATE SCHEMA IF NOT EXISTS `overture-maps-api.overture`
OPTIONS (location = 'US');

CREATE OR REPLACE TABLE `overture-maps-api.overture.place`
CLUSTER BY geometry
AS
SELECT * FROM `bigquery-public-data.overture_maps.place`;

-- Optional sanity check after building — a small radius query should now bill
-- megabytes, not tens of gigabytes:
--   SELECT COUNT(*) FROM `overture-maps-api.overture.place`
--   WHERE ST_DWithin(geometry, ST_GeogPoint(-0.1278, 51.5074), 2000);
