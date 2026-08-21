#!/bin/bash
# Sample office desktop ACTIVITY once a minute, append one CSV row.
#
# WHY THIS EXISTS. `scripts` named a confounder in the Chrome-crash
# investigation that nobody was measuring: Ben's own activity level.
# Accessibility-tree construction is driven by page and DOM churn, so
# "fewer AT-SPI faults in the evening" and "less browsing in the evening"
# are not independent -- the cache-clear hypothesis and the activity
# hypothesis predict identical results for any evening window. Their
# registered prediction for the next working day only separates them if
# somebody actually recorded how active the desktop was.
#
# Nobody was. This records it.
#
# Read-only: xprintidle and a process count. It injects no input, touches
# no window, and never writes outside its own log.
#
# Columns: iso_time,epoch,idle_ms,chrome_windows,renderer_procs,browser_up
#   idle_ms         X server idle -- LOW means the operator is active
#   chrome_windows  top-level Chrome windows (X, not AT-SPI)
#   renderer_procs  Chrome --type=renderer processes: the finer-grained
#                   proxy for page/DOM churn that `scripts` suggested
#   browser_up      1 if a real Chrome BROWSER process exists
#
# ⛔ browser_up must NOT be asked with a command-string matcher. Chrome runs
# via the /usr/bin/google-chrome wrapper so argv[0] is the wrapper, and
# `pgrep -f '^/opt/google/chrome/chrome'` additionally matches
# chrome_crashpad_handler and every --type= child. Test /proc/PID/exe.
set -u

LOG="${OFFICE_ACTIVITY_LOG:-/tmp/office-activity.csv}"
MAX_LINES="${OFFICE_ACTIVITY_MAX_LINES:-20000}"   # ~14 days at 1/min
export DISPLAY="${DISPLAY:-:1}"
export XAUTHORITY="${XAUTHORITY:-/run/user/1000/gdm/Xauthority}"

idle="$(/usr/bin/xprintidle 2>/dev/null)" || idle=""
[ -n "$idle" ] || idle="NA"

windows="$(xdotool search --class 'google-chrome' 2>/dev/null | wc -l)" || windows="NA"

# ⛔ Classify by COMMAND LINE, not /proc/PID/exe. Container processes live in
# another mount namespace so readlink(exe) fails and they are silently skipped
# -- which looks like "zero container renderers" rather than "could not tell".
# ⛔ And do NOT use `pgrep -f -- --type=renderer`: measured 2026-08-20 it
# returns 44 where Ben's Chrome accounts for 23. The other 21 are 19
# container-chromium renderers, 1Password (also Electron, also --type=renderer),
# and pgrep matching its own command line. A page-churn proxy built on that
# figure is inflated ~2x by processes that have nothing to do with browsing.
renderers=0
browser_up=0
for d in /proc/[0-9]*; do
  # Braces group the redirect so the SHELL's "No such file" is suppressed too:
  # processes exit mid-scan constantly, and `tr ... 2>/dev/null` does not catch
  # a failure to OPEN the file, only tr's own stderr.
  cl="$( { tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null )" || continue
  # ⛔ COMPARE argv[0] EXACTLY. A prefix glob like /opt/google/chrome/chrome*
  # ALSO MATCHES chrome_crashpad_handler -- which is the identical bug already
  # fixed in unibrowse-host-browser-watch.sh (1dbfeed) and which I promptly
  # reintroduced here. It reported THREE browser processes where there is one.
  argv0="${cl%% *}"
  case "$argv0" in
    /opt/google/chrome/chrome|/usr/bin/google-chrome|/usr/bin/google-chrome-stable) ;;
    *) continue ;;
  esac
  case "$cl" in
    *--type=renderer*) renderers=$((renderers + 1)) ;;
    *--type=*)         : ;;
    *)                 browser_up=1; browser_pid="${d##*/}" ;;
  esac
done

# PAGE CHURN. `scripts` demoted renderer count from a gate condition to a
# covariate because it CANNOT MOVE during the browsing it was meant to detect:
# renderers track tab/site-instance lifetime, so a morning spent reading in
# already-open mail and Slack tabs leaves the count flat. Visit rows do move.
#
# Counted over a 5-minute window rather than as a running total, because
# Chrome prunes history at ~90 days and a total can therefore go DOWN.
#
# Read-only against the LIVE db (mode=ro, no lock taken, no copy) -- it is
# 39 MB and copying it once a minute would be silly. TIMESTAMPS ONLY: this
# reads visit_time and nothing else, no URLs and no titles.
visits_5m="$(/usr/bin/python3 - <<'PY' 2>/dev/null || echo NA
import sqlite3, os, datetime
H = os.path.expanduser('~/.config/google-chrome/Profile 1/History')
EPOCH = datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
cutoff = int((datetime.datetime.now(datetime.timezone.utc)
              - datetime.timedelta(minutes=5) - EPOCH).total_seconds() * 1_000_000)
# nolock=1 is REQUIRED, not an optimisation: Chrome holds the History lock
# persistently while active (rollback journal, not WAL), so a plain mode=ro
# read fails with "database is locked" even at an 8s timeout -- measured.
# mode=ro guarantees we never write; nolock skips the lock we would wait
# forever for. Worst case is a torn read on a COUNT, which the caller's NA
# fallback absorbs.
con = sqlite3.connect(f"file:{H}?mode=ro&nolock=1", uri=True, timeout=3)
n = con.execute("SELECT COUNT(*) FROM visits WHERE visit_time > ?", (cutoff,)).fetchone()[0]
con.close()
# ⛔ PLAUSIBILITY BOUND. nolock reads a file Chrome is actively writing, so a
# torn read can return a WRONG COUNT rather than an error -- flagged by
# `scripts` 2026-08-20. An off-by-a-few is undetectable and harmless for a
# gate asking "is this increasing"; a wild value is not, and would look like
# a churn spike. Emit NA rather than a number nobody can distinguish from
# real. 5000 visits in 5 minutes is ~17/second, far past human or automated.
print(n if isinstance(n, int) and 0 <= n < 5000 else "NA")
PY
)"
[ -n "$visits_5m" ] || visits_5m="NA"

# Seconds since the BROWSER process started. This is what makes a tab-restore
# burst self-labelling: `scripts`' gate must not count restore-driven visits,
# and any row with browser_uptime_s under ~300 is inside that window. Recording
# it beats trying to time when the column starts.
browser_uptime="NA"
[ -n "${browser_pid:-}" ] && browser_uptime="$(ps -o etimes= -p "$browser_pid" 2>/dev/null | tr -d ' ')"
[ -n "$browser_uptime" ] || browser_uptime="NA"

[ -s "$LOG" ] || echo "iso_time,epoch,idle_ms,chrome_windows,renderer_procs,browser_up,visits_5m,browser_uptime_s" > "$LOG"
printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
  "$(date '+%F %T')" "$(date +%s)" "$idle" "$windows" "$renderers" "$browser_up" \
  "$visits_5m" "$browser_uptime" >> "$LOG"

# Bounded: keep the header plus the newest MAX_LINES rows.
lines="$(wc -l < "$LOG" 2>/dev/null || echo 0)"
if [ "$lines" -gt "$((MAX_LINES + 1))" ]; then
  { head -1 "$LOG"; tail -n "$MAX_LINES" "$LOG"; } > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi
