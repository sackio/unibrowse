# Browser MCP Service Management

The Browser MCP WebSocket/HTTP server can run in several modes:

## Quick Start

### Development (Hot Reload)
```bash
./service.sh dev
# or
npm run dev:http
```
- Auto-rebuilds on file changes
- Restarts server automatically
- Best for active development

### Production (PM2) - Recommended
```bash
./service.sh start    # Start service
./service.sh logs     # View logs
./service.sh restart  # Restart
./service.sh stop     # Stop
```
- Automatic restarts on crash
- Log management
- Memory monitoring
- Easy to manage

### Production (systemd) - Alternative
```bash
./service.sh systemd-install  # One-time setup
./service.sh systemd-start    # Start service
./service.sh systemd-logs     # View logs
./service.sh systemd-stop     # Stop
```
- Runs as system service
- Auto-start on boot
- System-level logging

## Service Management Commands

### Using service.sh (Recommended)

```bash
# Development
./service.sh dev              # Start with hot reload

# PM2 (recommended for always-on)
./service.sh start            # Start service
./service.sh stop             # Stop service
./service.sh restart          # Restart service
./service.sh logs             # View logs (live tail)
./service.sh status           # Check status

# Systemd (alternative for always-on)
./service.sh systemd-install  # Install systemd service
./service.sh systemd-start    # Start service
./service.sh systemd-stop     # Stop service
./service.sh systemd-status   # Check status
./service.sh systemd-logs     # View logs
```

## Method Comparison

| Feature | Development | PM2 | Systemd |
|---------|------------|-----|---------|
| Auto-restart | ✅ (on change) | ✅ (on crash) | ✅ (on crash) |
| Hot reload | ✅ | ❌ | ❌ |
| Log management | Console | ✅ Files | ✅ Journal |
| Memory monitoring | ❌ | ✅ | ❌ |
| Boot auto-start | ❌ | ✅ (pm2 startup) | ✅ |
| Best for | Development | Production | System service |

## PM2 Details

### Installation
```bash
npm install -g pm2
```

### Configuration
Edit `ecosystem.config.js` to customize:
- Memory limits
- Environment variables
- Log paths
- Restart policies

### Advanced PM2 Commands
```bash
pm2 list                    # List all processes
pm2 monit                   # Monitor CPU/memory
pm2 restart browser-mcp     # Restart service
pm2 reload browser-mcp      # Zero-downtime reload
pm2 stop browser-mcp        # Stop service
pm2 delete browser-mcp      # Remove from PM2

# Auto-start on boot
pm2 startup                 # Generate startup script
pm2 save                    # Save current process list

# Logs
pm2 logs browser-mcp        # Live tail
pm2 logs browser-mcp --lines 100  # Last 100 lines
pm2 flush                   # Clear logs
```

## Systemd Details

### Installation
```bash
./service.sh systemd-install
```

This copies `browser-mcp.service` to `~/.config/systemd/user/`

### Service File Location
- User service: `~/.config/systemd/user/browser-mcp.service`
- System service (requires sudo): `/etc/systemd/system/browser-mcp.service`

### Manual systemd Commands
```bash
# User service (no sudo needed)
systemctl --user start browser-mcp.service
systemctl --user stop browser-mcp.service
systemctl --user restart browser-mcp.service
systemctl --user status browser-mcp.service
systemctl --user enable browser-mcp.service   # Auto-start on login
systemctl --user disable browser-mcp.service

# Logs
journalctl --user -u browser-mcp.service -f   # Live tail
journalctl --user -u browser-mcp.service -n 100  # Last 100 lines
```

## Configuration

### Ports
- WebSocket: `ws://localhost:9009` (for browser extension)
- HTTP/SSE: `http://localhost:3010` (for MCP clients)

Change ports by editing:
- `package.json` scripts
- `ecosystem.config.js` (PM2)
- `browser-mcp.service` (systemd)

### Environment Variables
- `NODE_ENV`: `development` or `production`
- `PORT`: HTTP server port (default: 3010)

## Logs

### Development
Console output

### PM2
- Location: `./logs/out.log` and `./logs/error.log`
- View: `./service.sh logs` or `pm2 logs browser-mcp`

### Systemd
- Location: System journal
- View: `./service.sh systemd-logs` or `journalctl --user -u browser-mcp.service -f`

## Troubleshooting

### Port already in use
```bash
# Find process using port 9009
lsof -i :9009
# Kill it
kill <PID>
```

### Service won't start
```bash
# Check logs
./service.sh logs              # PM2
./service.sh systemd-logs      # Systemd

# Check if dist is built
npm run build

# Check node version
node --version  # Should be v18+
```

### PM2 not found
```bash
npm install -g pm2
```

### Can't connect from browser extension
1. Ensure service is running: `./service.sh status`
2. Check WebSocket is listening: `lsof -i :9009`
3. Check browser console for connection errors
4. Verify firewall allows port 9009

## Recommended Setup

**For Development:**
```bash
./service.sh dev
```

**For Production (Local/LAN):**
```bash
# Install PM2 (one-time)
npm install -g pm2

# Start service
./service.sh start

# Enable auto-start on boot
pm2 startup
pm2 save
```

**For Production (System Service):**
```bash
./service.sh systemd-install
./service.sh systemd-start
```
