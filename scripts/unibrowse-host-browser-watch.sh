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
# ⚠️ COMMA-SEPARATED, AND `agents` MUST STAY IN IT. Until 2026-08-16 this alerted
# only `unibrowse`. That is a single point of failure with no redundancy: on
# 2026-08-16 the extension dropped at 20:57, this script detected it correctly and
# alerted on schedule — into a session that was mid-compaction. Nobody saw it, and
# the outage was discovered 21 minutes later by Ben's `!login` failing, which is
# exactly the outcome the script exists to prevent. Detection was never the gap;
# single-recipient delivery was. `agents` owns the login flow and is the seat that
# can act on this without Ben in the loop.
# `-` not `:-` deliberately: an explicitly EMPTY UNIBROWSE_WATCH_NOTIFY means
# "send nothing", which is what you want when exercising this script by hand.
# With `:-` an empty value silently fell back to the default and every dry run
# DM'd real recipients.
NOTIFY="${UNIBROWSE_WATCH_NOTIFY-unibrowse,agents}"
STATE="${UNIBROWSE_WATCH_STATE:-/tmp/unibrowse-host-browser-watch.state}"
RELOADER="${UNIBROWSE_RELOADER:-/mnt/nas/data/code/unibrowse/scripts/unibrowse-extension-reload.mjs}"
CDP_PORT="${UNIBROWSE_CDP_PORT:-9222}"
EXT_PATH="${UNIBROWSE_EXT_PATH:-/mnt/nas/data/code/unibrowse/extension}"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

log() { [ "$QUIET" -eq 1 ] || echo "$@"; }

# notify <priority> <subject> <content>
#
# Fans out to every recipient in $NOTIFY. Builds the JSON in python3 rather than
# by hand: the content carries newlines, quotes and shell-expanded values, and a
# hand-built body silently produces a malformed request that the broker rejects
# with a 4xx nobody reads — an alert that was never delivered is indistinguishable
# from an outage that never happened.
notify() {
  local pri="$1" subj="$2" body="$3" who payload
  local IFS=,
  for who in $NOTIFY; do
    [ -n "$who" ] || continue
    payload="$(PRI="$pri" SUBJ="$subj" BODY="$body" WHO="$who" python3 -c 'import json,os; print(json.dumps({"to":os.environ["WHO"],"from":"unibrowse-watch","priority":os.environ["PRI"],"subject":os.environ["SUBJ"],"content":os.environ["BODY"]}))')" || continue
    curl -s -m 10 -X POST "$ATC/messages" -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1
  done
}

resp="$(curl -s -m 10 "$SERVER/extensions" 2>/dev/null)"

if [ -z "$resp" ]; then
  # ⚠️ Distinguish "server down" from "browser down". They need different
  # people and different fixes, and conflating them is how a reader ends up
  # reloading a browser to cure a dead container.
  echo "[watch] mcp-server unreachable at $SERVER — NOT a browser problem"
  # Only alert once per outage.
  if [ "$(cat "$STATE" 2>/dev/null)" != "server-down" ]; then
    notify warning "mcp-server unreachable" \
      "GET $SERVER/extensions returned nothing. This is the SERVER, not the browser — do not go clicking Reload in Chrome. Check: docker compose ps mcp-server"
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
    notify info "watchdog cannot probe — /extensions missing" \
      "GET $SERVER/extensions answered but carried no hostBrowserPresent field. The running mcp-server predates that endpoint; deploy the build that adds it. Reporting NOTHING about browser health until then — this is 'cannot tell', not 'down'."
    echo "no-endpoint" > "$STATE"
  fi
  exit 3
fi

if [ "$present" = "true" ]; then
  log "[watch] ok — host browser attached"
  # Announce RECOVERY to everyone who got the outage alert. Without this the
  # alert is a dead end: whoever was told "down" has no way to learn it came back
  # except by re-probing, and on 2026-08-16 that closing message had to be sent by
  # hand. `down*` matches both the current `down:<epoch>` form and the bare `down`
  # written by versions of this script before 2026-08-16.
  case "$(cat "$STATE" 2>/dev/null || true)" in
    down*)
      log "[watch] recovered"
      # ⚠️ Build the roster in its own step with a QUOTED heredoc. The first
      # version inlined `python3 -c '…'` inside a $( ) inside a double-quoted
      # argument; bash ate the escaped quotes in the f-string and the section
      # arrived EMPTY in the delivered message while the script still exited 0.
      # A formatting bug in an alert body is invisible from the sending side —
      # read one delivered message before believing any of this works.
      conn_summary="$(curl -s -m 10 "$SERVER/extensions" 2>/dev/null | python3 -c "$(cat <<'PY'
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("(could not parse /extensions)")
    raise SystemExit
print("Connected now:")
for c in d.get("connected", []):
    up = round(c.get("connectedForMs", 0) / 60000)
    print("  %s  kind=%s  tabs=%s  up=%smin" % (
        c.get("extensionId"), c.get("kind"), c.get("tabCount"), up))
PY
)" 2>/dev/null)"
      [ -n "$conn_summary" ] || conn_summary="(roster unavailable)"

      notify info "host browser is BACK on office" \
"A browser we own is registered again and !login can proceed.

⚠️ This says a browser is ATTACHED, never that sign-in works — the container sidecar requests magic links happily and then hangs forever consuming one. Confirm with an actual round-trip (browser_get_version pinned to the extensionId) before telling anyone it is fixed.

$conn_summary"
      ;;
  esac
  echo "up" > "$STATE"
  exit 0
fi

# Host browser is MISSING. Pull the last disconnect so the alert carries the
# close code — 1000/1001 means Chrome closed it deliberately, 1006 means the
# socket vanished with no close frame. Those are different bugs, and until this
# endpoint existed we had never once known which we were looking at.
#
# ⚠️ Parse it properly. The first version split the JSON on commas and grepped
# the fragments, which produced an unreadable smear with the timestamp dropped —
# and the timestamp is the field that tells you WHEN to look in the heartbeat.
last="$(printf '%s' "$resp" | python3 -c "$(cat <<'PY'
import sys, json, datetime
try:
    d = json.load(sys.stdin)
except Exception:
    print("(could not parse /extensions)")
    raise SystemExit
rows = d.get("recentDisconnects") or []
if not rows:
    print("(none recorded)")
    raise SystemExit
c = rows[-1]
at = c.get("at")
when = datetime.datetime.fromtimestamp(at / 1000).strftime("%Y-%m-%d %H:%M:%S") if at else "unknown time"
print("%s  ext=%s  kind=%s  close_code=%s  had_been_connected=%smin" % (
    when, c.get("extensionId"), c.get("kind"), c.get("code"),
    round(c.get("connectedMs", 0) / 60000)))
PY
)" 2>/dev/null)"
[ -n "$last" ] || last="(unavailable)"

# ⚠️ MUST match the HOST Chrome specifically. `pgrep -f -- '--extension-process'`
# also matches the CONTAINER chromium — the host process table lists a
# container's processes too — so it reported "Chrome is running" on a host where
# only the sidecar was alive, which points the reader at a UI repair for a
# browser that is not there. Key on the real binary path plus ben's profile.
chrome_running="no"
pgrep -f -- '^/opt/google/chrome/chrome' >/dev/null 2>&1 && chrome_running="yes"

echo "[watch] HOST BROWSER MISSING. chrome_running=$chrome_running last_disconnect: $last"

# ── SELF-HEAL, before bothering anybody ──────────────────────────────────────
# Reload the extension over CDP. This is the whole point of adding
# --remote-debugging-port to Chrome's launch: nothing INSIDE the extension can
# revive it (the worker is what died, and Chrome only starts a worker to deliver
# it an event), and the ui-eye click path refuses to run while Ben is at the
# keyboard. CDP has neither constraint.
#
# ⚠️ Only meaningful once Chrome has been RESTARTED with the flag — it takes
# effect at browser-process startup and cannot be toggled live. Until then this
# exits 3 and we fall through to alerting, which is the correct behaviour, not
# a failure.
if [ -x "$RELOADER" ] || [ -f "$RELOADER" ]; then
  echo "[watch] attempting CDP reload…"
  if node "$RELOADER" --port "$CDP_PORT" --path "$EXT_PATH"; then
    # ⚠️ Trust the SERVER, not the reloader's own exit code. The reloader can
    # only see that a worker started; whether it then reconnected to
    # mcp-server is a different claim, and that is the one that matters.
    sleep 6
    recheck="$(curl -s -m 10 "$SERVER/extensions" 2>/dev/null | grep -o '"hostBrowserPresent":[a-z]*' | cut -d: -f2)"
    if [ "$recheck" = "true" ]; then
      echo "[watch] SELF-HEALED via CDP — host browser reconnected"
      notify info "host browser self-healed" \
        "The extension had dropped and was revived over CDP without anyone clicking. Last disconnect: $last"
      echo "up" > "$STATE"
      exit 0
    fi
    echo "[watch] CDP reload ran but the extension still has not reconnected — escalating"
  else
    echo "[watch] CDP reload unavailable or failed (exit $?) — escalating"
  fi
fi

# Alert on the first tick of an outage, then RE-ALERT every 30 minutes while it
# lasts.
#
# ⚠️ It used to alert exactly once per outage and never again. That is only
# correct if the first alert is guaranteed to be read, and on 2026-08-16 it was
# not — the one alert landed in a compacting session and the outage ran 31 min
# until Ben tripped over it. One missed message must not equal permanent silence
# on a service four hosts depend on. 30 min is chosen to be noisy enough to
# survive a missed read and quiet enough not to become the thing people filter.
#
# ⚠️ AND REQUIRE TWO CONSECUTIVE FAILED POLLS BEFORE THE FIRST ALERT. A single
# missing reading is not an outage: on 2026-08-16 a deliberate
# browser_reload_extension dropped the socket for ONE SECOND and the next poll
# paged about it, after the extension had already recovered. A false page on a
# self-healing blip is worse than 5 minutes of extra latency on a real outage —
# and the real one that night lasted 31 minutes, so confirming costs almost
# nothing against it. The CDP self-heal above still runs on the FIRST failure;
# only the alerting waits for confirmation.
prev="$(cat "$STATE" 2>/dev/null || true)"
now="$(date +%s)"
since="${prev#down:}"
case "$prev" in
  down:*)
    # Already alerted. Re-alert only every 30 min.
    [ $(( now - since )) -ge 1800 ] && do_alert=1 || do_alert=0
    ;;
  pending:*)
    # Second consecutive failure — this is a real outage. Alert.
    do_alert=1
    ;;
  *)
    # First failure. Record it and say nothing yet.
    echo "[watch] host browser missing on ONE poll — waiting for a second reading before alerting (see 'up' again and this is dropped silently)"
    echo "pending:$now" > "$STATE"
    exit 1
    ;;
esac

if [ "$do_alert" -eq 1 ]; then
  notify warning "Host browser extension is DOWN on office" \
"No browser we own is connected (container sidecar and lan-remote do not count), so claude-login-auto:resolve_host_browser will fail and every !login returns 0 hosts.

Chrome process running: $chrome_running
Last disconnect: $last

If Chrome is running, the BROWSER is fine and the EXTENSION's socket dropped. Opening Chrome changes nothing, and browser_reload_extension cannot help — it travels over the socket that is already gone. The repair is the Reload control on the unibrowse card at chrome://extensions.

⛔ MEASURED ON OFFICE 2026-08-16, BEFORE YOU PLAN A UI REPAIR:
· There is NO WORKING KEYBOARD PATH to that Chrome. ui_eye_type fails with AttributeError: keycode_to_keysym_list; xdotool key/type exits 0 and delivers nothing (verified by screenshot, X session is genuinely x11 with XTEST present). Anything that types a URL will fail, and xdotool fails SILENTLY.
· chrome://extensions therefore cannot be reached by typing, and NOT from the command line either — google-chrome 'chrome://extensions/' reports 'Opening in existing browser session' and then opens a plain New Tab, because Chrome blocks chrome:// from argv. Route: click the puzzle-piece Extensions toolbar icon, then 'Manage extensions'.
· Prefer ui_eye_press (AT-SPI) over ui_eye_click (coordinates). If XTEST keyboard does not reach Chrome, XTEST mouse is suspect for the same reason, and a coordinate click that lands nowhere still returns success.
· ui-eye refuses to act while the operator is touching the keyboard. Check the real idle time (xprintidle) before believing that guard — automation input resets it too, so a refusal may be the last agent's residue rather than Ben.

⭐ READ THE KEEPALIVE HEARTBEAT — THIS IS THE DIAGNOSTIC, AND IT WORKS WHILE THE EXTENSION IS DEAD. Run ON THE OFFICE HOST as ben:
  D=\"\$HOME/.config/google-chrome/Profile 1/Local Extension Settings/pikjoohganfooeancifkoccakcocchmk\"
  strings \"\$D\"/*.log | grep -o '\\[{\"at\".*' | tail -1
⚠️ Grep for the VALUE (\`[{\"at\"\`), NOT the key: leveldb stores key and value as separate strings, so \`grep swHeartbeat\` prints the word 'swHeartbeat' and nothing else once the ring grows. Trim to the last '}' before parsing — the tail is usually a partial record.
⚠️ \"Profile 1\", NOT \"Default\". The subdirectory is Chrome's own extension id, not the ext_… handle. \`at\` is epoch ms in scientific notation (1.7e+12) — float parse, not int.

WHAT THE RECORD MEANS. The sw-keepalive alarm fires every 30s and is supposed to force a reconnect whenever the socket is dead, so an outage lasting minutes means recovery ran and failed, not that nothing tried:
  · 'enter' with no matching 'probed'            → the handler HUNG (leaves no trace anywhere else)
  · 'threw'                                       → it errored (Chrome swallows async listener throws silently)
  · 'probed' wsLive:false repeating, no 'reconnected' → autoConnect is failing
  · no records at all across the dead window      → the alarm genuinely stopped firing
⚠️ This tells you WHICH path failed, not why it failed identically N times. One dead tick and sixty dead ticks have different explanations and the record distinguishes the second only by repetition — count them.

Evidence on the server side, FROM THE OFFICE HOST (\$SERVER here was $SERVER; 'localhost' is host-relative, so this refuses from inside a container):
  curl -s http://localhost:9010/extensions | jq .recentDisconnects
Close code 1001 = clean teardown by Chrome; 1006 = socket vanished with no close frame. Different bugs."
  echo "down:$now" > "$STATE"
fi

exit 1
