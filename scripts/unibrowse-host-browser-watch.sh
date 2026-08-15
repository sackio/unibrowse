#!/usr/bin/env bash
# unibrowse-host-browser-watch — detect when the office host browser's extension
# has dropped, and get a human or an agent to click Reload.
#
# WHY THIS EXISTS
# ---------------
# Ben has had to hand-click Reload on chrome://extensions at least three times
# (08-12, 08-14, 08-15), and on 08-15 asked directly why it keeps happening and
# why it isn't fixed. The honest answer is that the root cause is still unknown:
# each earlier fix addressed something ADJACENT — a stale tab reservation, an
# extension-id rotation, an un-aimable reload tool — and a reload also cures all
# of those, so each looked like the fix from outside.
#
# This script does NOT fix the cause. It makes the recurrence somebody's problem
# other than Ben's, and it collects the evidence needed to eventually find the
# cause.
#
# ⛔ WHY IT ALERTS RATHER THAN REPAIRS
# ------------------------------------
# The repair is a click on Ben's physical desktop, driven through ui-eye. ui-eye
# has a co-driving guard that REFUSES to click while the operator is touching the
# keyboard or mouse — on 08-15 that guard blocked both unibrowse and ui-eye, and
# Ben ended up clicking it himself. That guard is correct and must not be
# bypassed: a script that fights the operator for the mouse is worse than a
# script that waits.
#
# So the automation splits:
#   this script  → detects, records, and RAISES (cheap, unattended, safe)
#   the agent    → performs the ui-eye click when the guard allows
# `agents` argued for exactly this split, on the grounds that a drop during an
# unattended host swap is not self-healing and not agent-healable either — so
# the alert is the load-bearing part, not the click.
#
# THE GATE
# --------
# Keyed on /extensions.hostBrowserPresent, which encodes the SAME condition
# claude-login-auto:resolve_host_browser gates on (an extension that is neither
# a container sidecar nor off-host). Keying on anything looser would let this
# report healthy for a browser the login would reject.
#
# ⛔ A present host browser is NECESSARY, NOT SUFFICIENT, for a working sign-in.
# The container sidecar requests a magic link happily — verified:true, no
# captcha — and then hangs on "Loading…" forever when consuming one. Anything
# that stops at "extension connected" passes on a browser that cannot sign in.
# This script therefore never claims the login works; it only claims a browser
# is attached.
#
# USAGE
#   unibrowse-host-browser-watch.sh          # check once, alert if down
#   unibrowse-host-browser-watch.sh --quiet  # only output on problems (cron)
#
# Install (office host crontab — deliberately NOT a session cron, which dies
# with the session, and NOT CronCreate durable:true, which silently registers
# session-only on this fleet):
#   */5 * * * * /mnt/nas/data/code/unibrowse/scripts/unibrowse-host-browser-watch.sh --quiet

set -uo pipefail

SERVER="${UNIBROWSE_SERVER:-http://localhost:9010}"
ATC="${ATC_URL:-http://192.168.1.168:3030}"
NOTIFY="${UNIBROWSE_WATCH_NOTIFY:-unibrowse}"
STATE="${UNIBROWSE_WATCH_STATE:-/tmp/unibrowse-host-browser-watch.state}"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

log() { [ "$QUIET" -eq 1 ] || echo "$@"; }

resp="$(curl -s -m 10 "$SERVER/extensions" 2>/dev/null)"

if [ -z "$resp" ]; then
  # ⚠️ Distinguish "server down" from "browser down". They need different
  # people and different fixes, and conflating them is how a reader ends up
  # reloading a browser to cure a dead container.
  echo "[watch] mcp-server unreachable at $SERVER — NOT a browser problem"
  # Only alert once per outage.
  if [ "$(cat "$STATE" 2>/dev/null)" != "server-down" ]; then
    curl -s -m 10 -X POST "$ATC/messages" -H 'Content-Type: application/json' \
      -d "{\"to\":\"$NOTIFY\",\"from\":\"unibrowse-watch\",\"priority\":\"warning\",\"subject\":\"mcp-server unreachable\",\"content\":\"GET $SERVER/extensions returned nothing. This is the SERVER, not the browser — do not go clicking Reload in Chrome. Check: docker compose ps mcp-server\"}" >/dev/null 2>&1
    echo "server-down" > "$STATE"
  fi
  exit 2
fi

present="$(printf '%s' "$resp" | grep -o '"hostBrowserPresent":[a-z]*' | cut -d: -f2)"

# ⚠️ THREE-STATE, NOT TWO. An older mcp-server has no /extensions route and
# answers 404 — a non-empty body in which the field simply does not appear.
# Parsing that as "not true" would report the browser DOWN whenever the server
# predates this endpoint, which is precisely the false alarm this script exists
# to prevent. Absence of the field is "cannot tell", never "no".
if [ "$present" != "true" ] && [ "$present" != "false" ]; then
  echo "[watch] /extensions did not report hostBrowserPresent — endpoint missing (server older than this script?). NOT concluding anything about the browser."
  if [ "$(cat "$STATE" 2>/dev/null)" != "no-endpoint" ]; then
    curl -s -m 10 -X POST "$ATC/messages" -H 'Content-Type: application/json' \
      -d "{\"to\":\"$NOTIFY\",\"from\":\"unibrowse-watch\",\"priority\":\"info\",\"subject\":\"watchdog cannot probe — /extensions missing\",\"content\":\"GET $SERVER/extensions answered but carried no hostBrowserPresent field. The running mcp-server predates that endpoint; deploy the build that adds it. Reporting NOTHING about browser health until then — this is 'cannot tell', not 'down'.\"}" >/dev/null 2>&1
    echo "no-endpoint" > "$STATE"
  fi
  exit 3
fi

if [ "$present" = "true" ]; then
  log "[watch] ok — host browser attached"
  [ "$(cat "$STATE" 2>/dev/null)" = "down" ] && log "[watch] recovered"
  echo "up" > "$STATE"
  exit 0
fi

# Host browser is MISSING. Pull the last disconnect so the alert carries the
# close code — 1000/1001 means Chrome closed it deliberately, 1006 means the
# socket vanished with no close frame. Those are different bugs, and until this
# endpoint existed we had never once known which we were looking at.
last="$(printf '%s' "$resp" | tr ',' '\n' | grep -E '"(code|kind|extensionId|connectedMs)"' | tail -8 | tr '\n' ' ')"
chrome_running="no"
pgrep -f -- '--extension-process' >/dev/null 2>&1 && chrome_running="yes"

echo "[watch] HOST BROWSER MISSING. chrome_running=$chrome_running last_disconnect: $last"

# Alert once per outage, not every five minutes.
if [ "$(cat "$STATE" 2>/dev/null)" != "down" ]; then
  curl -s -m 10 -X POST "$ATC/messages" -H 'Content-Type: application/json' \
    -d "$(cat <<JSON
{"to":"$NOTIFY","from":"unibrowse-watch","priority":"warning",
 "subject":"Host browser extension is DOWN on office",
 "content":"No non-sidecar, non-lan-remote extension is connected, so claude-login-auto:resolve_host_browser will fail.\n\nChrome process running: $chrome_running\nLast disconnect: $last\n\nIf Chrome is running, the BROWSER is fine and the EXTENSION dropped — opening Chrome changes nothing and browser_reload_extension cannot revive a socket that is already gone. The repair is a click on the blue Reload on the unibrowse card at chrome://extensions.\n\nAgent path: ui_eye_click host=office x=6509 y=1603 expect_window='Extensions - Google Chrome' (re-screenshot first; coords drift if the window moved). ui-eye REFUSES to click while Ben is at the keyboard — that guard is correct, wait it out or ask him.\n\nEvidence for the still-unknown root cause: curl $SERVER/extensions | jq .recentDisconnects"}
JSON
)" >/dev/null 2>&1
  echo "down" > "$STATE"
fi

exit 1
