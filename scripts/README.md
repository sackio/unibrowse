# Browser MCP Scripts

This directory contains operational scripts and utilities for Browser MCP.

## Structure

- **/** - Operational scripts (shell scripts and MongoDB utilities)
- **utils/** - Development utilities (list-macros.js, test-macro.js)

## Shell Scripts

### Service Management

- **service.sh** - Systemd service management script
  ```bash
  ./scripts/service.sh start|stop|restart|status
  ```

- **run-tests.sh** - Run test suites
  ```bash
  ./scripts/run-tests.sh
  ```

### Database Management

- **backup-mongodb.sh** - Backup MongoDB database to file
  ```bash
  ./scripts/backup-mongodb.sh
  ```

- **restore-mongodb.sh** - Restore MongoDB database from backup
  ```bash
  ./scripts/restore-mongodb.sh
  ```

- **get-macros-for-site.sh** - Get all macros for a specific site
  ```bash
  ./scripts/get-macros-for-site.sh <site_domain>
  ```

## MongoDB Utilities (.cjs)

These CommonJS scripts interact directly with MongoDB for macro management:

- **dump-product-info-macro.cjs** - Export product info macro
- **get-macro-code.cjs** - Retrieve macro code by ID
- **get-product-info-macro.cjs** - Get product info macro
- **get-related-macro.cjs** - Get related products macro
- **update-product-info-macro.cjs** - Update product info macro
- **update-product-info-delivery-fix.cjs** - Fix delivery in product info macro
- **update-related-products-macro.cjs** - Update related products macro
- **update-search-results-macro.cjs** - Update search results macro
- **fix-related-products-macro.cjs** - Fix related products macro

## Development Utilities

See [utils/README.md](./utils/README.md) for information about development utilities like:
- list-macros.js
- test-macro.js
