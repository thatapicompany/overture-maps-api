# Setup PostgreSQL on GCP for Overture Maps using Cloud SQL

# 0) Choose the cheapest viable shape

* **Edition:** **Enterprise** (not Enterprise Plus) — unlocks HDD disks and shared-core/dedicated-core options. ([Google Cloud][1])
* **Machine type:** For reliability at the absolute floor, use **db-custom-1-3840** (1 vCPU, 3.75 GB). Shared-core (db-f1-micro/db-g1-small) is *cheaper* but not SLA-backed and too tiny for PostGIS/indexing at your scale. ([Google Cloud][2])
* **Storage:** **HDD** (cheapest) + \~**200 GB** to start; enable auto-increase with a cap. HDD is available on Enterprise edition; SSD is default. ([Google Cloud][2])
* **Region:** `australia-southeast1` (Sydney).

---

# 1) Create the instance (no HA, HDD, Enterprise)

```bash
INSTANCE="overture-pg"
REGION="australia-southeast1"

gcloud sql instances create "$INSTANCE" \
  --database-version=POSTGRES_15 \
  --region="$REGION" \
  --edition=ENTERPRISE \
  --tier=db-custom-1-3840 \
  --availability-type=ZONAL \        # no HA
  --storage-type=HDD \
  --storage-size=200 \
  --storage-auto-increase \
  --storage-auto-increase-limit=400 \
  --backup-start-time=03:00
```

(Enterprise vs Plus, machine series & storage types per docs. You can later patch the tier up/down.) ([Google Cloud][3])

Create DB & user:

```bash
gcloud sql databases create overture --instance="$INSTANCE"
gcloud sql users create appuser --instance="$INSTANCE" --password="change-me"
```

---

# 2) Enable PostGIS and create your minimal table

Connect from Cloud Shell (uses the Auth Proxy automatically):

```bash
gcloud sql connect "$INSTANCE" --user=postgres
```

Then in `psql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;  -- Cloud SQL supports PostGIS
CREATE TABLE place_min (
  id UUID PRIMARY KEY,
  name TEXT,
  category TEXT,
  lon DOUBLE PRECISION NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  geom geography(Point,4326)
       GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography) STORED,
  website TEXT, phone TEXT, email TEXT, social TEXT,
  address TEXT, locality TEXT, postcode TEXT, country TEXT,
  src_dataset TEXT, src_record_id TEXT, src_update_time TIMESTAMPTZ, confidence REAL
);
```

(PostGIS support and versions are documented here.) ([Google Cloud][4])

---

# 3) Let Cloud SQL read your CSVs in GCS

Grant the instance **read** permission on your bucket:

```bash
# Find the Cloud SQL instance service account
SA=$(gcloud sql instances describe "$INSTANCE" \
     --format="value(serviceAccountEmailAddress)")

# Give it object viewer/admin on your bucket (adjust bucket)
BUCKET="gs://YOUR_BUCKET"
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member="serviceAccount:${SA}" \
  --role="roles/storage.objectAdmin"
```

(The CSV import requires granting the instance SA object access.) ([Google Cloud][5])

---

# 4) Cheapest import path (sequential CSV → table)

**Works fine, just slower** on 1 vCPU/HDD. Order must match your table columns.

```bash
for f in $(gcloud storage ls gs://YOUR_BUCKET/overture/place_min_*.csv); do
  gcloud sql import csv "$INSTANCE" "$f" \
    --database=overture \
    --table=place_min
done
```

(CSV import command & requirements.) ([Google Cloud][5])

> Want it faster without changing instance size? CSV parallelism isn’t supported the same way as pg\_dump directory imports; for true parallel ingest you’d use a SQL dump with `pg_restore --jobs` or a pipeline (Dataflow/psql COPY). If you ever go that route, see the **parallel import** guide. ([Google Cloud][6])

---

# 5) Add indexes when imports finish

Create indexes **after** the load (cheaper & faster):

```bash
gcloud sql connect "$INSTANCE" --user=postgres
```

```sql
CREATE INDEX idx_place_min_geom ON place_min USING GIST (geom);
CREATE INDEX idx_place_min_name ON place_min (lower(name));
CREATE INDEX idx_place_min_tsv  ON place_min USING GIN (
  to_tsvector('simple',
    coalesce(name,'') || ' ' || coalesce(address,'') || ' ' || coalesce(locality,''))
);
ANALYZE place_min;
```

---

# 6) (Optional) Temporarily scale up, then down

If indexing drags on HDD/1 vCPU, you can patch up to a bigger shape for a few hours and scale back:

```bash
# e.g., 2 vCPU / 8 GB
gcloud sql instances patch "$INSTANCE" --tier=db-custom-2-8192
# ... run imports/indexes ...
# then back to cheapest
gcloud sql instances patch "$INSTANCE" --tier=db-custom-1-3840
```

(Changing the `tier` adjusts vCPU/RAM; Cloud SQL supports custom dedicated cores. Expect a restart.) ([Stack Overflow][7])

---

# 7) Sanity checks

```bash
gcloud sql connect "$INSTANCE" --user=postgres
```

```sql
SELECT COUNT(*) FROM place_min;

-- 500m around Stephansplatz (Vienna)
SELECT id, name, category
FROM place_min
WHERE ST_DWithin(
  geom,
  ST_SetSRID(ST_MakePoint(16.3738, 48.2082),4326)::geography,
  500)
ORDER BY confidence DESC NULLS LAST
LIMIT 20;
```

---

## Notes to keep costs down

* **No HA** (zonal) already selected. ([Google Cloud][3])
* **HDD** is the lowest storage cost; it’s slower than SSD. If query latency matters, consider SSD later. ([Google Cloud][2])
* Set a **storage auto-increase limit** so you don’t silently grow forever. ([Google Cloud][2])
* Backups are on; keep a short retention and **disable PITR** if you don’t need it to save on WAL storage. (Backup/PITR behavior is documented across the Cloud SQL backup pages.)