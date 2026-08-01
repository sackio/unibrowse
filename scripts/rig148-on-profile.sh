#!/bin/bash
# rig148-on-profile.sh — launch chromium 148 against an EXISTING profile.
#
# Purpose: A/B a chromium version against the *same* profile, so warmth is held
# constant and the browser version is the only variable. Built 2026-08-01 for
# the OAuth-consent regression (macro 61e05dfb worked on 148, failed on 149).
#
# 148 comes from the frozen `unibrowse-mcp-server` image (built 2026-07-12),
# which still carries chromium 148.0.7778.178. Nothing is rebuilt, so the
# reference version cannot drift while we are using it as a reference.
#
# ⚠️ SAFETY INTERLOCK — this REFUSES to launch if anything already holds the
# target profile. Two chromiums sharing one --user-data-dir collide on
# SingletonLock and the second comes up DEGRADED: its extension never
# registers, surfacing as `extensionId: None` (diagnosed 2026-06-11). That is
# the worst possible failure here — a corrupted arm that still returns a
# result, which you would then attribute to the browser version.
#
# Usage:  ./scripts/rig148-on-profile.sh <profileName>
#         ./scripts/rig148-on-profile.sh swap-ben
set -euo pipefail

PROFILE="${1:?usage: rig148-on-profile.sh <profileName>}"
REPO=/mnt/nas/data/code/unibrowse
NET=unibrowse_unibrowse-network
IMAGE=unibrowse-mcp-server           # frozen 07-12 image == chromium 148
CONTAINER=unibrowse-rig148
DISPLAY_NUM=:95
WS='ws://mcp-server:9010/ws'
SEED='http://mcp-server:9010/__unibrowse_seed?ws=ws%3A%2F%2Fmcp-server%3A9010%2Fws&http=http%3A%2F%2Fmcp-server%3A9010'

echo "=== INTERLOCK: is anything holding profile '$PROFILE'? ==="

# (1) sidecar-tracked instances
TRACKED=$(docker compose -f "$REPO/docker-compose.yml" exec -T chromium-host node -e '
const http=require("http");
http.get({host:"127.0.0.1",port:9020,path:"/processes"},r=>{let d="";r.on("data",c=>d+=c);
r.on("end",()=>{try{const p=JSON.parse(d).processes.filter(x=>x.profileName===process.argv[1]);
console.log(p.length?p.map(x=>x.pid).join(","):"");}catch(e){console.log("");}});})
.on("error",()=>console.log(""));' "$PROFILE" 2>/dev/null | tail -1 | tr -d '[:space:]')

# (2) raw ps inside the sidecar — catches chromiums that outlived its tracking.
# ⚠️ MUST be `ps -o pid,args`, NOT `ps -eww -o pid=,args=`. The container is
# busybox: it rejects `-w` outright ("ps: unrecognized option: w"), so the
# -eww form errors and yields ZERO matches — a check that always passes.
# Verified 2026-08-01: with a chromium provably holding ecobee-broker, the
# -eww form reported 0 and this form reports 11.
RAW=$(docker compose -f "$REPO/docker-compose.yml" exec -T chromium-host sh -c \
  "ps -o pid,args 2>/dev/null | grep -F -- '--user-data-dir=/app/.chrome-profiles/$PROFILE' | grep -v grep | grep -vE '\-\-type=(zygote|gpu-process|utility|renderer)' | wc -l" \
  2>/dev/null | tail -1 | tr -d '[:space:]')

if [ -n "$TRACKED" ] || [ "${RAW:-0}" != "0" ]; then
  echo "⛔ REFUSING TO LAUNCH."
  echo "   sidecar-tracked pids: ${TRACKED:-none}   raw main-process matches: ${RAW:-0}"
  echo "   Stop the existing instance FIRST (browser_close_isolated_chrome, or"
  echo "   DELETE /processes/<pid> on the sidecar), then re-run."
  echo "   Concurrent use of one profile dir yields a DEGRADED arm that still"
  echo "   returns a result — worse than no result at all."
  exit 1
fi
echo "   clear — nothing holds it."

echo "=== replacing any previous rig container ==="
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "=== launching chromium 148 on profile '$PROFILE' ==="
docker run -d --name "$CONTAINER" --network "$NET" \
  -v "$REPO/extension:/app/extension:ro" \
  -v "$REPO/chrome-profiles:/app/.chrome-profiles" \
  "$IMAGE" \
  sh -c "Xvfb $DISPLAY_NUM -screen 0 1280x1024x24 -nolisten tcp & sleep 2; \
         DISPLAY=$DISPLAY_NUM /usr/bin/chromium-browser \
         --user-data-dir=/app/.chrome-profiles/$PROFILE \
         --load-extension=/app/extension \
         --no-sandbox --disable-dev-shm-usage --no-first-run \
         --no-default-browser-check --disable-sync '$SEED'" >/dev/null

sleep 12
echo "=== version actually running (evidence, not intent) ==="
docker exec "$CONTAINER" /usr/bin/chromium-browser --version
echo "=== container ==="
docker ps --filter "name=$CONTAINER" --format '{{.Names}} {{.Status}}'
echo
echo "NEXT: find its extensionId via the newest registration in mcp-server logs,"
echo "      then CONFIRM by asking the page itself:"
echo "        browser_evaluate({extensionId:<id>, expression:'navigator.userAgent'})"
echo "      Never identify the arm by registration order alone."
