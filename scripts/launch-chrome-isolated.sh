#!/bin/bash
# Launch Chrome in isolated mode with unibrowse extension
# This script launches a separate Chrome instance with the extension pre-loaded
# Profile data is stored in .chrome-profiles/ directory

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
EXTENSION_DIR="$PROJECT_ROOT/extension"
PROFILES_DIR="$PROJECT_ROOT/.chrome-profiles"
PROFILE_NAME="${PROFILE_NAME:-unibrowse-test}"
PROFILE_DIR="$PROFILES_DIR/$PROFILE_NAME"

# Find Chrome executable
find_chrome() {
    local chrome_paths=(
        "/usr/bin/google-chrome"
        "/usr/bin/google-chrome-stable"
        "/usr/bin/chromium-browser"
        "/usr/bin/chromium"
        "/opt/google/chrome/chrome"
    )

    for path in "${chrome_paths[@]}"; do
        if [ -f "$path" ]; then
            echo "$path"
            return 0
        fi
    done

    # Try which command
    if command -v google-chrome &> /dev/null; then
        which google-chrome
        return 0
    elif command -v chromium-browser &> /dev/null; then
        which chromium-browser
        return 0
    fi

    return 1
}

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  unibrowse - Isolated Chrome Launcher${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo

# Check if extension directory exists
if [ ! -d "$EXTENSION_DIR" ]; then
    echo -e "${YELLOW}✗ Extension directory not found: $EXTENSION_DIR${NC}"
    exit 1
fi

# Find Chrome
CHROME_BIN=$(find_chrome)
if [ -z "$CHROME_BIN" ]; then
    echo -e "${YELLOW}✗ Chrome/Chromium not found. Please install Chrome or Chromium.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found Chrome at: $CHROME_BIN${NC}"

# Create profiles directory
mkdir -p "$PROFILES_DIR"

# Check for fresh profile flag (default: yes)
FRESH_PROFILE="${FRESH_PROFILE:-yes}"
if [ "$FRESH_PROFILE" = "yes" ] && [ -d "$PROFILE_DIR" ]; then
    echo -e "${YELLOW}→ Removing existing profile for fresh start...${NC}"
    rm -rf "$PROFILE_DIR"
fi

# Create profile directory
mkdir -p "$PROFILE_DIR"

# Determine URLs to open
URLS="${CHROME_URL:-chrome://extensions/}"

echo
echo -e "${BLUE}Configuration:${NC}"
echo -e "  Profile: ${GREEN}$PROFILE_NAME${NC}"
echo -e "  Profile Directory: ${GREEN}$PROFILE_DIR${NC}"
echo -e "  Extension: ${GREEN}$EXTENSION_DIR${NC}"
echo -e "  URLs: ${GREEN}$URLS${NC}"
echo -e "  Fresh Profile: ${GREEN}$FRESH_PROFILE${NC}"
echo

# Launch Chrome with extension
echo -e "${BLUE}→ Launching Chrome...${NC}"

# Set DISPLAY if not already set (for X11)
# Default to :1 as that's the typical display for the office server
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:1
fi

"$CHROME_BIN" \
    --user-data-dir="$PROFILE_DIR" \
    --load-extension="$EXTENSION_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --disable-sync \
    --disable-features=TranslateUI \
    --disable-default-apps \
    $URLS &

CHROME_PID=$!

echo -e "${GREEN}✓ Chrome launched successfully!${NC}"
echo -e "  PID: ${GREEN}$CHROME_PID${NC}"
echo
echo -e "${YELLOW}IMPORTANT:${NC}"
echo -e "  1. Chrome should open with the unibrowse extension loaded"
echo -e "  2. Click the ${BLUE}unibrowse extension icon${NC} in the toolbar"
echo -e "  3. Click ${GREEN}\"Connect\"${NC} to connect to ws://localhost:9010/ws"
echo -e "  4. The extension will auto-connect, but manual connection ensures stability"
echo
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
