-- Clustered mirror of the Overture building table, held in-project so that
-- /places/buildings and /buildings queries PRUNE spatially instead of scanning
-- the raw public building table on every request. The public table is NOT
-- clustered, so both the nearest-building join in getPlacesWithNearestBuilding()
-- and the plain radius scan in getBuildingsNearby() pay for a large scan on the
-- buildings side even though the place side was fixed by the places mirror
-- (see build-places-mirror.sql). This is the other half of that fix: the
-- match_nearest_building=true path was still flagged in code as costing
-- ~$2.25/query (vs ~$0.02 target), and cost/latency get materially worse as
-- radius grows because the buildings side isn't pruned at all.
--
-- Why this works: BigQuery clusters a GEOGRAPHY column by S2 cell and prunes
-- ST_WITHIN / ST_DWithin predicates against it — exactly what both
-- getPlacesWithNearestBuilding() and getBuildingsNearby() filter on. The
-- mirror keeps the SAME schema, so the API needs no query change: just point
-- it at the mirror with
--   BUILDING_TABLE=overture-maps-api.overture.building
--
-- Rebuild MONTHLY, after each Overture release (see .github/workflows/
-- buildings-mirror.yml). The rebuild scans the source once — negligible next
-- to the per-request savings.
--
-- Requires a service account with dataset create/write in overture-maps-api
-- and read on bigquery-public-data. Run in the US multi-region.

CREATE SCHEMA IF NOT EXISTS `overture-maps-api.overture`
OPTIONS (location = 'US');

CREATE OR REPLACE TABLE `overture-maps-api.overture.building`
CLUSTER BY geometry
AS
SELECT * FROM `bigquery-public-data.overture_maps.building`;

-- Sanity check after building — a small radius nearest-building query should
-- now bill megabytes on the buildings side too, and larger radii (2-10km)
-- should no longer time out or run into the multi-second/multi-GB territory
-- seen against the unclustered public table:
--   SELECT COUNT(*) FROM `overture-maps-api.overture.building`
--   WHERE ST_DWithin(geometry, ST_GeogPoint(-0.1278, 51.5074), 2000);
