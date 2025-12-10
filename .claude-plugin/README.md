# Unibrowse Browser Automation Plugin

> Advanced browser automation for Claude Code with 5 specialized sub-agents, 57+ macros, and intelligent delegation

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/sackio/unibrowse)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/sackio/unibrowse/blob/main/LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple.svg)](https://modelcontextprotocol.io)

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/sackio/unibrowse.git
cd unibrowse
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI

# 3. Build and store macros
npm run build
npm run store:macros
npm run store:advanced-macros

# 4. Start MCP server
npm start
# Server runs on http://localhost:9010

# 5. Load Chrome extension
# Open chrome://extensions → Enable Developer Mode → Load unpacked → Select extension/

# 6. Configure Claude Code
# Add to your MCP configuration:
{
  "mcpServers": {
    "browser": {
      "transport": "websocket",
      "url": "ws://localhost:9010/ws"
    }
  }
}

# 7. Verify installation
npm run test:prereq
```

## ✨ Features

### 5 Specialized Sub-Agents

**🌐 Generic Browser** (`browser`)
- Tab creation and management with ID preservation
- Macro-first execution with fallback to direct MCP tools
- Multi-tab workflow coordination
- Screenshot capture and navigation

**🛒 E-Commerce** (`browser-ecommerce`)
- Amazon automation with 17 specialized macros
- Product search, filtering, and comparison
- Reviews analysis and sentiment tracking
- Rufus AI integration
- Multi-site price comparison

**📝 Form Automation** (`browser-forms`)
- Intelligent form discovery and analysis
- Smart field detection (email, phone, validation)
- Multi-step form handling
- Safety checks and preview before submission
- Conditional field detection

**🔍 Web Scraper** (`browser-scraper`)
- Structured data extraction (tables, lists, products)
- Pagination and infinite scroll handling
- Multi-page aggregation
- Export to JSON/CSV
- Token-optimized extraction

**🧪 QA Testing** (`browser-qa`)
- WCAG 2.1 accessibility audits
- Performance testing and bottleneck analysis
- Visual regression testing
- Keyboard navigation validation
- Comprehensive markdown reports

### 57+ Macros

- **40+ Universal Macros**: Work on any website
- **17 Amazon Macros**: E-commerce specific automation
- **7 Categories**: extraction, form, navigation, util, interaction, exploration, cdn
- **High Reliability**: Tested and documented
- **MongoDB Storage**: Centralized macro management

### Automatic Delegation

Claude Code automatically delegates to the appropriate sub-agent based on your request:

```
"Search Amazon for wireless headphones" → browser-ecommerce
"Fill out the contact form" → browser-forms
"Extract all products from this page" → browser-scraper
"Test this page for accessibility" → browser-qa
"Take a screenshot" → browser
```

### Tab Context Preservation

Sub-agents create tabs and return IDs, enabling multi-step workflows:

```
User: "Compare prices on Amazon and Walmart"
  → E-commerce creates 2 tabs, returns amazonTab=123, walmartTab=456

User: "Get more details on the Amazon result"
  → E-commerce uses tabTarget=123 (preserved context)
```

## 📋 Prerequisites

- **Node.js** ≥18.0.0
- **MongoDB** ≥4.4.0 (running locally or remote)
- **Google Chrome** ≥120.0.0
- **Claude Code** ≥0.1.0

## 📦 Installation

### 1. Install Dependencies

**MongoDB** (if not already installed):
```bash
# macOS
brew install mongodb-community

# Ubuntu/Debian
sudo apt-get install mongodb

# Or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

**Node.js** (if not already installed):
```bash
# Use nvm
nvm install 18
nvm use 18

# Or download from https://nodejs.org
```

### 2. Clone and Setup Unibrowse

```bash
# Clone repository
git clone https://github.com/sackio/unibrowse.git
cd unibrowse

# Install npm dependencies
npm install

# Configure environment
cp .env.example .env
```

Edit `.env` to configure:
```env
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017/unibrowse

# MCP Server settings
SERVER_PORT=9010
```

### 3. Build MCP Server

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 4. Store Macros

```bash
# Store core utility macros (17 macros)
npm run store:macros

# Store advanced macros (24 macros)
npm run store:advanced-macros

# Optional: Store form controls and other specialized macros
# See package.json for additional store commands
```

This loads all 57+ macros into MongoDB for use by sub-agents.

### 5. Load Chrome Extension

1. Open Google Chrome
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `extension/` directory from this repository
6. The Unibrowse extension icon should appear in your toolbar

### 6. Connect Extension to MCP Server

1. Click the Unibrowse extension icon
2. Enter WebSocket URL: `ws://localhost:9010/ws`
3. Click **Connect**
4. Status should show "Connected" (green)

### 7. Configure Claude Code MCP

Add to your Claude Code MCP configuration file:

**Location**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Configuration**:
```json
{
  "mcpServers": {
    "browser": {
      "transport": "websocket",
      "url": "ws://localhost:9010/ws"
    }
  }
}
```

### 8. Start MCP Server

```bash
npm start
```

Server will run on `http://localhost:9010` with WebSocket endpoint at `ws://localhost:9010/ws`.

**To run in background**:
```bash
# Using nohup
nohup npm start > server.log 2>&1 &

# Or using Docker Compose (if available)
docker compose up -d
```

### 9. Verify Installation

```bash
npm run test:prereq
```

This checks:
- ✓ MCP server is running on port 9010
- ✓ Chrome extension is loaded and connected
- ✓ At least one browser tab is attached
- ✓ MongoDB is accessible

## 🎯 Usage Examples

### E-Commerce Automation

```
"Search Amazon for wireless headphones under $100 with good reviews"

The browser-ecommerce agent will:
1. Navigate to Amazon
2. Search for "wireless headphones"
3. Apply price filter (< $100)
4. Sort by customer reviews
5. Extract top results with ratings and prices
```

### Form Automation

```
"Fill out the contact form on example.com with my information"

The browser-forms agent will:
1. Navigate to example.com
2. Discover and analyze all forms
3. Detect field types (name, email, phone, etc.)
4. Fill fields with appropriate data
5. Show preview for confirmation
6. Submit after user approval
```

### Web Scraping

```
"Extract all product data from this page and export to CSV"

The browser-scraper agent will:
1. Analyze page structure
2. Detect product containers
3. Extract structured data (name, price, rating, etc.)
4. Handle pagination if present
5. Export to /tmp/products.csv
```

### QA Testing

```
"Audit this page for accessibility issues"

The browser-qa agent will:
1. Run WCAG 2.1 compliance checks
2. Test keyboard navigation
3. Analyze color contrast
4. Check ARIA attributes
5. Generate markdown report with severity levels and recommendations
```

### Multi-Tab Workflows

```
"Compare prices for iPhone 15 on Amazon, Walmart, and Best Buy"

The browser-ecommerce agent will:
1. Create 3 tabs (amazon=123, walmart=456, bestbuy=789)
2. Search each site in parallel
3. Extract pricing data from all tabs
4. Return comparison table with tab IDs preserved
5. Future requests can target specific tabs: "Get more details on the Amazon result"
```

## 🏗️ Architecture

```
User Request
    ↓
Browser Skill (guidance + delegation strategy)
    ↓
Main Conversation (delegates to sub-agent)
    ↓
Specialized Sub-Agent
    ↓
  1. Check site-specific macros
  2. Check universal macros
  3. Execute macro OR use direct MCP tools
  4. Return results + tab IDs
    ↓
Main Conversation (stores tab context, presents results)
```

### Macro-First Philosophy

All sub-agents follow this pattern:
1. Extract domain from URL
2. Search for site-specific macros: `browser_list_macros({ site: "amazon.com" })`
3. Search for universal macros: `browser_list_macros({ site: "*" })`
4. Execute macro if available
5. Fall back to direct MCP tools if no macro exists
6. Report which method was used

### Tab Context Preservation

Sub-agents create tabs and return metadata:
```json
{
  "tabId": 123,
  "label": "amazon-search",
  "url": "https://amazon.com/s?k=headphones",
  "data": { ... }
}
```

Main conversation stores tab IDs in context, enabling future operations on specific tabs.

## 📚 Documentation

**Plugin Documentation**:
- [Plugin Guide](../docs/PLUGIN_GUIDE.md) - Complete plugin documentation
- [Architecture](../docs/ARCHITECTURE.md) - Technical architecture details
- [Examples](../docs/EXAMPLES.md) - Usage examples for all sub-agents

**Macro Documentation**:
- [Macros Index](../docs/macros/README.md) - Complete macro documentation
- [Utility Macros](../docs/macros/UTILITY_MACROS.md) - 17 utility macros
- [Advanced Macros](../docs/macros/ADVANCED_MACROS.md) - 24 advanced macros
- [Form Controls](../docs/macros/FORM_CONTROLS_MACROS.md) - 11 form control macros
- [Form Filling](../docs/macros/FORM_FILLING_MACROS.md) - 7 form filling macros
- [CDN Injection](../docs/macros/CDN_INJECTION_MACROS.md) - 4 CDN injection macros

**Skill Documentation**:
- [Browser Skill](../.claude/skills/browser/SKILL.md) - Delegation patterns
- [Macros Reference](../.claude/skills/browser/MACROS.md) - 57+ macros
- [Multi-Tab Patterns](../.claude/skills/browser/MULTI_TAB.md) - Multi-tab workflows
- [Amazon Macros](../.claude/skills/browser/AMAZON_MACROS.md) - Amazon-specific automation
- [Troubleshooting](../.claude/skills/browser/TROUBLESHOOTING.md) - Common issues

**Testing Documentation**:
- [Test Execution Guide](../docs/TEST_EXECUTION_GUIDE.md) - How to run tests
- [Test Results](../docs/TEST_RESULTS.md) - Latest test results
- [Multi-Tab Testing](../docs/MULTI_TAB_TESTING.md) - Multi-tab test guide

**API Reference**:
- [Tools Reference](../docs/TOOLS_REFERENCE.md) - Complete API reference for 76 MCP tools

## 🔧 Troubleshooting

### MCP Server Not Connecting

**Problem**: Claude Code can't connect to MCP server

**Solutions**:
1. Verify server is running: `curl http://localhost:9010/health`
2. Check MCP configuration in Claude Code settings
3. Ensure WebSocket URL is correct: `ws://localhost:9010/ws`
4. Check firewall settings allow port 9010
5. Review server logs: `tail -f server.log`

### Extension Not Connecting

**Problem**: Chrome extension shows "Disconnected"

**Solutions**:
1. Ensure MCP server is running first
2. Verify WebSocket URL: `ws://localhost:9010/ws` (not https://)
3. Check extension console for errors (right-click extension icon → Inspect)
4. Reload extension from chrome://extensions
5. Check browser console for connection errors

### MongoDB Connection Failed

**Problem**: Server fails to connect to MongoDB

**Solutions**:
1. Verify MongoDB is running: `mongosh --eval 'db.version()'`
2. Check MONGODB_URI in `.env` file
3. Ensure MongoDB port 27017 is accessible
4. Try connecting manually: `mongosh mongodb://localhost:27017/unibrowse`
5. Check MongoDB logs for errors

### No Macros Available

**Problem**: Sub-agents can't find macros

**Solutions**:
1. Store macros: `npm run store:macros && npm run store:advanced-macros`
2. Verify macros in MongoDB: `mongosh unibrowse --eval 'db.macros.count()'`
3. Check macro storage scripts ran successfully
4. Review macro storage logs for errors

### Tab Context Not Preserved

**Problem**: Sub-agent can't target specific tabs

**Solutions**:
1. Ensure tab was created by sub-agent (not manual)
2. Verify tab ID was returned in previous response
3. Check tab is still open and attached
4. Use `browser_list_attached_tabs` to see available tabs
5. Attach to tab manually if needed: `browser_attach_tab`

### Tests Failing

**Problem**: `npm test` or `npm run test:prereq` fails

**Solutions**:
1. Run prerequisites check first: `npm run test:prereq`
2. Ensure all prerequisites pass before running other tests
3. Check MCP server is running
4. Verify Chrome extension is connected
5. Ensure at least one tab is attached (click extension icon → Attach)
6. Review test output for specific errors

## 🧪 Testing

### Prerequisites Check
```bash
npm run test:prereq
```
Verifies MCP server, extension, and tab attachment.

### Comprehensive Test Suite
```bash
npm test
```
Tests all 76 MCP tools across 18 categories. Expected: 95%+ pass rate.

### Specific Test Suites
```bash
npm run test:multi-tab    # Multi-tab management (18 tests)
npm run test:window       # Window creation (3 tests)
npm run test:utility-macros   # Utility macros (4 tests)
npm run test:advanced-macros  # Advanced macros (24 tests)
```

### Backup and Test
```bash
npm run backup:test
```
Backs up macros from MongoDB and runs comprehensive test suite.

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

**Areas for contribution**:
- New specialized sub-agents (social media, email, video, etc.)
- Additional macros for common websites
- Improved error handling and recovery
- Performance optimizations
- Documentation improvements

## 📄 License

MIT License - see [LICENSE](../LICENSE) for details.

## 🔗 Links

- **Repository**: https://github.com/sackio/unibrowse
- **Issues**: https://github.com/sackio/unibrowse/issues
- **Documentation**: [docs/](../docs/)
- **MCP Protocol**: https://modelcontextprotocol.io
- **Claude Code**: https://code.claude.com

## 📊 Stats

- **76 MCP Tools** - Complete browser automation API
- **57+ Macros** - Reusable automation patterns
- **5 Sub-Agents** - Specialized domain experts
- **18 Test Categories** - Comprehensive test coverage
- **100% Pass Rate** - All tests passing

## 🙏 Credits

Unibrowse is a fork of [browser-mcp](https://github.com/BrowserMCP/mcp), extended with plugin architecture, specialized sub-agents, and 57+ automation macros.

**Thank you to the browser-mcp team for creating the foundation that made this plugin possible!**

The original browser-mcp was inspired by Microsoft's [Playwright MCP server](https://github.com/microsoft/playwright-mcp), adapting it to automate the user's existing browser for better session management and stealth.

---

**Built with ❤️ by the Unibrowse team**
