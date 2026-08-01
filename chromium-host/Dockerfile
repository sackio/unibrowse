# ⚠️ BOTH of these are pinned deliberately. Read before changing either.
#
# This image previously used `FROM node:22-alpine` + `apk add --no-cache
# chromium`, i.e. NOTHING pinned — so the browser version changed silently on
# every rebuild, with no commit and no record anywhere in git. That cost us
# three weeks: the OAuth consent macro worked end-to-end on 2026-07-14 (chromium
# 148), a rebuild around 07-20 silently moved it to 149, and on 08-01 the macro
# failed 6/6 with nobody able to say what had changed. It was only diagnosable
# by luck — a frozen 07-12 mcp-server image happened to still carry 148, giving
# us a reference point. That luck is not repeatable.
#
# The browser is a DEPENDENCY of an automation surface: its version is part of
# the contract and belongs in git like any other. Unpinned, every rebuild is an
# uncontrolled experiment and no future breakage is diagnosable.
#
# The base image is pinned too, and must be: it determines which chromium the
# apk repo even offers, so pinning the package alone is insufficient.
#
# To change versions: bump the ARG, rebuild, and say so in the commit message.
# If the pinned package disappears from the repo the build FAILS LOUDLY — that
# is the intended behaviour and is strictly better than drifting silently.
ARG NODE_BASE=node:22-alpine3.24
FROM ${NODE_BASE}

# chromium 150.0.7871.181-r0 — current as of 2026-08-01 (alpine 3.24.1).
# NOT yet vindicated: whether 150 completes the OAuth grant is under test.
# If it does not, change this deliberately rather than by rebuilding.
ARG CHROMIUM_VERSION=150.0.7871.181-r0

# Same chromium+Xvfb stack as the mcp-server today — sharing the apk install
# keeps the chromium binary version locked to one place. ffmpeg stays on
# mcp-server (only used post-process for recordings, which mcp-server owns).
RUN apk add --no-cache \
      chromium=${CHROMIUM_VERSION} \
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
