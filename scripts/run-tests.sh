#!/bin/bash

# unibrowse Test Suite Runner
# This script runs through the test suite defined in TEST_SUITE.md
# by asking Claude Code to execute each test

cat << 'EOF'

🧪 unibrowse Test Suite Runner
==================================================

This script will prompt Claude Code to run through all MCP tools systematically.

PREREQUISITES:
1. Extension must be loaded and reloaded in Chrome
2. Must be connected to an active tab
3. Tab should be on a page with interactive elements

USAGE:
  Simply ask Claude Code to "run the browser MCP test suite"

  Claude will:
  - Execute each tool in TEST_SUITE.md
  - Report results for each test
  - Provide a summary at the end

OPTIONS:
  --quick     Skip navigation and demonstration tests
  --verbose   Show detailed output for each test

For manual testing, see TEST_SUITE.md for the complete test plan.

==================================================

To start testing, ask:
  "Run the browser MCP test suite"

Or for quick mode:
  "Run the browser MCP test suite in quick mode"

EOF
