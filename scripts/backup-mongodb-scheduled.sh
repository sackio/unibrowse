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
tar -czf "${BACKUP_PATH}.tar.gz" -C "${BACKUP_DIR}" "$(basename ${BACKUP_PATH})" 2>&1 | tee -a "${LOG_FILE}"
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
