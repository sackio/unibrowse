#!/bin/bash
# MongoDB Backup Script for Browser MCP Macros
# Exports macros collection to JSON for version control

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/macros_backup_$TIMESTAMP.json"
LATEST_LINK="$BACKUP_DIR/macros_latest.json"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "=== MongoDB Backup Script ==="
echo "Backup directory: $BACKUP_DIR"
echo "Timestamp: $TIMESTAMP"
echo ""

# Check if MongoDB container is running
if ! docker ps | grep -q browser-mcp-mongodb; then
    echo "ERROR: MongoDB container 'browser-mcp-mongodb' is not running"
    echo "Start it with: docker compose up -d mongodb"
    exit 1
fi

echo "Exporting macros collection..."
docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "
    db.macros.find().toArray()
" > "$BACKUP_FILE"

# Check if backup was successful
if [ ! -s "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file is empty"
    exit 1
fi

# Count macros
MACRO_COUNT=$(docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "db.macros.countDocuments()")
echo "✓ Exported $MACRO_COUNT macros to: $BACKUP_FILE"

# Create/update symlink to latest backup
ln -sf "$(basename "$BACKUP_FILE")" "$LATEST_LINK"
echo "✓ Updated latest backup link: $LATEST_LINK"

# Show file size
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✓ Backup size: $FILE_SIZE"

# Keep only last 10 backups (but preserve latest link)
echo ""
echo "Cleaning old backups (keeping last 10)..."
cd "$BACKUP_DIR"
ls -t macros_backup_*.json | tail -n +11 | xargs -r rm -v

echo ""
echo "=== Backup Complete ==="
echo "To restore this backup, run:"
echo "  ./scripts/restore-mongodb.sh $BACKUP_FILE"
