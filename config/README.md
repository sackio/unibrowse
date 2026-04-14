# Configuration Files

This directory contains configuration files for unibrowse.

## Files

### ecosystem.config.js

PM2 process manager configuration for running unibrowse as a managed service.

### nodemon.json

Nodemon configuration for development with auto-reload on file changes.

### unibrowse.service

Systemd service file for running unibrowse as a system service (production).

### unibrowse-dev.service

Systemd service file for running unibrowse in development mode.

**Usage:**

From repository root:
```bash
# Start the service
pm2 start config/ecosystem.config.js

# Monitor logs
pm2 logs unibrowse-dev

# Restart service
pm2 restart unibrowse-dev

# Stop service
pm2 stop unibrowse-dev

# Enable auto-start on boot
pm2 startup
pm2 save
```

**Configuration:**
- **Script:** `./dist/http-server.js`
- **Max Memory:** 500MB
- **Auto-restart:** Enabled
- **Logs:** Stored in `logs/` directory
- **Environment:** Production (use `--env development` for dev mode)
