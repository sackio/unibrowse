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
  case "$cl" in /opt/google/chrome/chrome*|/usr/bin/google-chrome*) ;; *) continue ;; esac
  case "$cl" in
    *--type=renderer*) renderers=$((renderers + 1)) ;;
    *--type=*)         : ;;
    *)                 browser_up=1 ;;
  esac
done

[ -s "$LOG" ] || echo "iso_time,epoch,idle_ms,chrome_windows,renderer_procs,browser_up" > "$LOG"
printf '%s,%s,%s,%s,%s,%s\n' \
  "$(date '+%F %T')" "$(date +%s)" "$idle" "$windows" "$renderers" "$browser_up" >> "$LOG"

# Bounded: keep the header plus the newest MAX_LINES rows.
lines="$(wc -l < "$LOG" 2>/dev/null || echo 0)"
if [ "$lines" -gt "$((MAX_LINES + 1))" ]; then
  { head -1 "$LOG"; tail -n "$MAX_LINES" "$LOG"; } > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi
