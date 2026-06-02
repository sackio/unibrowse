FROM node:22-alpine

# Same chromium+Xvfb stack as the mcp-server today — sharing the apk install
# keeps the chromium binary version locked to one place. ffmpeg stays on
# mcp-server (only used post-process for recordings, which mcp-server owns).
RUN apk add --no-cache \
      chromium \
      nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont \
      font-noto-emoji \
      xvfb \
      tini

ENV CHROME_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Tiny RPC server — no MCP code at all, just spawn/track/kill.
COPY server.js ./server.js

EXPOSE 9020

# tini is PID 1 → forwards SIGTERM to node + reaps zombies. Same lifecycle
# guarantee mcp-server got today via init:true, here baked into the image.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
