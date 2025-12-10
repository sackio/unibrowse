# MongoDB Macros Backups

This directory contains backups of the unibrowse macros stored in MongoDB.

## Backup Scripts

### Create Backup
```bash
./scripts/backup-mongodb.sh
```

This will:
- Export all macros from MongoDB to a timestamped JSON file
- Create a symlink `macros_latest.json` pointing to the most recent backup
- Keep only the last 10 backups (automatically cleans up old ones)

### Restore Backup
```bash
# Restore from latest backup
./scripts/restore-mongodb.sh

# Restore from specific backup
./scripts/restore-mongodb.sh backups/macros_backup_20251014_123456.json
```

**Warning**: Restore will DELETE all existing macros and replace them with the backup.

## Git Strategy

Only `macros_latest.json` is tracked in git to avoid bloating the repository with timestamped backups.

To commit the current macros state:
```bash
./scripts/backup-mongodb.sh
git add backups/macros_latest.json
git commit -m "chore: update macros backup"
```

## Manual Backup/Restore

If you need to manually export/import:

```bash
# Export
docker exec browser-mcp-mongodb mongosh browser_mcp --eval "db.macros.find().toArray()" > backup.json

# Import (warning: this will replace all macros)
docker exec browser-mcp-mongodb mongosh browser_mcp --eval "db.macros.drop()"
# ... then use mongoimport or insertMany
```
