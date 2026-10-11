-- Id-clustered mirror of the Overture division_area table, for
-- GET /divisions/:id.
--
-- Why: bigquery-public-data.overture_maps.division_area (~9.7 GB, 1.08M rows)
-- is clustered by geometry, so `WHERE id = @id` cannot prune and every by-id
-- lookup scanned the whole table: ~9 GiB billed per call, 1.6 TiB in the 30
-- days to 11 Oct 2026 for what should be a single-row read. Clustered by id,
-- the lookup reads a block or two.
--
-- Same schema (SELECT *), so the API needs no query change. Point it at the
-- mirror with
--   DIVISION_AREA_TABLE=overture-maps-api.overture.division_area
-- If the mirror lacks an id (it lags the public table by up to a few weeks
-- after each Overture release), getDivisionById() falls back to the public
-- table, so a lagging mirror never turns into a 404.
--
-- Rebuild MONTHLY (.github/workflows/division-area-mirror.yml). One ~9.7 GB
-- scan (~A$0.08); storage ~US$0.20/month.

CREATE SCHEMA IF NOT EXISTS `overture-maps-api.overture`
OPTIONS (location = 'US');

CREATE OR REPLACE TABLE `overture-maps-api.overture.division_area`
CLUSTER BY id
AS
SELECT * FROM `bigquery-public-data.overture_maps.division_area`;
