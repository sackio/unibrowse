#!/bin/bash
# Backup Unibrowse Macros Collection
# Backs up the macros collection from MongoDB to /mnt/backup/unibrowse-macros/

set -e

# Configuration
BACKUP_DIR="/mnt/backup/unibrowse-macros"
MONGO_URI="mongodb://localhost:27018"
DATABASE_NAME="unibrowse"
COLLECTION_NAME="macros"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${DATE}"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

echo "Starting macros backup..."
echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Backup location: ${BACKUP_PATH}"

# Export macros collection to JSON
mongodump \
  --uri="${MONGO_URI}" \
  --db="${DATABASE_NAME}" \
  --collection="${COLLECTION_NAME}" \
  --out="${BACKUP_PATH}"

# Also export as single JSON file for easy inspection
mongoexport \
  --uri="${MONGO_URI}" \
  --db="${DATABASE_NAME}" \
  --collection="${COLLECTION_NAME}" \
  --out="${BACKUP_PATH}/macros.json" \
  --jsonArray \
  --pretty

# Compress backup
tar -czf "${BACKUP_PATH}.tar.gz" -C "${BACKUP_DIR}" "$(basename ${BACKUP_PATH})"
rm -rf "${BACKUP_PATH}"

# Get backup size and macro count
BACKUP_SIZE=$(du -h "${BACKUP_PATH}.tar.gz" | cut -f1)
MACRO_COUNT=$(mongo "${MONGO_URI}/${DATABASE_NAME}" --quiet --eval "db.macros.countDocuments()")

echo ""
echo "✓ Backup completed successfully!"
echo "  File: ${BACKUP_PATH}.tar.gz"
echo "  Size: ${BACKUP_SIZE}"
echo "  Macros backed up: ${MACRO_COUNT}"
echo ""

# List recent backups
echo "Recent backups:"
ls -lht "${BACKUP_DIR}"/*.tar.gz | head -5
