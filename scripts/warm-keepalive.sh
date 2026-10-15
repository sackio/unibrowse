#!/usr/bin/env bash
# Keep the warm sessions warm — visit each logged-in site on a slow cycle so the
# cookies are refreshed by the sites themselves rather than aging out.
#
# ⛔ NOT WIRED IN BY DEFAULT, deliberately. This drives a browser holding Ben's
# saved cards with nobody watching, so turning it on is his call, not a default.
# To run it:  ssh -p 4999 ben@192.168.0.103 \
#               'nohup docker exec unibrowse-warm sh -c "..." &'   -- or add it
# to the `warm` service's command. Either way say so in #unibrowse first.
#
# ⭐ IT ONLY EVER NAVIGATES. No clicking, no forms, no checkout — a keepalive
# that can press a button is a keepalive that can buy something.
#
# ⛔ IT YIELDS TO A HUMAN OR AN AGENT DRIVING. warmlogin.sh and this script
# share one lock file; a cycle that cannot take the lock is SKIPPED, not
# queued, because a navigation landing mid-login is worse than a missed cycle.
set -euo pipefail

W="${WARMLOGIN:-/mnt/nas/data/code/unibrowse/scripts/warmlogin.sh}"
LOCK="${WARM_LOCK:-/tmp/warm-drive.lock}"
EVERY="${WARM_KEEPALIVE_SECONDS:-21600}"   # 6h
SITES="${WARM_SITES:-https://www.amazon.com/ https://www.ebay.com/ https://www.doordash.com/}"

while :; do
  if mkdir "$LOCK" 2>/dev/null; then
    trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
    for url in $SITES; do
      bash "$W" go "$url" >/dev/null 2>&1 || true
      sleep 25
    done
    rmdir "$LOCK" 2>/dev/null || true
    trap - EXIT
    echo "[warm-keepalive] cycle done $(date -Is)"
  else
    echo "[warm-keepalive] skipped — something else is driving $(date -Is)"
  fi
  sleep "$EVERY"
done
