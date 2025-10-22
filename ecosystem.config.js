// PM2 Configuration for Browser MCP
// Alternative to systemd for managing the server process
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 logs browser-mcp
//   pm2 restart browser-mcp
//   pm2 stop browser-mcp
//   pm2 startup  # Auto-start on boot

module.exports = {
  apps: [{
    name: 'browser-mcp',
    script: './dist/http-server.js',
    cwd: '/home/ben/code/forks/browser-mcp',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    node_args: '--env-file=.env',
    env: {
      NODE_ENV: 'production'
    },
    env_development: {
      NODE_ENV: 'development'
    },
    error_file: '/home/ben/code/forks/browser-mcp/logs/error.log',
    out_file: '/home/ben/code/forks/browser-mcp/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000
  }]
};
