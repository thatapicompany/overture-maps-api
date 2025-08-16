# Setup PostgreSQL on GCP for Overture Maps

# 0) Decide the shape

* **Machine:** `e2-standard-2` (2 vCPU/8GB) for cheapest, or `e2-standard-4` (4 vCPU/16GB) to load faster then scale down.
* **Disks:** small boot (30GB) + separate **data** disk (easier to grow later). Start with **200GB pd-balanced**; you can resize online.
* **Network:** private access only; expose 5432 to just your VPC or a jump host.

---

# 1) Create the VM & disks

```bash
PROJECT_ID="$(gcloud config get-value project)"
REGION="australia-southeast1"
ZONE="australia-southeast1-b"
VM_NAME="pg-overture"
SA_EMAIL="$(gcloud iam service-accounts list --format='value(email)' --filter='displayName:Compute Engine default service account' | head -n1)"

gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type=e2-standard-4 \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-balanced \
  --create-disk=name="${VM_NAME}-data",size=200GB,type=pd-balanced,auto-delete=yes \
  --service-account="$SA_EMAIL" \
  --scopes=https://www.googleapis.com/auth/devstorage.read_write \
  --tags=postgres
```

**Firewall (allow only from your VPC or admin IPs):**

```bash
# From same VPC (private ranges)
gcloud compute firewall-rules create allow-postgres-from-vpc \
  --network=default --allow=tcp:5432 --target-tags=postgres \
  --source-ranges=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
# OR: from your static admin IP only
# gcloud compute firewall-rules create allow-postgres-from-admin \
#   --network=default --allow=tcp:5432 --target-tags=postgres --source-ranges=YOUR.IP.ADDR.ESS/32
```

SSH in:

```bash
gcloud compute ssh "$VM_NAME" --zone "$ZONE"
```

---

# 2) Prep & mount the data disk

```bash
# Find the attached disk (usually /dev/sdb)
lsblk
sudo mkfs.ext4 -E lazy_itable_init=0,lazy_journal_init=0 -L PGDATA /dev/sdb
sudo mkdir -p /var/lib/postgresql
echo 'LABEL=PGDATA /var/lib/postgresql ext4 defaults,noatime,nodiratime 0 2' | sudo tee -a /etc/fstab
sudo mount -a
df -h /var/lib/postgresql
```

---

# 3) Install PostgreSQL 16 + PostGIS

Add the official PGDG repo (gives you v16 on Debian 12):

```bash
sudo apt-get update && sudo apt-get install -y curl gnupg2 lsb-release
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | \
  sudo tee /etc/apt/sources.list.d/pgdg.list

sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-16-postgis postgresql-16-postgis-3-scripts
```

Stop Postgres, move its data directory to the data disk, re-init:

```bash
sudo systemctl stop postgresql
sudo rm -rf /var/lib/postgresql/16
sudo mkdir -p /var/lib/postgresql/16/main
sudo chown -R postgres:postgres /var/lib/postgresql

sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/16/main -E UTF8
sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

---

# 4) Basic OS & Postgres tuning (safe defaults)

**OS sysctl:**

```bash
sudo tee /etc/sysctl.d/99-postgres.conf >/dev/null <<'EOF'
vm.swappiness=1
vm.dirty_background_ratio=5
vm.dirty_ratio=20
net.core.somaxconn=1024
EOF
sudo sysctl --system
```

**PostgreSQL settings** (`/etc/postgresql/16/main/postgresql.conf`):

```bash
sudo -u postgres sed -i \
 -e "s/^#*listen_addresses.*/listen_addresses = '0.0.0.0'/" \
 -e "s/^#*shared_buffers.*/shared_buffers = 4GB/" \
 -e "s/^#*effective_cache_size.*/effective_cache_size = 12GB/" \
 -e "s/^#*maintenance_work_mem.*/maintenance_work_mem = 1GB/" \
 -e "s/^#*work_mem.*/work_mem = 64MB/" \
 -e "s/^#*wal_compression.*/wal_compression = on/" \
 -e "s/^#*max_wal_size.*/max_wal_size = '8GB'/" \
 -e "s/^#*checkpoint_timeout.*/checkpoint_timeout = '15min'/" \
 -e "s/^#*random_page_cost.*/random_page_cost = 1.1/" \
 /etc/postgresql/16/main/postgresql.conf
```

*(If you chose `e2-standard-2` with 8GB RAM, halve the memory values: `shared_buffers=2GB`, `effective_cache_size=6GB`, `maintenance_work_mem=512MB`, `work_mem=32MB`.)*

**Access control** (`/etc/postgresql/16/main/pg_hba.conf`):

```bash
# allow from your VPC (adjust CIDRs)
echo "host all all 10.0.0.0/8 md5"       | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
echo "host all all 172.16.0.0/12 md5"    | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
echo "host all all 192.168.0.0/16 md5"   | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
```

Restart and enable:

```bash
sudo systemctl enable --now postgresql
```

Create a DB and user:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER appuser WITH PASSWORD 'change-me' LOGIN;
CREATE DATABASE overture OWNER appuser;
\c overture
CREATE EXTENSION IF NOT EXISTS postgis;
SQL
```

---

# 5) Install ops agent (metrics/logs) & security updates

```bash
# Ops Agent
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install

# Unattended security updates
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

*(Optional) Disable Transparent Huge Pages (can reduce latency jitter):*

```bash
echo -e '[Unit]\nDescription=Disable THP\n[Service]\nType=oneshot\nExecStart=/bin/sh -c "echo never > /sys/kernel/mm/transparent_hugepage/enabled"\n[Install]\nWantedBy=multi-user.target' | sudo tee /etc/systemd/system/disable-thp.service
sudo systemctl enable --now disable-thp
```

---

# 6) Backups (quick + cheap)

**A) Disk snapshots (good safety net):**

```bash
# Create a daily snapshot policy
gcloud compute resource-policies create snapshot-schedule pg-daily-snap \
  --region="$REGION" \
  --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots \
  --schedule=daily --start-time=03:00

# Attach policy to the data disk
gcloud compute disks add-resource-policies "${VM_NAME}-data" \
  --zone="$ZONE" --resource-policies="pg-daily-snap"
```

**B) Logical dump to GCS (nightly):**

```bash
sudo mkdir -p /opt/pgbackup && sudo chown $USER /opt/pgbackup
cat <<'SH' > /opt/pgbackup/nightly_dump.sh
#!/usr/bin/env bash
set -euo pipefail
DT=$(date -u +%F)
OUT="/tmp/overture_${DT}.sql.gz"
PGPASSWORD='change-me' pg_dump -h 127.0.0.1 -U appuser -d overture \
  --format=plain --no-owner | gzip -9 > "$OUT"
gsutil cp "$OUT" gs://YOUR_BUCKET/pg-backups/
rm -f "$OUT"
SH
chmod +x /opt/pgbackup/nightly_dump.sh
echo "0 16 * * * root /opt/pgbackup/nightly_dump.sh >/var/log/pg_dump.log 2>&1" | sudo tee /etc/cron.d/pgdump
```

*(For proper PITR, use **wal-g** or **pgBackRest** later; snapshots+dumps are fine to start.)*

---

# 7) Create your table + indexes

```bash
psql "postgresql://appuser:change-me@127.0.0.1/overture" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE place_min (
  id               uuid PRIMARY KEY,
  name             text,
  category         text,
  lon              double precision NOT NULL,
  lat              double precision NOT NULL,
  geom             geography(Point,4326)
                   GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography) STORED,
  website          text,
  phone            text,
  email            text,
  social           text,
  address          text,
  locality         text,
  postcode         text,
  country          text,
  src_dataset      text,
  src_record_id    text,
  src_update_time  timestamptz,
  confidence       real
);
SQL
```

---

# 8) Load data fast (from GCS → Postgres)

From a **Compute Engine VM in the same region** (this VM is fine), stream CSVs in parallel:

```bash
export PGURL="postgresql://appuser:change-me@127.0.0.1/overture"

# Temporary unlogged table for speed
psql "$PGURL" -c "CREATE UNLOGGED TABLE place_min_load (LIKE place_min INCLUDING DEFAULTS INCLUDING CONSTRAINTS);"

# Speedy per-session knobs
psql "$PGURL" -c "SET synchronous_commit=off;"
psql "$PGURL" -c "SET maintenance_work_mem='2GB';"
psql "$PGURL" -c "SET work_mem='128MB';"

# Parallel import (adjust -P for concurrency)
gsutil ls gs://YOUR_BUCKET/overture/place_min_*.csv \
| xargs -n1 -P8 -I {} bash -lc \
  "gsutil cat '{}' | psql \"$PGURL\" -v ON_ERROR_STOP=1 \
     -c \"\\copy place_min_load(id,name,category,lon,lat,website,phone,email,social,address,locality,postcode,country,src_dataset,src_record_id,src_update_time,confidence) from STDIN csv header\""

# Index after load, then swap
psql "$PGURL" <<'SQL'
CREATE INDEX idx_place_min_load_geom ON place_min_load USING GIST (geom);
CREATE INDEX idx_place_min_load_name ON place_min_load (lower(name));
CREATE INDEX idx_place_min_load_tsv  ON place_min_load USING GIN (
  to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(address,'') || ' ' || coalesce(locality,''))
);
ANALYZE place_min_load;
ALTER TABLE place_min_load SET LOGGED;
DROP TABLE IF EXISTS place_min CASCADE;
ALTER TABLE place_min_load RENAME TO place_min;
SQL
```

---

# 9) Smoke test

```bash
psql "$PGURL" -c "SELECT count(*) FROM place_min;"
psql "$PGURL" <<'SQL'
SELECT id, name, category
FROM place_min
WHERE ST_DWithin(
  geom,
  ST_SetSRID(ST_MakePoint(16.3738, 48.2082),4326)::geography,
  500
)
ORDER BY confidence DESC NULLS LAST
LIMIT 20;
SQL
```

---

# 10) Ongoing maintenance

* **Resize disk** when \~70% full: `gcloud compute disks resize ...` then `sudo resize2fs /dev/sdb`.
* **Autovacuum**: defaults are fine; for heavy writes later, we can tune.
* **Version upgrades**: stop, snapshot, `pg_upgrade` (or `pg_dump/restore` for small DBs).
* **Security**: rotate `appuser` password, restrict firewall to the minimal IP ranges.

---
