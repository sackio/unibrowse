# Macro Backups

This directory contains versioned backups of all macros stored in MongoDB.

## Purpose

Backups are automatically created when running:
```bash
npm run backup:test
```

This ensures macros are version-controlled and can be restored if needed.

## Files

- `macros_YYYYMMDD_HHMMSS.json` - Timestamped backup files
- `macros_latest.json` - Symlink to the most recent backup

## Backup Format

Backups are JSON exports from MongoDB containing:
- Macro ID
- Site domain
- Category
- Name
- Description
- Parameters
- JavaScript code
- Return type
- Tags
- Reliability rating
- Metadata (created date, version, etc.)

## Restoring Macros

To restore from a backup:
```bash
./scripts/restore-mongodb.sh macros/backups/macros_YYYYMMDD_HHMMSS.json
```

Or restore the latest:
```bash
./scripts/restore-mongodb.sh macros/backups/macros_latest.json
```

## Maintenance

- Backups are automatically created before running tests
- The `backups/` directory (in project root) keeps the last 10 temporary backups
- This directory (`macros/backups/`) stores versioned backups for git tracking
- Commit important backups to version control

## Size Considerations

- Each backup is typically 50-200KB depending on the number of macros
- Consider cleaning up old backups periodically
- Keep at least the latest backup committed to git
