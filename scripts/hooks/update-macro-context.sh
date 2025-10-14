#!/bin/bash
# Update macro context when navigation occurs
# Automatically injects available macros for the new site

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
STATE_FILE="/tmp/browser-agent-context-$(whoami).json"

# Function to extract domain from URL
get_domain() {
    local url="$1"
    echo "$url" | awk -F/ '{print $3}' | sed 's/^www\.//'
}

# Function to get current browser state via MCP
get_current_url() {
    # Try to get from browser snapshot (this would need MCP call)
    # For now, we'll parse from tool output or use a simple approach
    # In production, this would query the browser's current URL
    echo "${BROWSER_CURRENT_URL:-unknown}"
}

# Get new URL from environment or tool output
NEW_URL="${BROWSER_CURRENT_URL:-}"
if [[ -z "$NEW_URL" ]]; then
    # Try to extract from STDIN (tool output)
    NEW_URL=$(grep -oP 'url["\s:]+\K[^"]+' 2>/dev/null | head -1 || echo "")
fi

# If we still don't have a URL, check state file
if [[ -z "$NEW_URL" ]] || [[ "$NEW_URL" == "unknown" ]]; then
    if [[ -f "$STATE_FILE" ]]; then
        NEW_URL=$(jq -r '.url // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
    fi
fi

# Extract domain
NEW_DOMAIN=$(get_domain "$NEW_URL")

# Load last known domain
LAST_DOMAIN=""
if [[ -f "$STATE_FILE" ]]; then
    LAST_DOMAIN=$(jq -r '.domain // ""' "$STATE_FILE" 2>/dev/null || echo "")
fi

# Check if domain actually changed
if [[ "$NEW_DOMAIN" == "$LAST_DOMAIN" ]] || [[ "$NEW_DOMAIN" == "unknown" ]] || [[ -z "$NEW_DOMAIN" ]]; then
    # No change or unknown domain, exit silently
    exit 0
fi

# Update state file
echo "{\"domain\": \"$NEW_DOMAIN\", \"url\": \"$NEW_URL\", \"timestamp\": \"$(date -Iseconds)\"}" > "$STATE_FILE"

# Only output if agent is active
if [[ "${CLAUDE_SUBAGENT_NAME:-}" == "browser-automation" ]] || [[ "${CLAUDE_AGENT_ACTIVE:-0}" == "1" ]]; then
    echo ""
    echo "🔄 **Navigation Detected - Macro Context Updated**"
    echo ""
    echo "**New Site:** \`$NEW_DOMAIN\`"
    echo "**URL:** $NEW_URL"
    echo ""

    # Check if MongoDB container is running
    if ! docker ps | grep -q browser-mcp-mongodb; then
        echo "⚠️  MongoDB container not running. Cannot fetch macros."
        exit 0
    fi

    # Query macros for the new site
    MACRO_OUTPUT=$(docker exec browser-mcp-mongodb mongosh browser_mcp --quiet --eval "
        const siteDomain = '$NEW_DOMAIN';
        const siteMacros = db.macros.find({site: siteDomain}).sort({category: 1, name: 1}).toArray();
        const universalMacros = db.macros.find({site: '*'}).sort({category: 1, name: 1}).toArray();

        if (siteMacros.length > 0) {
            print('### Site-Specific Macros (' + siteMacros.length + ' available):');
            print('');
            siteMacros.forEach(m => {
                const params = Object.keys(m.parameters || {}).length;
                const reliability = m.reliability || 'untested';
                print('- **' + m.name + '** (' + m.category + ') [' + reliability + ']');
                print('  ' + m.description);
                if (params > 0) {
                    print('  Parameters: ' + params + ' (' + Object.keys(m.parameters).join(', ') + ')');
                }
                print('');
            });
        } else {
            print('ℹ️  No site-specific macros for \`' + siteDomain + '\`');
            print('');
        }

        if (universalMacros.length > 0 && siteMacros.length === 0) {
            print('### Universal Macros (' + universalMacros.length + ' available):');
            print('');
            universalMacros.forEach(m => {
                print('- **' + m.name + '** (' + m.category + ')');
                print('  ' + m.description);
                print('');
            });
        } else if (universalMacros.length > 0) {
            print('_(' + universalMacros.length + ' universal macros also available)_');
            print('');
        }
    " 2>&1)

    echo "$MACRO_OUTPUT"
    echo ""
    echo "💡 **Tip:** Use \`browser_execute_macro\` to run any of these macros"
    echo ""
fi

exit 0
