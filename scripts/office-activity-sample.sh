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

# AT-SPI BUS BACKLOG. A passive proxy for accessibility signal volume.
#
# `scripts` proposed a common-cause model on 2026-08-20: an a11y signal burst
# both wedges a client that is not pumping its connection AND puts Chrome under
# heavy accessibility work, so a client fault and a crash can pair 6/6 with no
# arrow between them. Fill rate is the quantity that model names, and until now
# nothing measured it.
#
# Measured passively with `ss -x` — no AT-SPI client is created. That is
# deliberate: an event-listening client would be a second instrument that
# CHANGES the load it is trying to measure, in an investigation where "agent
# probing drives crashes" was itself a live hypothesis.
#
# ⛔⛔ READ THIS BEFORE TRUSTING ANY NUMBER BELOW. Three claims that lived in
# this comment on 2026-08-20 were WRONG, and all three were mine. The corrected
# model, converged with `scripts` and `ui-eye` and re-verified here at 21:14:
#
# ⛔ 1. "ONE CLIENT PID HOLDS TWO a11y SOCKETS." FALSE. It is ONE connection
# seen from BOTH ENDS. `ss -x` prints a row per ENDPOINT, and the inode pair is
# reciprocal (381012841 <-> 381016500 = client fd=11 / daemon fd=26). My own
# reciprocity test: 72 nonzero endpoint rows -> 37 distinct CONNECTIONS.
# ⇒ What manufactured the phantom second socket was a display bug in my probe:
# `other = b if a in daemon else a` prints the socket's OWNER when the daemon is
# on the far end, and I labelled that column "peer". Both ends then read
# `peer=588150` and looked like two sockets on one pid.
# ⇒ ⛔ THE LESSON IS NOT "attribute by inode" (I said that, and it was already
# what I did). It is: **a label that is right half the time is worse than no
# label.** Print BOTH inodes and let the reciprocity be checkable.
#
# ⛔ 2. "recvq FLUCTUATES, sendq SATURATES -- report them separately." FALSE,
# and it is the same error wearing different clothes. They are THE SAME BYTES
# IN DIFFERENT UNITS. AF_UNIX charges queued data to the SENDER's wmem as skb
# TRUESIZE, while the reader's Recv-Q counts PAYLOAD:
#     213760 / 41436 = 5.159      213504 / 41436 = 5.153
# ⇒ Ratio ~5.16 (many small D-Bus messages, per-skb overhead). ⛔ SO NEVER SUM
# rq + sq -- that double-counts one queue. Take the sender side alone; the
# receiver side adds no independent information.
# ⇒ And the 9,980 -> 41,218 "drain" that cost two seats an evening needs no
# drain, no restart and no transport recovery: it is payload wobble on one queue.
#
# ⛔ 3. "MAGNITUDE DETECTS A WEDGE." FALSE, and this is the one that matters.
# `scripts` measured the ui_eye client at 125 s old with t_alloc=214016 against
# tb=212992 -- AT the kernel ceiling -- while the watchdog logged `ok - 19 apps`
# at that same instant. ⇒ **Saturation is a CONSTANT of this client, reached
# ~2 min after every start and held through healthy and wedged phases alike.**
# A constant cannot trigger an event, and it cannot separate the two states.
# ⇒ Cause: that client runs no GLib main loop, so nothing ever pumps the
# connection. Real defect, but hygiene -- NOT the cure for the blind-view bug.
#
# ⛔ AND THERE IS NO SAME-BUS CONTROL ON THIS HOST. The other 22-23 peers on
# 647592 read 0/0 because they are AT-SPI PROVIDERS that receive nothing, not
# subscribers that are keeping up. Zero here means "not subscribed", not
# "healthy and draining". ⇒ The only valid control is this client's OWN healthy
# phase. ⛔ Do not compare against the SESSION bus (pid 5457) either -- different
# population entirely; its busy clients sit at rq~36K/sq~205K as a matter of
# course, which is where a "wedged" reading also sits.
#
# ⚑ Provenance note, because it cost real time: the figure "every other
# connection sat at 768, 278x the next largest" was MINE, unverified, written
# here -- and `ui-eye` then cited it back to me as an independent control.
# ⇒ ⛔ A FIGURE YOU PUBLISHED IS NOT EVIDENCE WHEN IT RETURNS.
#
# ⇒ ✅ SO WHAT IS THIS COLUMN STILL FOR? Not depth. Depth is a constant for the
# only peer that has one. It is for CONNECTION IDENTITY AND TURNOVER: whether a
# subscribed client is attached at all, and whether that connection was replaced
# between samples. Those do move, and nothing else here records them.
#
# ⚠️ LAGGING AND THRESHOLDED, not a signal count: it only moves when some reader
# falls behind, so a burst everyone keeps up with reads as zero. A true
# signals-per-interval counter has to come from a client that is pumping.
# ⛔ LIVENESS FILTER — WITHOUT THIS THE COLUMN MEASURES RESTARTS, NOT SIGNALS.
# Raised by `scripts` 2026-08-20 and it is correct. When an AT-SPI client exits,
# the bus's undelivered backlog toward it stays queued on the daemon side, so a
# departing peer produces exactly the same large Send-Q as a wedged one. The
# ui_eye.client restarts 36+ times a night and those restarts are FAULT-DRIVEN
# ⇒ an unfiltered series would correlate beautifully with faults and crashes
# while measuring none of them. A spurious correlation built into the sampler.
#
# So: resolve each queued socket's PEER pid and count only connections whose
# peer is still alive. Report what was dropped rather than filtering silently —
# a quiet night and a heavily-filtered night must not look identical.
#
# ⚠️ Liveness is necessary, NOT sufficient: a process that is alive but in its
# shutdown path has also stopped reading, and looks identical to a wedge. Treat
# a spike as "someone stopped reading", never as "someone is wedged".
read -r a11y_tot_q a11y_max_q a11y_dropped a11y_max_rq a11y_conns <<<"$(/usr/bin/python3 - <<'PY' 2>/dev/null || echo "NA NA NA NA NA"
import os, subprocess, glob
# ⛔ PIN TO THE ACCESSIBILITY DAEMON. Do NOT max over every socket whose PATH
# contains "at-spi" -- that was this column's first form and it is wrong twice
# over (both raised by `scripts` 2026-08-20):
#   1. a MAX across ~20 sockets can silently switch WHICH socket it reports
#      between samples, so consecutive rows are not like-for-like and any rate
#      derived from them is meaningless.
#   2. the real client connections are ANONYMOUS socketpairs with NO path, so a
#      path grep misses them entirely while catching unrelated named
#      at-spi2-*/socket entries.
# Attribution is by peer inode -> owning pid, which works for anonymous sockets.
daemon = set()
for d in glob.glob('/proc/[0-9]*'):
    try: cl = open(d + '/cmdline', 'rb').read().decode('utf8', 'replace')
    except OSError: continue
    if 'dbus-daemon' in cl and 'accessibility.conf' in cl:
        daemon.add(d.split('/')[2])
owner = {}
for fd in glob.glob('/proc/[0-9]*/fd/*'):
    try: t = os.readlink(fd)
    except OSError: continue
    if t.startswith('socket:['):
        owner[t[8:-1]] = fd.split('/')[2]
try:
    out = subprocess.run(['ss','-x'], capture_output=True, text=True, timeout=10).stdout
except Exception:
    raise SystemExit(1)
# ⛔ DO NOT COLLAPSE recv AND send WITH max(). That was this block's first form
# and it is exactly what hid the two-socket structure documented above: one
# "depth" column silently reported whichever side was larger, so a SATURATING
# sendq permanently masked a FLUCTUATING recvq on the same pid, and the column
# looked like a stable measurement of one thing. Keep the two sides apart.
# `conns` is here so a quiet bus and a filtered-empty bus cannot look identical.
# ⛔ DEDUPE BY RECIPROCAL INODE PAIR. `ss -x` emits one row per ENDPOINT, so
# every connection appears TWICE and a naive loop counts it twice. The version
# committed in 8358aee did exactly that: it summed rq+sq across both rows, i.e.
# payload PLUS truesize of the same bytes, and reported `conns=2` for ONE
# connection. Corrected 21:16 -- only the 21:09:57 row carries the doubled
# values; treat it as bad and nothing before it had the column at all.
rows = {}
for line in out.splitlines():
    f = line.split()
    if len(f) < 8: continue
    try: rq, sq = int(f[2]), int(f[3])
    except ValueError: continue
    rows[f[5]] = (rq, sq, f[7])      # inode -> (recvq, sendq, peer inode)

tot = mx_sq = mx_rq = dropped = conns = 0
seen = set()
for ino, (rq, sq, peer) in rows.items():
    a, b = owner.get(ino), owner.get(peer)
    if not (a in daemon or b in daemon): continue   # a11y bus connections only
    key = (ino, peer) if ino < peer else (peer, ino)
    if key in seen: continue                        # already did the far end
    seen.add(key)
    # Orient the pair: the DAEMON end carries the queue toward the client
    # (charged to the sender as skb truesize); the CLIENT end's recvq is the
    # payload view of those same bytes. Take the daemon side as the quantity.
    if a in daemon:
        d_sq = sq;                    c_ino, c_pid = peer, b
    else:
        pr = rows.get(peer)
        d_sq = pr[1] if pr else 0;    c_ino, c_pid = ino, a
    c = rows.get(c_ino)
    c_rq = c[0] if c else 0
    if d_sq <= 0 and c_rq <= 0: continue            # idle connection
    if c_pid is None or not os.path.isdir('/proc/' + str(c_pid)):
        dropped += d_sq              # peer gone: departing-socket artefact
        continue
    conns += 1
    tot += d_sq                      # ⛔ daemon side ONLY -- never rq + sq
    if d_sq > mx_sq: mx_sq = d_sq
    if c_rq > mx_rq: mx_rq = c_rq
print(tot, mx_sq, dropped, mx_rq, conns)
PY
)"
[ -n "$a11y_tot_q" ] || { a11y_tot_q=NA; a11y_max_q=NA; a11y_dropped=NA; }
[ -n "$a11y_max_rq" ] || a11y_max_rq=NA
[ -n "$a11y_conns" ] || a11y_conns=NA

# ⚠️ SCHEMA CHANGED 2026-08-20 21:10 — two columns APPENDED, none reordered.
# Appended rather than inserted on purpose: anything reading columns 1-11 by
# POSITION keeps working across the boundary, and rows written before this
# change simply have 11 fields instead of 13. Read by header name if you can.
# ⚠️ Columns 9/10/11 changed MEANING even though their positions did not:
# `total` is now rq+sq summed (was max(rq,sq) summed) and `max_sendq` is now
# genuinely the send side (was whichever side was larger). Pre-21:10 rows are
# NOT comparable to post-21:10 rows on those three columns. The name change
# from *_sendq to *_q on 9 and 11 is the marker of the boundary.
HDR="iso_time,epoch,idle_ms,chrome_windows,renderer_procs,browser_up,visits_5m,browser_uptime_s,a11y_total_q,a11y_max_sendq,a11y_dropped_q,a11y_max_recvq,a11y_conns"
if [ ! -s "$LOG" ]; then
  echo "$HDR" > "$LOG"
elif [ "$(head -1 "$LOG")" != "$HDR" ]; then
  # Rewrite ONLY line 1. A stale header over renamed columns is worse than no
  # header: it reads as authoritative and names the wrong quantity.
  { echo "$HDR"; tail -n +2 "$LOG"; } > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi
printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
  "$(date '+%F %T')" "$(date +%s)" "$idle" "$windows" "$renderers" "$browser_up" \
  "$visits_5m" "$browser_uptime" "$a11y_tot_q" "$a11y_max_q" "$a11y_dropped" \
  "$a11y_max_rq" "$a11y_conns" >> "$LOG"

# Bounded: keep the header plus the newest MAX_LINES rows.
lines="$(wc -l < "$LOG" 2>/dev/null || echo 0)"
if [ "$lines" -gt "$((MAX_LINES + 1))" ]; then
  { head -1 "$LOG"; tail -n "$MAX_LINES" "$LOG"; } > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi
