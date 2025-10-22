#!/bin/bash
# MongoDB Restore Script for Browser MCP Macros
# Restores macros collection from JSON backup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"

# Check arguments
if [ $# -eq 0 ]; then
    BACKUP_FILE="$BACKUP_DIR/macros_latest.json"
    echo "No backup file specified, using latest: $BACKUP_FILE"
else
    BACKUP_FILE="$1"
fi

# Validate backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    echo ""
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/macros_*.json 2>/dev/null || echo "  No backups found"
    exit 1
fi

echo "=== MongoDB Restore Script ==="
echo "Backup file: $BACKUP_FILE"
echo ""

# Check if MongoDB container is running
if ! docker ps | grep -q browser-mcp-mongodb; then
    echo "ERROR: MongoDB container 'browser-mcp-mongodb' is not running"
    echo "Start it with: docker compose up -d mongodb"
    exit 1
fi

# Show current macro count
CURRENT_COUNT=$(docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "db.macros.countDocuments()")
echo "Current macros in database: $CURRENT_COUNT"

# Ask for confirmation
read -p "This will REPLACE all existing macros. Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled"
    exit 0
fi

echo ""
echo "Dropping existing macros collection..."
docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "db.macros.drop()"

echo "Restoring macros from backup..."
# Copy backup file into container
docker cp "$BACKUP_FILE" browser-mcp-mongodb:/tmp/restore.json

# Import the data
docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "
    const data = JSON.parse(cat('/tmp/restore.json'));
    if (Array.isArray(data) && data.length > 0) {
        db.macros.insertMany(data);
        print('Inserted ' + data.length + ' macros');
    } else {
        print('ERROR: Invalid backup format');
    }
"

# Clean up temp file
docker exec browser-mcp-mongodb rm /tmp/restore.json

# Verify restoration
NEW_COUNT=$(docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "db.macros.countDocuments()")
echo ""
echo "=== Restore Complete ==="
echo "Macros in database: $NEW_COUNT"

# Recreate indexes
echo ""
echo "Recreating indexes..."
docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "
    db.macros.createIndex({ id: 1 }, { unique: true });
    db.macros.createIndex({ site: 1, category: 1 });
    db.macros.createIndex({ site: 1, name: 1 }, { unique: true });
    db.macros.createIndex({ tags: 1 });
    db.macros.createIndex({ createdAt: 1 });
    db.macros.createIndex({ reliability: 1 });
    print('Indexes created');
"

echo "✓ Restore complete"
