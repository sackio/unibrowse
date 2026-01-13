# Scripts Directory

## ⚠️ Macro Management

**DO NOT create scripts for macro management**. Use MCP tools instead:

### MCP Tools for Macros (REQUIRED)
- `browser_store_macro` - Create new macros
- `browser_list_macros` - Query/filter macros
- `browser_execute_macro` - Execute macros
- `browser_update_macro` - Update macros
- `browser_delete_macro` - Remove macros

See `.claude/skills/browser/MACRO_LEARNING.md` for complete workflow.

## Remaining Scripts

### Backup & Restore (Keep These)
- `backup-macros.sh` - Main backup script (BSON + JSON to /mnt/backup/)
- `backup-mongodb-scheduled.sh` - Automated backup for systemd timer
- `restore-mongodb-from-backup.sh` - Restore from /mnt/backup/

**Why these are kept**: Infrastructure operations (backups) are appropriate for scripts. Application operations (CRUD) must use MCP tools.

## Removed Scripts

The following scripts were removed because they duplicate MCP tool functionality:
- Store scripts: store-ebay-macros.cjs, store-ground-news-macros.cjs, etc.
- Retrieve scripts: get-macro-code.cjs, get-macros-for-site.sh, etc.
- Update scripts: update-product-info-macro.cjs, fix-related-products-macro.cjs, etc.
- Utility scripts: utils/list-macros.js, utils/test-macro.js
- Git hooks: hooks/update-macro-context.sh

Use MCP tools instead.
