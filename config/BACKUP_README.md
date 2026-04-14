# MongoDB Backup Configuration

## Overview
Automated daily backups of the unibrowse MongoDB database to `/mnt/backup/unibrowse-mongodb/`.

## Backup Schedule
- **Frequency**: Daily at 3:00 AM
- **Retention**: 30 days
- **Location**: `/mnt/backup/unibrowse-mongodb/`
- **Format**: Compressed tar.gz files containing mongodump output

## Files

### Scripts
- `scripts/backup-mongodb-scheduled.sh` - Main backup script (automated)
- `scripts/restore-mongodb-from-backup.sh` - Restore script

### Systemd
- `config/unibrowse-backup.service` - Systemd service unit
- `config/unibrowse-backup.timer` - Systemd timer unit (schedules backups)

## Installation

### Install Systemd Timer
```bash
sudo cp config/unibrowse-backup.service /etc/systemd/system/
sudo cp config/unibrowse-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable unibrowse-backup.timer
sudo systemctl start unibrowse-backup.timer
```

### Verify Timer
```bash
systemctl status unibrowse-backup.timer
systemctl list-timers unibrowse-backup.timer
```

## Manual Operations

### Manual Backup
```bash
# Run backup immediately
sudo systemctl start unibrowse-backup.service

# Or run script directly
/mnt/nas/data/code/unibrowse/scripts/backup-mongodb-scheduled.sh
```

### List Backups
```bash
ls -lth /mnt/backup/unibrowse-mongodb/*.tar.gz
```

### Restore from Backup
```bash
# List available backups
./scripts/restore-mongodb-from-backup.sh

# Restore specific backup
./scripts/restore-mongodb-from-backup.sh /mnt/backup/unibrowse-mongodb/20251229_170026.tar.gz
```

### View Backup Logs
```bash
# View backup log file
tail -f /mnt/backup/unibrowse-mongodb/backup.log

# View systemd journal
journalctl -u unibrowse-backup.service -f
```

## Backup Details
- **Database**: `unibrowse`
- **Container**: `unibrowse-mongodb`
- **Collections**: `macros` (and any other collections)
- **Compression**: gzip (tar.gz)
- **Retention**: Automatic cleanup of backups older than 30 days

## Troubleshooting

### Timer not running
```bash
sudo systemctl status unibrowse-backup.timer
sudo systemctl restart unibrowse-backup.timer
```

### Backup failed
```bash
# Check logs
journalctl -u unibrowse-backup.service --since today

# Check if MongoDB container is running
docker ps | grep unibrowse-mongodb

# Test backup manually
/mnt/nas/data/code/unibrowse/scripts/backup-mongodb-scheduled.sh
```

### Restore failed
```bash
# Ensure MongoDB container is running
docker compose up -d mongodb

# Check backup file integrity
tar -tzf /mnt/backup/unibrowse-mongodb/BACKUP_FILE.tar.gz
```
