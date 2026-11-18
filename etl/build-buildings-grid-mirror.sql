-- Grid-partitioned mirror of the Overture building table, for /buildings and
-- /places/buildings radius queries.
--
-- Why: the building table is about 2.5 billion rows (over 800 GiB). Clustering
-- it by geometry alone (build-buildings-mirror.sql) cannot narrow a small
-- radius search below roughly a gigabyte, because clustering prunes whole
-- storage blocks and in a table that size the blocks are large. A 40 m search
-- returning three buildings billed the same as a 2 km search returning six
-- thousand: 1.0 to 1.9 GiB.
--
-- What this builds: the same rows plus a top-level `cell` column, the 3 degree
-- grid cell holding the building's centroid, partitioned by `cell` and
-- clustered by geometry inside each partition. The API names the cells its
-- search area touches (src/bigquery/building-grid.ts), so a query reads those
-- partitions only. The cell arithmetic below must match that file.
--
-- Why it is written band by band: how finely BigQuery can prune inside a
-- partition depends on how much data the job that wrote it handled. One job
-- for the whole table left dense cities at 0.9 to 1.2 GiB a request. Writing
-- one latitude band (120 cells, up to about 60 GiB) per job brings the same
-- requests to 0.2 to 0.25 GiB. So the table is staged once from the public
-- data, then copied into place a band at a time, and the finished table
-- replaces the live one in a single step so readers never see it half built.
--
-- Measured November 2026, 100 rows, all columns (geometry mirror -> this):
--   Manhattan 500 m      1.74 GiB -> 0.18 GiB
--   London 250 m         1.89 GiB -> 0.21 GiB
--   Tokyo 300 m          1.67 GiB -> 0.29 GiB
--   Jakarta 1 km         1.80 GiB -> 0.27 GiB
--   Florida suburb 40 m  0.92 GiB -> 0.03 GiB
--   Rural Kansas 5 km    0.74 GiB -> 0.02 GiB
--   Paris 25 km          3.03 GiB -> 1.30 GiB (1.9 million buildings)
-- Sixteen searches, including ones across cell edges, a cell corner and the
-- antimeridian, returned the same ids, order and totals from both tables.
--
-- Point the API at it with
--   BUILDING_GRID_TABLE=overture-maps-api.overture.building_by_cell
-- The staging table expires on its own if a run stops part way.
-- Rebuild MONTHLY after each Overture release
-- (.github/workflows/buildings-mirror.yml). It reads the public table once and
-- the staging copy once, about 1.6 TiB in all, and takes around 20 minutes.
-- With BUILDING_GRID_TABLE set the geometry-only mirror is not read at all.

CREATE SCHEMA IF NOT EXISTS `overture-maps-api.overture`
OPTIONS (location = 'US');

CREATE OR REPLACE TABLE `overture-maps-api.overture.building_by_cell_stage`
PARTITION BY RANGE_BUCKET(cell, GENERATE_ARRAY(0, 7200, 1))
OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 2 DAY))
AS
SELECT
  LEAST(GREATEST(CAST(FLOOR((ST_Y(ST_CENTROID(geometry)) + 90) / 3) AS INT64), 0), 59) * 120
    + LEAST(GREATEST(CAST(FLOOR((ST_X(ST_CENTROID(geometry)) + 180) / 3) AS INT64), 0), 119) AS cell,
  *
FROM `bigquery-public-data.overture_maps.building`;

CREATE OR REPLACE TABLE `overture-maps-api.overture.building_by_cell_next`
PARTITION BY RANGE_BUCKET(cell, GENERATE_ARRAY(0, 7200, 1))
CLUSTER BY geometry
AS
SELECT * FROM `overture-maps-api.overture.building_by_cell_stage` WHERE FALSE;

FOR band IN (SELECT b FROM UNNEST(GENERATE_ARRAY(0, 59)) AS b ORDER BY b) DO
  INSERT INTO `overture-maps-api.overture.building_by_cell_next`
  SELECT * FROM `overture-maps-api.overture.building_by_cell_stage`
  WHERE cell BETWEEN band.b * 120 AND band.b * 120 + 119;
END FOR;

INSERT INTO `overture-maps-api.overture.building_by_cell_next`
SELECT * FROM `overture-maps-api.overture.building_by_cell_stage`
WHERE cell IS NULL;

-- A table copy keeps the storage as written, so the fine blocks survive.
CREATE OR REPLACE TABLE `overture-maps-api.overture.building_by_cell`
COPY `overture-maps-api.overture.building_by_cell_next`
OPTIONS (expiration_timestamp = NULL);

DROP TABLE `overture-maps-api.overture.building_by_cell_next`;
DROP TABLE `overture-maps-api.overture.building_by_cell_stage`;

-- Sanity check after building: a small search in a dense city should bill
-- about a quarter of a gigabyte, not one to two.
--   SELECT COUNT(*) FROM `overture-maps-api.overture.building_by_cell`
--   WHERE cell IN (5195) AND ST_DWithin(geometry, ST_GeogPoint(-73.9857, 40.7484), 500);
