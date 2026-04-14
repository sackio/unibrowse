# HTTP MCP Refactoring Summary

## Overview

unibrowse has been refactored to use **persistent Streamable HTTP transport** as the primary MCP communication method, replacing stdio as the default mode.

## Changes Made

### 1. **HTTP Server is Now Primary** (`src/http-server.ts`)
- ✅ Added ALL 40+ MCP tools (was missing 15 tools before)
- ✅ Includes tabs, forms, recording, interaction log tools
- ✅ Default port changed from 3010 → **9010**
- ✅ Uses Express + **Streamable HTTP transport** (MCP SDK 1.20.0+)
- ✅ **Combined HTTP + WebSocket server on single port (9010)**
- ✅ WebSocket available at `ws://localhost:9010/ws`
- ✅ No authentication (as requested)

### 2. **stdio Mode is Now Legacy** (`src/stdio-server.ts`)
- 📁 Renamed: `src/index.ts` → `src/stdio-server.ts`
- ⚙️ Still available via `npm run start:stdio`
- 🔍 Used for MCP Inspector: `npm run inspector`
- ⚠️ Not the default anymore

### 3. **Configuration Updates**

**`.env` file** (new):
```bash
PORT=9010
NODE_ENV=development
```

**`src/config/mcp.config.ts`**:
```typescript
{
  defaultWsPort: 9009,      // Legacy: Standalone WebSocket port
  defaultHttpPort: 9010,    // Combined HTTP + WebSocket server port
}
```

**`package.json`**:
```json
{
  "bin": {
    "mcp-server-browsermcp": "dist/http-server.js"  // Changed from index.js
  },
  "scripts": {
    "start": "node dist/http-server.js",            // NEW: Primary start
    "start:stdio": "node dist/stdio-server.js",     // Legacy mode
    "dev": "nodemon",                                // HTTP dev mode
    "inspector": "... node dist/stdio-server.js"    // Inspector uses stdio
  }
}
```

### 4. **Service Configurations Updated**

**`unibrowse.service`** (systemd):
```ini
Environment="PORT=9010"  # Changed from 3010
ExecStart=/usr/bin/node /mnt/nas/data/code/unibrowse/dist/http-server.js
```

**`ecosystem.config.js`** (PM2):
```javascript
env: {
  PORT: 9010  // Changed from 3010
}
```

### 5. **Build Configuration**
- Build now compiles both `http-server.ts` and `stdio-server.ts`
- Output: `dist/http-server.js` (primary), `dist/stdio-server.js` (legacy)

## Usage

### Starting the Server

**Development Mode:**
```bash
npm run dev          # Starts HTTP server with auto-reload on port 9010
```

**Production Mode:**
```bash
npm start            # Starts HTTP server on port 9010
```

**Legacy stdio Mode:**
```bash
npm run start:stdio  # Starts stdio MCP server (for backward compatibility)
```

**With PM2:**
```bash
pm2 start ecosystem.config.js
```

**With systemd:**
```bash
sudo systemctl start unibrowse
```

### MCP Client Connection

**Streamable HTTP Endpoint:**
```
http://localhost:9010/mcp
```

**Health Check:**
```
http://localhost:9010/health
```

**WebSocket (for browser extension):**
```
ws://localhost:9010/ws
```

### Environment Variables

Configure via `.env` file:
```bash
PORT=9010              # HTTP/SSE server port (default: 9010)
NODE_ENV=development   # or production
```

## Available MCP Tools (68 total)

### Navigation & Common (7)
- `browser_navigate`
- `browser_go_back`
- `browser_go_forward`
- `browser_press_key`
- `browser_scroll`
- `browser_scroll_to_element`
- `browser_wait`

### Snapshot & Interaction (6)
- `browser_snapshot`
- `browser_click`
- `browser_drag`
- `browser_hover`
- `browser_type`
- `browser_select_option`

### DOM Exploration (11)
- `browser_query_dom`
- `browser_get_visible_text`
- `browser_get_computed_styles`
- `browser_check_visibility`
- `browser_get_attributes`
- `browser_count_elements`
- `browser_get_page_metadata`
- `browser_get_filtered_aria_tree`
- `browser_find_by_text`
- `browser_get_form_values`
- `browser_check_element_state`

### Custom (4)
- `browser_evaluate`
- `browser_get_console_logs`
- `browser_get_network_logs`
- `browser_screenshot`

### Tabs (4)
- `browser_list_tabs`
- `browser_switch_tab`
- `browser_create_tab`
- `browser_close_tab`

### Forms (2)
- `browser_fill_form`
- `browser_submit_form`

### Recording (2)
- `browser_request_demonstration`
- `browser_request_user_action`

### Interaction Log (3)
- `browser_get_interactions`
- `browser_prune_interactions`
- `browser_search_interactions`

### Cookie Management (4)
- `browser_get_cookies`
- `browser_set_cookie`
- `browser_delete_cookie`
- `browser_clear_cookies`

### Download Management (4)
- `browser_download_file`
- `browser_get_downloads`
- `browser_cancel_download`
- `browser_open_download`

### Clipboard (2)
- `browser_get_clipboard`
- `browser_set_clipboard`

### History (4)
- `browser_search_history`
- `browser_get_history_visits`
- `browser_delete_history`
- `browser_clear_history`

### System Information (3)
- `browser_get_version`
- `browser_get_system_info`
- `browser_get_browser_info`

### Network (3)
- `browser_get_network_state`
- `browser_set_network_conditions`
- `browser_clear_cache`

### Bookmarks (4)
- `browser_get_bookmarks`
- `browser_create_bookmark`
- `browser_delete_bookmark`
- `browser_search_bookmarks`

### Extension Management (4)
- `browser_list_extensions`
- `browser_get_extension_info`
- `browser_enable_extension`
- `browser_disable_extension`

## Testing

```bash
# Build
npm run build

# Start server
npm start

# In another terminal, test health endpoint
curl http://localhost:9010/health

# Test MCP endpoint (requires valid MCP message)
# Use claude mcp list to test connection properly
```

Expected output:
```
[HTTP] WebSocket server ready on ws://localhost:9009
[HTTP] MCP server initialized with Streamable HTTP transport
[HTTP] unibrowse server listening on http://localhost:9010
[HTTP] MCP endpoint: http://localhost:9010/mcp
[HTTP] Health check: http://localhost:9010/health
```

## Architecture

```
┌─────────────────┐           ┌─────────────────────────┐
│  MCP Clients    │           │  Chrome Extension       │
│ (Claude, etc.)  │           │  - Service Worker       │
└────────┬────────┘           │  - Chrome Debugger API  │
         │                     └────────┬────────────────┘
         │ Streamable HTTP              │ WebSocket
         │ POST /mcp                    │ ws://...9010/ws
         │                              │
         └──────────────┬───────────────┘
                        │
                port 9010 (combined)
                        │
         ┌──────────────▼──────────────┐
         │  unibrowse Server         │
         │  - Express HTTP Server      │
         │  - Streamable HTTP (/mcp)   │
         │  - WebSocket (/ws)          │
         │  - MCP SDK 1.20.0+          │
         │  - All 40+ tools            │
         │  - No auth                  │
         └─────────────────────────────┘
```

## Migration Notes

### From stdio to Streamable HTTP:

**Before (stdio):**
```json
{
  "mcpServers": {
    "unibrowse": {
      "command": "node",
      "args": ["/path/to/dist/index.js"]
    }
  }
}
```

**After (Streamable HTTP):**
```json
{
  "mcpServers": {
    "unibrowse": {
      "type": "http",
      "url": "http://localhost:9010/mcp"
    }
  }
}
```

### Benefits of Streamable HTTP:

1. ✅ **Persistent Connection** - Server stays running, faster response times
2. ✅ **Multiple Clients** - Multiple MCP clients can connect simultaneously
3. ✅ **Easier Debugging** - Can test with curl/Postman
4. ✅ **Health Checks** - `/health` endpoint for monitoring
5. ✅ **No stdin/stdout conflicts** - Better logging and error handling
6. ✅ **Service Management** - Works with systemd, PM2, Docker
7. ✅ **Combined Server** - HTTP and WebSocket on single port (9010)
8. ✅ **Simplified Architecture** - One server handles both MCP clients and browser extension

## Files Changed

- ✅ `src/http-server.ts` - Combined HTTP + WebSocket server on port 9010
- ✅ `src/server.ts` - Added optional WebSocketServer parameter
- ✅ `src/ws.ts` - Added createWebSocketServerFromHTTP function
- ✅ `src/stdio-server.ts` - Renamed from index.ts (legacy)
- ✅ `src/config/mcp.config.ts` - Updated port comments
- ✅ `extension/utils/websocket.js` - Updated to ws://localhost:9010/ws
- ✅ `extension/utils/websocket-offscreen.js` - Updated to ws://localhost:9010/ws
- ✅ `.env` - New config file
- ✅ `.gitignore` - Added .env
- ✅ `package.json` - Updated bin, scripts, MCP SDK to 1.20.0
- ✅ `unibrowse.service` - Updated port
- ✅ `ecosystem.config.js` - Updated port

## Next Steps

1. Update MCP client configurations to use HTTP/SSE endpoint
2. Consider adding optional authentication if needed
3. Update documentation and README
4. Test with real MCP clients (Claude Code, VS Code, etc.)

## Claude Code MCP Configuration

### Configuration File

Location: `~/.claude.json` (project config) or `~/.claude/mcp/browser.json` (global config)

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://localhost:9010/mcp"
    }
  }
}
```

### Hot Reload Development

The dev server now includes hot reload functionality:

```bash
npm run dev
```

**Features:**
- ✅ Watches `src/`, `extension/`, and `.env` files
- ✅ Auto-rebuilds TypeScript on changes
- ✅ Restarts both HTTP and WebSocket servers
- ✅ 1 second delay to avoid rapid restarts
- ✅ Loads environment variables from `.env`
- ✅ Type `rs` to manually restart

**What triggers reload:**
- Any `.ts` or `.js` file in `src/` or `extension/`
- Changes to `.env` file
- Manual restart with `rs` command

### Environment Variables

All start methods now support `.env` file:

**Development:**
```bash
npm run dev          # Uses nodemon with --env-file=.env
```

**Production:**
```bash
npm start            # Uses node --env-file=.env
```

**systemd:**
```ini
ExecStart=/usr/bin/node --env-file=/path/to/.env /path/to/dist/http-server.js
```

**PM2:**
```javascript
node_args: '--env-file=.env'
```

## systemd Development Service

A development mode systemd service has been created with hot reloading enabled.

**Installation (already completed):**
```bash
# Service is already installed and running
sudo systemctl status unibrowse-dev

# To restart the service
sudo systemctl restart unibrowse-dev

# To view logs
sudo journalctl -u unibrowse-dev -f
```

**Features:**
- ✅ Runs `npm run dev` with nodemon hot reloading
- ✅ Auto-starts on boot
- ✅ Auto-restarts on crashes (RestartSec=10)
- ✅ Watches src/, extension/, and .env files
- ✅ Rebuilds TypeScript on changes
- ✅ Logs to systemd journal (syslog identifier: unibrowse-dev)
- ✅ NODE_ENV=development
- ✅ Uses NVM node path

**Location:**
- Service file: `/etc/systemd/system/unibrowse-dev.service`
- Source: `/mnt/nas/data/code/unibrowse/unibrowse-dev.service`

## Connection Verification

1. **Check server health:**
   ```bash
   curl http://localhost:9010/health
   ```

2. **Test MCP connection:**
   ```bash
   claude mcp list
   # Should show: browser: http://localhost:9010/mcp (HTTP) - ✓ Connected
   ```

3. **Restart Claude Code** to load the new MCP configuration

4. **Verify in Claude Code:**
   - unibrowse tools should be available
   - Check for all 40+ tools in the tool list
   - Connection should be persistent and stable
