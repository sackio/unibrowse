#!/bin/bash
# Check if a click caused navigation
# Waits briefly then calls update-macro-context if URL changed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Wait briefly for potential navigation
sleep 0.5

# Call the main update script
"$SCRIPT_DIR/update-macro-context.sh"
