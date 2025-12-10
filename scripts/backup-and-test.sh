#!/bin/bash
# Backup Macros and Run Test Suite
#
# This script:
# 1. Backs up all macros from MongoDB to the repo
# 2. Creates a versioned backup in macros/backups/
# 3. Runs the comprehensive test suite
#
# Usage: ./scripts/backup-and-test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MACROS_BACKUP_DIR="$PROJECT_DIR/macros/backups"
TEMP_BACKUP_DIR="$PROJECT_DIR/backups"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  UNIBROWSE MACRO BACKUP & TEST SUITE"
echo "═══════════════════════════════════════════════════════"
echo ""

# Step 1: Check if MongoDB is running
echo -e "${BLUE}[1/5]${NC} Checking MongoDB status..."
if ! docker ps | grep -q unibrowse-mongodb; then
    echo -e "${RED}ERROR:${NC} MongoDB container 'unibrowse-mongodb' is not running"
    echo "Start it with: docker compose up -d mongodb"
    exit 1
fi
echo -e "${GREEN}✓${NC} MongoDB is running"
echo ""

# Step 2: Backup macros to temporary location
echo -e "${BLUE}[2/5]${NC} Backing up macros from MongoDB..."
cd "$PROJECT_DIR"
./scripts/backup-mongodb.sh

# Get the latest backup file
LATEST_BACKUP=$(ls -t "$TEMP_BACKUP_DIR"/macros_backup_*.json | head -1)
if [ ! -f "$LATEST_BACKUP" ]; then
    echo -e "${RED}ERROR:${NC} Backup failed - no backup file found"
    exit 1
fi

MACRO_COUNT=$(docker exec unibrowse-mongodb mongosh unibrowse --quiet --eval "db.macros.countDocuments()")
echo -e "${GREEN}✓${NC} Backed up ${MACRO_COUNT} macros"
echo ""

# Step 3: Copy backup to versioned location in repo
echo -e "${BLUE}[3/5]${NC} Saving versioned backup to repo..."
mkdir -p "$MACROS_BACKUP_DIR"

VERSIONED_BACKUP="$MACROS_BACKUP_DIR/macros_${TIMESTAMP}.json"
cp "$LATEST_BACKUP" "$VERSIONED_BACKUP"

# Create a 'latest' symlink
cd "$MACROS_BACKUP_DIR"
rm -f macros_latest.json
ln -s "$(basename "$VERSIONED_BACKUP")" macros_latest.json

FILE_SIZE=$(du -h "$VERSIONED_BACKUP" | cut -f1)
echo -e "${GREEN}✓${NC} Saved to: macros/backups/macros_${TIMESTAMP}.json (${FILE_SIZE})"
echo -e "${GREEN}✓${NC} Updated: macros/backups/macros_latest.json -> macros_${TIMESTAMP}.json"
echo ""

# Step 4: Run Prerequisites Check
echo -e "${BLUE}[4/5]${NC} Running prerequisites check..."
cd "$PROJECT_DIR"
if npm run test:prereq > /tmp/prereq-output.log 2>&1; then
    echo -e "${GREEN}✓${NC} Prerequisites check passed"
else
    echo -e "${RED}ERROR:${NC} Prerequisites check failed"
    echo "Output:"
    cat /tmp/prereq-output.log
    echo ""
    echo "Please ensure:"
    echo "  1. MCP server is running: docker compose up -d mcp-server"
    echo "  2. Chrome extension is loaded and connected"
    echo "  3. At least one browser tab is attached"
    exit 1
fi
echo ""

# Step 5: Run comprehensive test suite
echo -e "${BLUE}[5/5]${NC} Running comprehensive test suite..."
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""

cd "$PROJECT_DIR"
npm test

echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}✓ BACKUP AND TEST COMPLETE${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Backup saved to:"
echo "  → macros/backups/macros_${TIMESTAMP}.json"
echo ""
echo "To restore this backup:"
echo "  ./scripts/restore-mongodb.sh macros/backups/macros_${TIMESTAMP}.json"
echo ""
