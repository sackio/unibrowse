# unibrowse Utility Scripts

This directory contains development utility scripts for working with unibrowse.

## Available Utilities

### Macro Management

- **list-macros.js** - List and search macros stored in MongoDB
  ```bash
  node scripts/utils/list-macros.js [search_term]
  ```

- **test-macro.js** - Execute a specific macro by ID for testing
  ```bash
  node scripts/utils/test-macro.js <macro_id> [params_json]
  ```

## Usage Examples

### List All Macros
```bash
node scripts/utils/list-macros.js
```

### Search Macros
```bash
node scripts/utils/list-macros.js "form"
node scripts/utils/list-macros.js "extract"
```

### Test a Macro
```bash
# Simple test without parameters
node scripts/utils/test-macro.js abc123def456

# Test with parameters
node scripts/utils/test-macro.js abc123def456 '{"selector":"#myForm","data":"test"}'
```

## Adding New Utilities

When adding new utility scripts:

1. Place them in this directory
2. Use clear, descriptive names
3. Add a shebang line: `#!/usr/bin/env node`
4. Make executable: `chmod +x scripts/utils/your-script.js`
5. Document usage in this README
6. Handle errors gracefully
7. Provide helpful error messages
