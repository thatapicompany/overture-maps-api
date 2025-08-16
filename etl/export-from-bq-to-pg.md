

#### Export from BigQuery to GCS (CSV)

CSV is easiest to ingest to Postgres; export in shards.

```sql

EXPORT DATA OPTIONS (
  uri='gs://YOUR_BUCKET/overture/place_min_*.csv',
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

    brand.wikidata                                          AS wikidata,
    confidence                                              AS confidence,
    sources.list[SAFE_OFFSET(0)].element.dataset    AS src_dataset,
    sources.list[SAFE_OFFSET(0)].element.record_id  AS src_record_id,
    TIMESTAMP(sources.list[SAFE_OFFSET(0)].element.update_time) AS src_update_time,
    confidence
  FROM `bigquery-public-data.overture_maps.place`
)
SELECT * FROM flat

);
```


#### Load into Postgres

```
# pull from GCS to a machine that has psql
gcloud storage cp gs://YOUR_BUCKET/overture/place_min_*.csv .

# bulk load
psql "$PGURL" -c "\copy place_min(id,name,category,lon,lat,website,phone,email,social,address,locality,postcode,country,wikidata,confidence,src_dataset,src_record_id,src_update_time,confidence) FROM PROGRAM 'cat place_min_*.csv' CSV HEADER"
```


#### Incremental updates (recommended)

Overture refreshes; avoid full reloads.

BigQuery delta extract (only rows updated since your last successful run):

```
DECLARE last_run TIMESTAMP DEFAULT TIMESTAMP('2025-08-01 00:00:00+00'); -- replace via param/metadata

EXPORT DATA OPTIONS (
  uri='gs://YOUR_BUCKET/overture/delta/place_min_@{run_date}_*.csv',
  format='CSV', overwrite=true, header=true
)
AS
SELECT *
FROM (
  -- same SELECT as step 2
)
WHERE src_update_time >= last_run;
```

Postgres upsert via a staging table:

```sql
CREATE TEMP TABLE place_min_stg (LIKE place_min);

\copy place_min_stg(id,name,category,lon,lat,website,phone,email,social,address,locality,postcode,country,wikidata,confidence,src_dataset,src_record_id,src_update_time,confidence) FROM 'delta_files.csv' CSV HEADER;

INSERT INTO place_min AS t (
  id,name,category,lon,lat,website,phone,email,social,address,locality,postcode,country,wikidata,confidence,src_dataset,src_record_id,src_update_time,confidence
)
SELECT * FROM place_min_stg s
ON CONFLICT (id) DO UPDATE
SET
  name            = EXCLUDED.name,
  category        = EXCLUDED.category,
  lon             = EXCLUDED.lon,
  lat             = EXCLUDED.lat,
  website         = EXCLUDED.website,
  phone           = EXCLUDED.phone,
  email           = EXCLUDED.email,
  social          = EXCLUDED.social,
  address         = EXCLUDED.address,
  locality        = EXCLUDED.locality,
  postcode        = EXCLUDED.postcode,
  country         = EXCLUDED.country,
  wikidata        = EXCLUDED.wikidata,
  confidence      = EXCLUDED.confidence,
  src_dataset     = EXCLUDED.src_dataset,
  src_record_id   = EXCLUDED.src_record_id,
  src_update_time = EXCLUDED.src_update_time,
  confidence      = EXCLUDED.confidence
WHERE t.src_update_time IS NULL OR EXCLUDED.src_update_time > t.src_update_time;
```

#### Sanity checks & sample query

```
-- record counts
SELECT COUNT(*) FROM place_min;

-- quick Vienna radius test (500 m)
SELECT id, name, category
FROM place_min
WHERE ST_DWithin(
  geom,
  ST_SetSRID(ST_MakePoint(16.3738, 48.2082),4326)::geography,
  500
)
ORDER BY confidence DESC NULLS LAST
LIMIT 50;
```

#### Notes & options

PostGIS type: I used geography(Point,4326) for easy meters-based ST_DWithin. If you prefer geometry(Point,4326), use meters via geography(geom) or transform appropriately.

Multiple values: I picked the first website/phone/social/address. If you want arrays, we can keep them as Postgres text[] (and flatten in BQ with ARRAY_TO_STRING(..., '|')).

Performance: On 20–30M rows, COPY + ON CONFLICT is still very fast. For huge refreshes, consider:

- Load deltas into a permanent place_min_delta table and run a single INSERT ... ON CONFLICT.

- Periodic VACUUM (ANALYZE) on place_min.

Automation: Wrap steps in a small script (Cloud Build, GitLab CI, or a cron on a VM).