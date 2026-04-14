# MongoDB Macros Backups

This directory is the **PRIMARY** backup location for unibrowse macros stored in MongoDB.

## Backup Architecture

Macros are backed up at three levels:

1. **Source Definitions** (Git-tracked): `/macros/*.js` - Version-controlled source code
2. **Local Rotating Backups** (This directory): `/backups/` - Last 10 MongoDB exports
3. **NAS Offsite Backups**: `/mnt/backup/unibrowse-macros/` - Compressed archives for disaster recovery

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
docker exec unibrowse-mongodb mongosh unibrowse --eval "db.macros.find().toArray()" > backup.json

# Import (warning: this will replace all macros)
docker exec unibrowse-mongodb mongosh unibrowse --eval "db.macros.drop()"
# ... then use mongoimport or insertMany
```
