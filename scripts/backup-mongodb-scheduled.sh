#!/bin/bash
# Scheduled MongoDB Backup Script for Unibrowse
# Backs up the unibrowse database to /mnt/backup/unibrowse-mongodb/
# Designed to run via cron for automated backups
# Keeps last 30 days of backups

set -e

# Configuration
BACKUP_DIR="/mnt/backup/unibrowse-mongodb"
CONTAINER_NAME="unibrowse-mongodb"
DATABASE_NAME="unibrowse"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${DATE}"
RETENTION_DAYS=30
LOG_FILE="${BACKUP_DIR}/backup.log"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "ERROR: MongoDB container '${CONTAINER_NAME}' is not running"
    exit 1
fi

# Log backup start
log "Starting MongoDB backup for database: ${DATABASE_NAME}"

# Perform backup using mongodump inside container
docker exec "${CONTAINER_NAME}" mongodump \
  --db "${DATABASE_NAME}" \
  --out "/tmp/backup_${DATE}" \
  2>&1 | tee -a "${LOG_FILE}"

# Copy backup from container to host
docker cp "${CONTAINER_NAME}:/tmp/backup_${DATE}" "${BACKUP_PATH}" 2>&1 | tee -a "${LOG_FILE}"

# Cleanup temporary backup in container
docker exec "${CONTAINER_NAME}" rm -rf "/tmp/backup_${DATE}"

# Compress backup
# ⛔ `nice` is not cosmetic here. MEASURED 2026-10-11: this step is a
# single-threaded gzip running several minutes, and on a 6-core office already at
# 0% idle it starved mongod itself — its WiredTiger checkpoint cadence slipped
# 60s -> 96s, and the recording reaper's prune query (1.5s when timed by hand)
# timed out at 60s inside this window and alerted. The archive has no deadline;
# mongod and everything talking to it do. ⚠️ No `ionice`: BACKUP_DIR and the
# source are BOTH on the NAS over NFS, so the local block-device queue that
# ionice schedules is not the contended resource — CPU is. ⚠️ And `nice` cannot
# reach `mongodump` above: that runs inside the container, where the host-side
# docker client's priority does not apply.
# ⭐ AND cut the work, do not merely yield it. MEASURED 2026-10-11 on 200 MB of
# real dump bytes from this job's own archive: gzip -1 costs 3.04s user CPU for
# 38.6 MB where the default -6 costs 8.03s for 31.5 MB — 2.6x less CPU for 22%
# larger output. At the live dump size (~3.0 GB, matching mongo dataSize of
# 3,196 MB) that is ~120s -> ~46s of core time per run. The archive grows ~472
# -> ~577 MB, so ~6 GB more across the 30-day retention on a volume with 10 TB
# free. ⇒ On a 6-core box at 0% idle that trade is lopsided in favour of -1.
# ⚠️ Safe to slow this step down at all ONLY because there is no deadline to
# bust: `systemctl show unibrowse-backup.service` reports Type=oneshot with
# TimeoutStartUSec=infinity and RuntimeMaxUSec=infinity, and the timer fires
# twice a day, so a niced run cannot overlap itself. ⛔ Re-check that before
# lowering the priority further — `mind` deliberately avoided ionice IDLE class
# on server4 for exactly this reason (memo c9b09d3c): a backup starved past its
# own timeout is NO backup, which is worse than a slow one. Nice inherits, so
# the gzip child runs at 19 too.
nice -n 19 tar -I 'gzip -1' -cf "${BACKUP_PATH}.tar.gz" -C "${BACKUP_DIR}" "$(basename ${BACKUP_PATH})" 2>&1 | tee -a "${LOG_FILE}"
rm -rf "${BACKUP_PATH}"

# Get backup size
BACKUP_SIZE=$(du -h "${BACKUP_PATH}.tar.gz" | cut -f1)
log "Backup completed: ${BACKUP_PATH}.tar.gz (${BACKUP_SIZE})"

# Remove backups older than retention period
log "Cleaning up backups older than ${RETENTION_DAYS} days..."
REMOVED=$(find "${BACKUP_DIR}" -name "*.tar.gz" -type f -mtime +${RETENTION_DAYS} -delete -print | wc -l)
log "Removed ${REMOVED} old backup(s)"

# Count remaining backups
BACKUP_COUNT=$(find "${BACKUP_DIR}" -name "*.tar.gz" -type f | wc -l)
log "Total backups retained: ${BACKUP_COUNT}"

# Verify latest backup exists and has content
if [ -f "${BACKUP_PATH}.tar.gz" ] && [ -s "${BACKUP_PATH}.tar.gz" ]; then
    log "✓ Backup verification successful"

    # Get document count for verification
    DOC_COUNT=$(docker exec "${CONTAINER_NAME}" mongosh "${DATABASE_NAME}" --quiet --eval "db.macros.countDocuments()")
    log "✓ Database contains ${DOC_COUNT} documents"

    exit 0
else
    log "✗ Backup verification failed!"
    exit 1
fi
