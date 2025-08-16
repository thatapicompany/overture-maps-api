
EXPORT DATA OPTIONS (
  uri='gs://YOUR-BUCKET/overture/place_min_*.csv',
  format='CSV',
  overwrite=true,
  header=true,
  field_delimiter=','
)
AS
SELECT * FROM (
  WITH flat AS (
  SELECT
    id,
    ST_X(geometry) AS lon,
    ST_Y(geometry) AS lat,
    names.primary                               AS name,
    categories.primary                           AS category,
    websites.list[SAFE_OFFSET(0)].element        AS website,
    phones.list[SAFE_OFFSET(0)].element          AS phone,
    emails.list[SAFE_OFFSET(0)].element          AS email,
    socials.list[SAFE_OFFSET(0)].element         AS social,
    addresses.list[SAFE_OFFSET(0)].element.freeform AS address,
    addresses.list[SAFE_OFFSET(0)].element.locality AS locality,
    addresses.list[SAFE_OFFSET(0)].element.postcode AS postcode,
    addresses.list[SAFE_OFFSET(0)].element.country  AS country,
    sources.list[SAFE_OFFSET(0)].element.dataset    AS src_dataset,
    sources.list[SAFE_OFFSET(0)].element.record_id  AS src_record_id,
    TIMESTAMP(sources.list[SAFE_OFFSET(0)].element.update_time) AS src_update_time,
    confidence
  FROM `bigquery-public-data.overture_maps.place`
)
SELECT * FROM flat
);
