#!/usr/bin/env bash
# Keep the warm sessions warm. ⭐ RUNS INSIDE THE unibrowse-warm CONTAINER, as
# its main command — so it restarts with the container and needs no host state,
# no cron, and no docker socket. Ben authorised it, Slack #unibrowse
# 2026-10-15: "yes I definitely want to keep alive".
#
# It does two jobs:
#   1. brings Chrome up if no window is on the display — which makes a container
#      restart self-healing instead of leaving a dark rig that LOOKS fine;
#   2. visits each logged-in site on a slow cycle, so the sites themselves
#      refresh the cookies rather than letting them age out.
#
# ⚠️ WHAT A CYCLE CAN AND CANNOT DO ON AMAZON, measured 2026-10-15: amazon.com
# serves an "unauthorized AI agent" interstitial with a Continue button on a
# cold load, and this script does not press buttons — so an Amazon cycle stops
# at the notice rather than reaching the account. What actually holds that
# session is "Keep me signed in" on the sign-in form, which was NOT ticked at
# the first login and is why the session lapsed within the hour. ⇒ Do not
# "fix" this by letting the keepalive click: tick the box at login instead.
#
# ⛔ IT ONLY EVER NAVIGATES. No clicking, no forms, no checkout. A keepalive
# that can press a button is a keepalive that can buy something, and this
# browser holds Ben's saved cards.
#
# ⛔ IT YIELDS TO A HUMAN OR AN AGENT DRIVING, through a lock directory in this
# container's /tmp that scripts/warmlogin.sh takes over `docker exec`. A cycle
# that cannot take the lock is SKIPPED, never queued: a navigation landing in
# the middle of a half-typed password is worse than a missed cycle.
# ⚠️ The lock MUST live in the container, not the host — warmlogin.sh runs on
# the host and this runs inside, and two /tmp directories that look identical in
# a script are not the same directory.
set -uo pipefail

OSDRIVE="${OSDRIVE_BIN:-/usr/local/bin/osdrive.sh}"
PROFILE="${WARM_PROFILE:-warm-shopping}"
LOCK="${WARM_LOCK:-/tmp/warm-drive.lock}"
EVERY="${WARM_KEEPALIVE_SECONDS:-21600}"    # 6h
FIRST_DELAY="${WARM_FIRST_DELAY:-300}"      # let a human finish logging in
# ⚠️ amazon.com serves an "unauthorized AI agent" interstitial (measured
# 2026-10-15). Ben ruled on it the same day — accessibility tool, his account,
# his direction, non-abusive — so it stays in the list. Full quote and the
# limits that still apply: docker-compose.yml, the `warm` service.
SITES="${WARM_SITES:-https://www.amazon.com/ https://www.ebay.com/ https://www.doordash.com/}"
export DISPLAY="${OSDRIVE_DISPLAY:-:98}"

log() { echo "[warm-keepalive] $(date -Is) $*"; }

have_window() { xdotool search --onlyvisible --class chrome >/dev/null 2>&1; }

ensure_chrome() {
  have_window && return 0
  log "no Chrome window — starting it"
  bash "$OSDRIVE" up "$PROFILE" "${WARM_HOME_URL:-https://www.amazon.com/}" >/dev/null 2>&1 || true
  sleep 10
  have_window && log "Chrome is up" || log "⛔ Chrome did not start — read /tmp/osdrive-chrome.log"
}

# ⭐ Chrome comes up IMMEDIATELY on boot, before the first-cycle delay. Waiting
# would leave the rig dark for FIRST_DELAY after every container restart, and a
# dark rig answers "is it running?" with yes.
ensure_chrome
sleep "$FIRST_DELAY"
while :; do
  if mkdir "$LOCK" 2>/dev/null; then
    ensure_chrome
    for url in $SITES; do
      bash "$OSDRIVE" key ctrl+l   >/dev/null 2>&1; sleep 0.4
      bash "$OSDRIVE" type "$url" 30 >/dev/null 2>&1; sleep 0.3
      bash "$OSDRIVE" key Return   >/dev/null 2>&1
      sleep 25
    done
    rmdir "$LOCK" 2>/dev/null
    log "cycle done"
  else
    log "skipped — something else holds $LOCK"
  fi
  sleep "$EVERY"
done
