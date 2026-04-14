#!/bin/bash
# MongoDB Restore Script for Unibrowse
# Restores the unibrowse database from a backup in /mnt/backup/unibrowse-mongodb/

set -e

BACKUP_DIR="/mnt/backup/unibrowse-mongodb"
CONTAINER_NAME="unibrowse-mongodb"
DATABASE_NAME="unibrowse"

# Function to show usage
usage() {
    echo "Usage: $0 <backup-file.tar.gz>"
    echo ""
    echo "Example:"
    echo "  $0 /mnt/backup/unibrowse-mongodb/20251229_170026.tar.gz"
    echo ""
    echo "Available backups:"
    ls -lth "${BACKUP_DIR}"/*.tar.gz 2>/dev/null | head -5 || echo "  No backups found"
    exit 1
}

# Check arguments
if [ $# -eq 0 ]; then
    usage
fi

BACKUP_FILE="$1"

# Validate backup file exists
if [ ! -f "${BACKUP_FILE}" ]; then
    echo "ERROR: Backup file not found: ${BACKUP_FILE}"
    usage
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "ERROR: MongoDB container '${CONTAINER_NAME}' is not running"
    echo "Start it with: docker compose up -d mongodb"
    exit 1
fi

echo "=== MongoDB Restore Script ==="
echo "Backup file: ${BACKUP_FILE}"
echo "Container: ${CONTAINER_NAME}"
echo "Database: ${DATABASE_NAME}"
echo ""

# Get current document count
CURRENT_COUNT=$(docker exec "${CONTAINER_NAME}" mongosh "${DATABASE_NAME}" --quiet --eval "db.macros.countDocuments()")
echo "Current database has ${CURRENT_COUNT} documents"

# Confirm restore
read -p "This will REPLACE the current database. Continue? (yes/no): " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

# Extract backup to temporary directory
TEMP_DIR=$(mktemp -d)
echo "Extracting backup..."
tar -xzf "${BACKUP_FILE}" -C "${TEMP_DIR}"

# Find the database directory in the extracted backup
DB_DIR=$(find "${TEMP_DIR}" -type d -name "${DATABASE_NAME}" | head -1)

if [ -z "${DB_DIR}" ]; then
    echo "ERROR: Could not find database '${DATABASE_NAME}' in backup"
    rm -rf "${TEMP_DIR}"
    exit 1
fi

# Copy backup to container
RESTORE_DIR="/tmp/restore_$(date +%Y%m%d_%H%M%S)"
docker exec "${CONTAINER_NAME}" mkdir -p "${RESTORE_DIR}"
docker cp "${DB_DIR}" "${CONTAINER_NAME}:${RESTORE_DIR}/"

echo "Restoring database..."

# Drop existing database and restore from backup
docker exec "${CONTAINER_NAME}" mongorestore \
    --drop \
    --dir "${RESTORE_DIR}" \
    2>&1

# Cleanup
docker exec "${CONTAINER_NAME}" rm -rf "${RESTORE_DIR}"
rm -rf "${TEMP_DIR}"

# Verify restore
NEW_COUNT=$(docker exec "${CONTAINER_NAME}" mongosh "${DATABASE_NAME}" --quiet --eval "db.macros.countDocuments()")
echo ""
echo "=== Restore Complete ==="
echo "✓ Database restored with ${NEW_COUNT} documents"

exit 0
