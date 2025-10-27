#!/bin/bash

# Browser MCP Service Management Script
# Provides easy commands to manage the WebSocket/HTTP server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="browser-mcp"
SERVICE_FILE="$SCRIPT_DIR/browser-mcp.service"

show_usage() {
    cat << EOF
Browser MCP Service Manager

USAGE:
    ./service.sh <command>

COMMANDS:
    dev         Start in development mode with hot reload (nodemon)
    start       Start using PM2 (recommended for always-on)
    stop        Stop PM2 service
    restart     Restart PM2 service
    logs        Show PM2 logs (live tail)
    status      Show service status

    systemd-install    Install systemd service (requires sudo)
    systemd-start      Start systemd service
    systemd-stop       Stop systemd service
    systemd-status     Check systemd service status
    systemd-logs       Show systemd logs

EXAMPLES:
    # Development with hot reload
    ./service.sh dev

    # Production with PM2 (recommended)
    ./service.sh start
    ./service.sh logs

    # Production with systemd
    ./service.sh systemd-install
    ./service.sh systemd-start

EOF
}

case "$1" in
    dev)
        echo "🔧 Starting in development mode with hot reload..."
        npm run dev:http
        ;;

    start)
        echo "🚀 Starting Browser MCP with PM2..."
        if ! command -v pm2 &> /dev/null; then
            echo "❌ PM2 not installed. Install with: npm install -g pm2"
            exit 1
        fi
        pm2 start ecosystem.config.js
        echo "✅ Service started. View logs: ./service.sh logs"
        ;;

    stop)
        echo "🛑 Stopping Browser MCP..."
        pm2 stop browser-mcp
        ;;

    restart)
        echo "🔄 Restarting Browser MCP..."
        pm2 restart browser-mcp
        ;;

    logs)
        echo "📋 Showing logs (Ctrl+C to exit)..."
        pm2 logs browser-mcp
        ;;

    status)
        if command -v pm2 &> /dev/null; then
            echo "📊 PM2 Status:"
            pm2 list | grep browser-mcp || echo "Not running with PM2"
        fi
        echo ""
        echo "📊 Systemd Status:"
        systemctl --user is-active browser-mcp.service 2>/dev/null || echo "Not running with systemd"
        ;;

    systemd-install)
        echo "📦 Installing systemd service..."
        mkdir -p ~/.config/systemd/user
        cp "$SERVICE_FILE" ~/.config/systemd/user/
        systemctl --user daemon-reload
        systemctl --user enable browser-mcp.service
        echo "✅ Systemd service installed"
        echo "   Start with: ./service.sh systemd-start"
        ;;

    systemd-start)
        echo "🚀 Starting systemd service..."
        systemctl --user start browser-mcp.service
        echo "✅ Service started"
        ;;

    systemd-stop)
        echo "🛑 Stopping systemd service..."
        systemctl --user stop browser-mcp.service
        ;;

    systemd-status)
        systemctl --user status browser-mcp.service
        ;;

    systemd-logs)
        journalctl --user -u browser-mcp.service -f
        ;;

    *)
        show_usage
        exit 1
        ;;
esac
