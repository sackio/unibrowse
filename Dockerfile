FROM node:22-alpine

# ffmpeg: video-frame extraction for recording screenshots
# chromium + supporting libs: lets browser_launch_isolated_chrome spawn
#   a true headless Chrome inside the container (host's Chrome can't run
#   here because it's glibc-linked and we're on musl). The launcher picks
#   /usr/bin/chromium-browser automatically.
RUN apk add --no-cache \
      ffmpeg \
      chromium \
      nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont \
      font-noto-emoji \
      xvfb

# Tell the launcher (and anything else that honors this) where Chrome lives,
# and skip any Puppeteer self-download — the apk install gave us the binary.
ENV CHROME_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=true

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
