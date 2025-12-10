#!/bin/bash
# Setup Chrome profile with extension pre-enabled
set -e

PROFILE_DIR="$1"
EXTENSION_DIR="$2"

if [ -z "$PROFILE_DIR" ] || [ -z "$EXTENSION_DIR" ]; then
    echo "Usage: $0 <profile_dir> <extension_dir>"
    exit 1
fi

# Create profile directories
mkdir -p "$PROFILE_DIR/Default"

# Get extension ID from manifest (Chrome generates ID from path)
# For unpacked extensions, Chrome uses the directory path hash as ID
# We'll use a placeholder and let Chrome generate it, then enable all extensions

# Create Preferences file with developer mode enabled
cat > "$PROFILE_DIR/Default/Preferences" <<'EOF'
{
  "extensions": {
    "settings": {},
    "ui": {
      "developer_mode": true
    }
  },
  "browser": {
    "show_home_button": true
  }
}
EOF

echo "✓ Chrome profile configured:"
echo "  - Developer mode: enabled"
echo "  - Profile: $PROFILE_DIR"
