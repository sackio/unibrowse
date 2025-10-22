FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skip prepare script)
RUN npm ci --only=production --ignore-scripts

# Copy pre-built application
COPY dist ./dist

# Expose WebSocket port
EXPOSE 9010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9010/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start the server directly (environment variables come from docker-compose.yml)
CMD ["node", "dist/http-server.js"]
