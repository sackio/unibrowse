FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skip prepare script)
RUN npm ci --only=production --ignore-scripts

# Copy pre-built application
COPY dist ./dist

# Copy the extension source so /install/extension.zip can package it on demand
COPY extension ./extension

# Expose WebSocket port
EXPOSE 9010

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9010/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start the server directly (environment variables come from docker-compose.yml)
CMD ["node", "dist/http-server.js"]
