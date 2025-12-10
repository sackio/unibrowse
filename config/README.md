# Configuration Files

This directory contains configuration files for unibrowse.

## Files

### ecosystem.config.js

PM2 process manager configuration for running unibrowse as a managed service.

### nodemon.json

Nodemon configuration for development with auto-reload on file changes.

### browser-mcp.service

Systemd service file for running unibrowse as a system service (production).

### browser-mcp-dev.service

Systemd service file for running unibrowse in development mode.

**Usage:**

From repository root:
```bash
# Start the service
pm2 start config/ecosystem.config.js

# Monitor logs
pm2 logs browser-mcp

# Restart service
pm2 restart browser-mcp

# Stop service
pm2 stop browser-mcp

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
