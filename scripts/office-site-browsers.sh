#!/bin/bash
# ── ONE CHROME PER SITE, ON ITS OWN MONITOR, LOGINS THAT SURVIVE ────────────
#
# Ben, Slack #unibrowse 2026-10-10 20:18 EDT: "different browsers for each site
# that they're trying to manage saving the cookies so that those browsers stay
# logged in and stuff they can resume them … on all different monitors on
# office".
#
# ⛔ WHY NOT browser_launch_isolated_chrome: those run inside the
# `unibrowse-chromium-host` CONTAINER, which has no display — no X server, no
# VNC, no published ports (measured). They are perfect for headless work and
# cannot ever appear on a monitor. This launcher is the host-side counterpart:
# a real Chrome on DISPLAY=:1, one profile per site, placed on a named output.
#
# ⛔ THIS SCRIPT NEVER DELETES A PROFILE. scripts/launch-chrome-isolated.sh
# defaults FRESH_PROFILE=yes and rm -rf's the directory, which is exactly the
# wrong default when the profile IS the asset — the logins are the thing we are
# keeping. There is deliberately no fresh/reset flag here: to start a site over,
# delete its directory by hand and mean it.
#
# ⚠️ HOST-LOCAL, OFFICE. Profiles live under /home/ben, which is different
# content on every host. This script is about office's monitors and nothing else.
#
# ⛔ CHROME 155 IGNORES --load-extension, AND IT FAILS SILENTLY. MEASURED here
# 2026-10-10: the first contra launch came up fine, placed correctly, looking
# healthy — and its profile's Preferences held only Chrome's three built-in
# component extensions. No unibrowse, no error, no clue in the log. A browser
# that launches and never connects is the worst shape this can fail in.
# ⛔ CORRECTED 2026-10-14: THIS HEADER USED TO SAY "...UNLESS YOU ALSO DISABLE
# DisableLoadExtensionCommandLineSwitch", AND THAT IS NOT TRUE. It contradicted
# the comment at the launch site ~300 lines below, which records that this very
# flag was tried FIRST and left the browser silently broken (as was
# `developer_mode`). ⇒ The flag is NOT the fix and never was. The fix is the
# Preferences seed at the launch site. The flag is still passed because it is
# harmless and removing it is a behaviour change nobody has measured — do not
# read its presence as evidence that it does anything. Memo `43d0b40f` also
# lists it as a failed fix.
# ⚠️ Both features go in ONE --disable-features flag; a second one does not
# merge with the first. (True regardless of whether either does anything.)
# ⚠️ scripts/launch-chrome-isolated.sh lacks the Preferences seed and will hit
# the --load-extension refusal on any host whose Chrome is current; the
# container sidecars are unaffected only because they run an older Chromium.
#
# ⭐ WHAT THE SEED DOES AND DOES NOT EXPLAIN. MEASURED 2026-10-14 by reading
# <profile>/Default/Preferences for ALL 18 slots: every one carries the seeded
# entry for id `pikjoohganfooeancifkoccakcocchmk`, with fields the seed template
# does not contain — `has_started_service_worker: true`, `active_permissions`,
# `service_worker_registration_info` — i.e. Chrome LOADED the extension and its
# worker RAN. `disable_reasons` empty, developer_mode true.
# ⇒ The open "script-launched browsers do not register on :9010" fault (memo
# `a356bc6e`) is therefore a REGISTRATION failure DOWNSTREAM of loading, not an
# installation failure. Do not spend another cycle on whether the seed works.
# ⚠️ Limit: `has_started_service_worker` means the worker started at some point,
# and these files are written at SHUTDOWN, so they describe each browser's last
# run and not a live state.
# ⚠️ And note the id: it is the SHA256 of the extension's PATH, so office's id
# (`/mnt/nas/data/code/unibrowse/extension`) is NOT the container's
# (`/app/extension` → `edoicfpldmlabgdalemfgflpldiijdmm`). Probing a host
# profile with a container-derived id returns "absent" for a present entry —
# which is exactly the false negative that cost one round of this measurement.
#
# ⭐ THE ENV BLOCK IS LOAD-BEARING, not boilerplate. A Chrome launched without
# DBUS_SESSION_BUS_ADDRESS + XDG_RUNTIME_DIR never registers on the AT-SPI bus,
# and AXPress is then unavailable FOR THAT BROWSER'S WHOLE LIFETIME — which is
# the only way to clear a modal dialog when the renderer is blocked (measured
# 2026-10-10: it rescued two frozen tabs that no tool could reach, while
# xdotool/XTEST did nothing at all because the screen was locked).

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$PROJECT_ROOT/extension"
PROFILES_ROOT="/home/ben/.chrome-profiles"
LOG_DIR="$PROFILES_ROOT/logs"
CHROME_BIN="/usr/bin/google-chrome"

# ⛔⛔ DO NOT DEFAULT DISPLAY TO :1. THE NUMBER IS ALLOCATED BY GDM AND CHANGES
# ACROSS A LOGOUT. MEASURED 2026-10-12: Ben's session was :1; `scripts` logged
# office out at his direction (Slack #scripts 03:15) and afterwards the ONLY
# socket was /tmp/.X11-unix/X0, owned by gdm — the GREETER. A defaulted :1 then
# resolves to nothing, or worse to whatever GDM happens to hold, and Chrome
# launches against the wrong display while every `list` line still reads "up".
# ⚠️ This line previously read `export DISPLAY="${DISPLAY:-:1}"`, which fails
# toward a PLAUSIBLE WRONG VALUE rather than an error — the most expensive
# failure shape there is, and the same one this file's other traps are about.
# `scripts` flagged it before it cost anything.
#
# Resolution order: an explicit UNIBROWSE_DISPLAY override (recovery), then the
# Display property of THIS USER's logind session. The greeter belongs to gdm, so
# filtering on our own user excludes it by construction rather than by guessing.
# ⛔ No fallback guess. Commands that need X fail loudly via require_display;
# list/map/down keep working with no X session at all, which is the state right
# after a logout and exactly when you need to inspect.
resolve_display() {
  if [ -n "${UNIBROWSE_DISPLAY:-}" ]; then echo "$UNIBROWSE_DISPLAY"; return 0; fi
  local sid d me
  me="$(id -un)"
  while read -r sid; do
    [ -n "$sid" ] || continue
    d="$(loginctl show-session "$sid" -p Display --value 2>/dev/null)"
    if [ -n "$d" ] && [ -S "/tmp/.X11-unix/X${d#:}" ]; then echo "$d"; return 0; fi
  done < <(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$me" '$3==u {print $1}')
  # ⛔ logind's Display property is EMPTY on a gdm-autologin session, so the loop
  #    above NEVER resolved on office and this function refused a LIVE desktop.
  #    MEASURED 2026-10-12 09:13: session 1648966 read Type=x11 Active=yes
  #    Display=[] (every ben session read empty) while /tmp/.X11-unix/X0 was
  #    owned by ben. That false negative broke `!login admin` on all 4 hosts at
  #    09:01 — claude-login-auto found no host browser because the */5 cron that
  #    launches claudelogin had been exiting 3 here since Ben logged back in.
  # ⇒ The SOCKET'S OWNER is the evidence that actually exists: `ben` is his
  #    session, `gdm` is the greeter. Still fails closed — a gdm-owned socket is
  #    skipped and we return 1, which is the whole point of not guessing :1.
  local sock own
  for sock in /tmp/.X11-unix/X*; do
    [ -S "$sock" ] || continue
    own="$(stat -c '%U' "$sock" 2>/dev/null)"
    [ "$own" = "$me" ] || [ "$own" = "$(id -u)" ] || continue
    echo ":${sock##*/X}"; return 0
  done
  return 1
}

if _resolved_display="$(resolve_display)"; then
  export DISPLAY="$_resolved_display"
else
  unset DISPLAY
fi

# Call this from anything that actually talks to X (launch, tile, enumerate
# monitors). Reading state does not need it.
require_display() {
  [ -n "${DISPLAY:-}" ] && return 0
  {
    echo "⛔ no X session for $(id -un): cannot resolve DISPLAY, and this command needs it."
    echo "   X sockets present: $(ls /tmp/.X11-unix/ 2>/dev/null | tr '\n' ' ')"
    echo "   (an X0 owned by gdm is the GREETER — nobody is logged in)"
    echo "   ⛔ NOT defaulting to :1: that silently targets the greeter or nothing."
    echo "   If someone IS logged in and this still fails, override explicitly:"
    echo "     UNIBROWSE_DISPLAY=:N $0 $*"
  } >&2
  exit 3
}
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/1000/bus}"

# ── site → monitor → landing URL ───────────────────────────────────────────
# Monitor names are xrandr outputs; `monitors` prints the live geometry.
# Assignment is `freelance`'s (ATC 2026-10-10 20:20): sites 1-8 one per screen,
# 9-16 stacked on the last one, Upwork and Fiverr on the two biggest central
# screens because they matter most and they challenge on login.
SITES=(
  "upwork|DP-0|left|https://www.upwork.com/"
  "fiverr|HDMI-0|left|https://www.fiverr.com/"
  "freelancer|DVI-I-1|left|https://www.freelancer.com/"
  "contra|DVI-D-0|left|https://contra.com/"
  "guru|DVI-D-1-0|left|https://www.guru.com/"
  "bark|HDMI-1-0|left|https://www.bark.com/"
  "malt|DP-1-0|left|https://www.malt.com/"
  "workana|DVI-I-1-1|left|https://www.workana.com/"
  "truelancer|DP-0|right|https://www.truelancer.com/"
  "peopleperhour|HDMI-0|right|https://www.peopleperhour.com/"
  "sortlist|DVI-I-1|right|https://www.sortlist.com/"
  "clutch|DVI-D-0|right|https://clutch.co/"
  "goodfirms|DVI-D-1-0|right|https://www.goodfirms.co/"
  "designrush|HDMI-1-0|right|https://www.designrush.com/"
  "techbehemoths|DP-1-0|right|https://techbehemoths.com/"
  "zapier|DVI-I-1-1|right|https://partnerportal.zapier.com/"
  # ⛔ NOT A SITE, and in this table on purpose. One Chrome whose only job is to
  # host the Claude Code account-swap login. `agents` asked for it 2026-10-10
  # 21:22 EDT, after Ben had office's main Chrome closed: claude-login-auto's
  # resolver ends in `sort -u`, so without this it lands on whichever SITE
  # browser happens to hold the lowest extension id and then fights `freelance`
  # for that browser's single MV3 worker — contention that reaches them as a
  # login failure rather than as contention.
  # ⛔ Never sign a site in here, and never point unibrowse-login-watch.py at
  # it. It holds no sessions BY DESIGN, so a session check against it reports
  # "out" and pages a human about a profile that is supposed to be empty.
  "claudelogin|DP-0|corner|about:blank"
  # ⛔ ALSO NOT A SITE. One Chrome whose only job is `alpaca`'s daily paper-account
  # signup. They asked for it 2026-10-11 07:05 EDT, because the 16 site browsers
  # plus claudelogin broke the predicate alpaca-signup used to find a browser at
  # all: it matched on there being EXACTLY ONE `docker-host-desktop` extension,
  # and office went from one to seventeen overnight. It is pinned by extensionId
  # on their side now, so this row must keep its own profile and therefore its own
  # stable uuid — ⛔ do not rename the slot or delete the profile directory.
  # ⚠️ IT MUST ALLOW INCOGNITO. Their only method that passes Cloudflare Turnstile
  # is a fresh incognito tab in a REAL desktop Chrome; they expect a container
  # sidecar to fail it. Incognito comes from the seeding template at
  # scripts/utils/unibrowse-unpacked-entry.json, which carries "incognito": true —
  # the same property the claudelogin flow depends on. ⛔ Do not "tidy" that key.
  # ⛔ Never sign anything in here and never point a session check at it: like
  # claudelogin it holds no persistent session by design.
  # ⭐ Keep this one up even if the SITE browsers are taken down for load. Measured
  # 2026-10-11: an idle profile costs 0.0-0.4% of a core, and this is not a site.
  "alpacasignup|HDMI-0|corner|about:blank"
)

site_field() { # site_field <name> <monitor|slot|url>
  local name="$1" want="$2" row
  for row in "${SITES[@]}"; do
    if [ "${row%%|*}" = "$name" ]; then
      IFS='|' read -r _ mon slot url <<<"$row"
      case "$want" in
        monitor) echo "$mon" ;;
        slot)    echo "$slot" ;;
        url)     echo "$url" ;;
      esac
      return 0
    fi
  done
  return 1
}

# ⭐ HALF A MONITOR EACH, so 16 sites are visible at once on 8 screens
# (Ben, #unibrowse 2026-10-10 20:33). Left slot keeps the monitor's x; right
# slot starts half a width in. Odd widths floor, so the right half gets the
# spare pixel rather than overlapping.
slot_geometry() { # slot_geometry <monitor> <left|right|corner> -> "W H X Y"
  local geo w h x y hw cw ch
  geo="$(monitor_geometry "$1")" || return 1
  [ -n "$geo" ] || return 1
  read -r w h x y <<<"$geo"
  hw=$(( w / 2 ))
  # ⭐ `corner` is for a browser that is NOT a site and owns no slot: a small
  # window over the monitor's bottom-right. All 16 half-slots are spoken for,
  # and the login browser only ever shows transient incognito windows, so
  # overlapping a site costs less than evicting one.
  if [ "$2" = "corner" ]; then
    cw=960; ch=620
    [ "$cw" -gt "$w" ] && cw="$w"
    [ "$ch" -gt "$h" ] && ch="$h"
    echo "$cw $ch $(( x + w - cw )) $(( y + h - ch ))"
  elif [ "$2" = "right" ]; then echo "$(( w - hw )) $h $(( x + hw )) $y"
  else echo "$hw $h $x $y"; fi
}

monitor_geometry() { # monitor_geometry <output> -> "W H X Y"
  xrandr --listmonitors | awk -v want="$1" '
    $NF == want {
      # field 3 looks like 1920/527x1080/296+1920+1080
      g = $3
      gsub(/\/[0-9]+/, "", g)          # drop the physical-mm parts
      split(g, a, "x"); w = a[1]
      split(a[2], b, "+"); h = b[1]; x = b[2]; y = b[3]
      print w, h, x, y
    }'
}

profile_dir() { echo "$PROFILES_ROOT/$1"; }

# ⛔ ADDED 2026-10-12. cmd_down used to TERM and return in the same breath, so
# `down X` followed by `up X` launched a new Chrome INTO a still-dying one. A
# second Chrome on the same --user-data-dir does not start a browser: it hands
# its URL to the instance that still owns the profile and exits (the comment in
# cmd_up has said so all along). The new browser therefore never existed, the
# dying one then exited too, and the launch was reported as "no extension
# registered within 150s" — which reads as an extension fault.
# MEASURED: three site browsers (claudelogin, alpacasignup, contra) were all
# up-but-unregistered tonight and all three registered in 10-92s on a manual
# relaunch that polled for the old pid to die first. That poll is the only thing
# the manual sequence had and this script did not.
wait_for_exit() { # wait_for_exit <pid> [secs] -> 0 gone, 1 still alive
  local pid="$1" secs="${2:-20}" i=0
  while [ "$i" -lt "$secs" ]; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1; i=$((i + 1))
  done
  ! kill -0 "$pid" 2>/dev/null
}

running_pid() { # the browser process owning this exact profile, or empty
  # ⛔ `pgrep -f` ALSO MATCHES ANY SHELL whose command line mentions the profile
  # — a diagnostic one-liner, another seat's grep, a cron wrapper. MEASURED
  # 2026-10-10 21:28: right after this browser was killed, the same pattern
  # still reported two "processes", both of them my own `bash -c` wrapper. A
  # watchdog built on that reads "already up" for a browser that is GONE and
  # never relaunches it. (Second instance of this class — the first counted
  # launcher shells as Chrome processes on 2026-10-10 afternoon.)
  # ⛔ AND SKIP `--type=` CHILDREN: a renderer's exe is the browser binary too,
  # but `down` kills what this returns, and killing a renderer leaves the
  # browser running while reporting success.
  local dir="$1" p
  for p in $(pgrep -f -- "--user-data-dir=$dir " 2>/dev/null); do
    case "$(readlink -f "/proc/$p/exe" 2>/dev/null)" in
      */chrome|*/chromium) ;;
      *) continue ;;
    esac
    tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | grep -q -- '--type=' && continue
    echo "$p"; return 0
  done
}

cmd_monitors() {
  require_display
  echo "office monitors (DISPLAY=$DISPLAY):"
  # ⚠️ The output NAME is the LAST field, not the second: the second carries
  # xrandr's "+*" primary markers (+*HDMI-0), which is not a name anything
  # accepts. This command exists to be copied from, so it must print the real one.
  xrandr --listmonitors | tail -n +2 | while read -r _ _ geom name; do
    printf '  %-12s %s\n' "$name" "$geom"
  done
}

cmd_list() {
  printf '%-15s %-12s %-6s %-9s %s\n' SITE MONITOR SLOT STATE PROFILE
  local row name mon slot dir pid
  for row in "${SITES[@]}"; do
    IFS='|' read -r name mon slot _ <<<"$row"
    dir="$(profile_dir "$name")"
    pid="$(running_pid "$dir" || true)"
    # ⚠️ NOT "${pid:+up:$pid}${pid:-down}" — when pid IS set, :- returns the
    # value too, so that prints "up:2020040" immediately followed by the bare
    # pid. Measured on the first run: "up:20200402020040".
    local state
    if [ -n "$pid" ]; then state="up:$pid"; else state="down"; fi
    printf '%-15s %-12s %-6s %-9s %s\n' "$name" "$mon" "$slot" "$state" \
      "$([ -d "$dir" ] && echo exists || echo '(not created)')"
  done
}

cmd_up() {
  require_display
  local name="$1" mon slot url dir geo w h x y pid
  mon="$(site_field "$name" monitor)" || { echo "unknown site: $name" >&2; return 1; }
  slot="$(site_field "$name" slot)"
  url="$(site_field "$name" url)"
  dir="$(profile_dir "$name")"

  pid="$(running_pid "$dir" || true)"
  if [ -n "$pid" ]; then
    # ⚠️ Idempotent on purpose WHEN THE BROWSER IS REACHABLE. A second Chrome on
    # the same --user-data-dir does NOT start a second browser; it hands the URL
    # to the running one and exits, which looks like success and silently does
    # something else.
    # ⛔ BUT A RUNNING BROWSER THAT IS NOT REGISTERED CANNOT BE HEALED BY `up`,
    # and that is the state this script kept reporting and could not fix.
    # Asked for by `agents` 2026-10-12 21:16 so the login path heals itself.
    local stored
    stored="$(cat "$(extid_file "$name")" 2>/dev/null || true)"
    if [ -n "$stored" ] && live_ext_ids | grep -qxF "$stored"; then
      echo "$name: already up (pid $pid) and registered as $stored — leaving it alone"
      return 0
    fi
    # ⛔⛔ AN ABSENT .extid IS NOT EVIDENCE THAT THE BROWSER IS UNREGISTERED, and
    # treating it as such made this script KILL ITS OWN HEALTHY BROWSER every 5
    # minutes. MEASURED 2026-10-15 15:50: claudelogin and alpacasignup were both
    # connected (`map` resolved ext_bb94966c and ext_c07b1a74 against the live
    # registry) while BOTH .extid files were absent — deleted by the launch
    # path's failure branch, which had mis-attributed registration. cmd_up then
    # read "stored id absent and not connected", TERMed a working browser, and
    # relaunched it; the relaunch mis-attributed again and deleted the pointer
    # again. That is the perpetual blank-window loop Ben saw, and the ~4-minute
    # "death" `scripts` measured was this kill, not a crash.
    # ⇒ Ask the profile before concluding anything, and heal the pointer in
    # place. The .extid file is a cache; the profile's own store plus the live
    # registry are the authority.
    local resolved
    if resolved="$(live_id_for_profile "$name")"; then
      printf '%s\n' "$resolved" > "$(extid_file "$name")"
      echo "$name: already up (pid $pid) and registered as $resolved — recovered a missing pointer, leaving it alone"
      return 0
    fi
    echo "$name: up (pid $pid) but its stored id is ${stored:-absent}, and this profile resolves to no live extension — recycling"
    kill -TERM "$pid"
    if ! wait_for_exit "$pid" 20; then
      echo "$name: ⚠️ pid $pid survived TERM — not launching, a launch now would hand off to it" >&2
      return 1
    fi
    sleep 2
  fi

  local launch_t0
  launch_t0="$(date +%s)"

  geo="$(slot_geometry "$mon" "$slot")"
  [ -n "$geo" ] || { echo "$name: monitor $mon not found — run '$0 monitors'" >&2; return 1; }
  read -r w h x y <<<"$geo"

  mkdir -p "$dir/Default" "$LOG_DIR"
  # ⛔⛔ BRANDED CHROME REFUSES --load-extension OUTRIGHT. Chrome's own words,
  # captured with --enable-logging=stderr --v=1 on 155.0.8059.39, 2026-10-10:
  #     "--load-extension is not allowed in Google Chrome, ignoring."
  # It is a WARNING on stderr that nothing surfaces: the browser launches, sits
  # on its monitor looking perfect, and has no extension. Two wrong fixes came
  # first — DisableLoadExtensionCommandLineSwitch, then developer_mode — and
  # both left it silently broken. The container sidecars are unaffected because
  # they run Chromium, which still honours the switch.
  # ⇒ Register the unpacked extension in the profile the way "Load unpacked"
  # does, before first launch. Template captured from a profile where it was
  # loaded by hand, stripped of permissions/timestamps.
  /usr/bin/python3 - "$dir/Default/Preferences" "$PROJECT_ROOT/scripts/utils/unibrowse-unpacked-entry.json" "$EXTENSION_DIR" <<'SEED'
import json, sys, os
prefs_path, tmpl_path, ext_dir = sys.argv[1], sys.argv[2], sys.argv[3]
tmpl = json.load(open(tmpl_path))
prefs = {}
if os.path.exists(prefs_path):
    try: prefs = json.load(open(prefs_path))
    except Exception: prefs = {}
entry = dict(tmpl["entry"]); entry["path"] = ext_dir
ext = prefs.setdefault("extensions", {})
ext.setdefault("settings", {}).setdefault(tmpl["id"], entry)
ext.setdefault("ui", {})["developer_mode"] = True
json.dump(prefs, open(prefs_path, "w"))
SEED
  echo "$name: launching on $mon $slot half (${w}x${h}+${x}+${y}), profile $dir"
  setsid --fork "$CHROME_BIN" \
    --user-data-dir="$dir" \
    --window-position="$x,$y" \
    --window-size="$w,$h" \
    --no-first-run \
    --no-default-browser-check \
    --disable-sync \
    --disable-default-apps \
    --disable-features=TranslateUI,DisableLoadExtensionCommandLineSwitch \
    "$url" \
    >>"$LOG_DIR/$name.log" 2>&1 </dev/null

  # ⚠️ MINIMIZE BEFORE THE REGISTRATION WAIT, not after. That wait runs up to
  # 150s and the window would paint on Ben's desktop for the whole of it, which
  # is the symptom this is here to remove. Retried for ~12s because Chrome maps
  # its frame a few seconds after exec and there is nothing to minimize before
  # that; the loop stops on the first window it genuinely minimizes.
  # ⚠️ Deliberately on BOTH paths — a launch that never registers leaves a blank
  # window behind, and that is precisely the one Ben saw every 5 minutes.
  local mz_pid mz try
  mz_pid="$(running_pid "$dir" || true)"
  if [ -n "$mz_pid" ]; then
    for try in 1 2 3 4 5 6 7 8 9 10 11 12; do
      mz="$(minimize_site_windows "$mz_pid")"
      if [ "${mz:-0}" -gt 0 ]; then echo "$name: minimized $mz window(s)"; break; fi
      sleep 1
    done
    if [ "${mz:-0}" = "0" ]; then
      echo "⚠️ $name: no WM-managed window to minimize after 12s — it may still be painting" >&2
    fi
  fi

  # ⭐ Record the id this launch produced, while the mapping is unambiguous.
  # ⚠️ The MV3 service worker does not connect instantly — claudelogin took ~90s
  #    on 2026-10-12 — so this waits up to 150s. A browser that never registers
  #    is reported, not silently skipped: alpacasignup launched at 09:15 and had
  #    still not registered 11 minutes later, and nothing said so.
  local newid
  if newid="$(await_registration "$launch_t0" "$name")"; then
    printf '%s\n' "$newid" > "$(extid_file "$name")"
    echo "$name: registered as $newid (recorded in $(extid_file "$name"))"
  else
    rm -f "$(extid_file "$name")"
    echo "⚠️ $name: launched (pid $(running_pid "$dir" || echo '?')) but no extension could be attributed to it after ${AWAIT_WAITED:-?}s." >&2
    if [ "${AWAIT_AMBIG_MAX:-0}" -gt 1 ]; then
      # ⇒ The server HAS fresh connections; we could not prove which is ours, and
      # this profile's store never produced a live id. Do not blame the worker.
      echo "   ⚠️ Up to ${AWAIT_AMBIG_MAX} extensions connected inside the window and this profile's own store never resolved to a live id." >&2
      echo "   ⇒ Check \`$0 map\` before concluding anything: it may already know this site's id." >&2
    else
      echo "   Chrome is running; its service worker is not talking to ${UNIBROWSE_SERVER:-http://127.0.0.1:9010}." >&2
    fi
    echo "   ⛔ Any stale $(extid_file "$name") has been REMOVED — a pointer nobody can reach is worse than none." >&2
    return 4
  fi
}

# ⭐ RECORD WHICH extensionId A LAUNCH PRODUCED, AT LAUNCH TIME.
# The uuid is minted fresh by the extension on every Chrome start, so it cannot
# be predicted and cannot be read back reliably afterwards: the profile's
# leveldb store ACCUMULATES old uuids and may not have flushed the new one at
# all (measured 2026-10-12 — `map` confidently returned an id that had died
# hours earlier). The one moment the mapping is unambiguous is the launch: we
# know which ids existed before, and exactly one browser is starting.
# ⇒ Snapshot, launch, wait for the new id, write it down. `agents` reads this
#   file to pin claude-login-auto instead of a literal uuid (asked 2026-10-12).
# ⚠️ Deliberately NOT the server's `profileName` field, which they first asked
#   for: that field has three readers and NO writer anywhere in the tree —
#   nothing has ever set `__unibrowseProfileHint` — so it is null for every
#   browser including the sidecars. Giving it a writer means changing the
#   extension, and extension code does not reach a running browser without the
#   ↻ control on chrome://extensions, which Ben has declined. A file the
#   launcher writes needs no deploy and no reload.
live_ext_ids() {
  curl -s -m 5 "${UNIBROWSE_SERVER:-http://127.0.0.1:9010}/extensions" 2>/dev/null \
    | /usr/bin/python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for e in d.get("connected",[]): print(e.get("extensionId",""))' 2>/dev/null || true
}

# ⭐ MINIMIZE A SITE BROWSER'S WINDOWS. Prints how many it actually minimized.
# Ben authorized making this permanent — Slack #scripts 2026-10-15 17:01, "yes"
# to `a2g` ("make minimize at launch permanent in unibrowse's launcher?").
# ⛔ MINIMIZE, NOT CLOSE AND NOT KILL. His first instruction in that thread was
# "close them"; `scripts` corrected it in the same thread because claudelogin is
# the browser claude-login-auto drives and alpacasignup carries a signup
# session. These browsers must keep running — only the painting is unwanted.
# ⛔ GUARD ON WM_STATE, because windowminimize SUCCEEDS on a window the WM does
# not manage and changes nothing — so a success return is not evidence of a
# minimized window. MEASURED by `scripts` 2026-10-15: Chrome pid 2145872 owned
# both 0x3a00003 (WM_STATE Iconic after minimize) and 0x3c00001 (WM_STATE "not
# found", minimize returned success and the window stayed put). Without the
# guard this function would report 2 and leave one window painting.
# ⚠️ NOT --onlyvisible here: a window already Iconic must still be counted, or a
# second call reads as a total failure and the caller retries pointlessly.
# ⚠️ Offscreen was RULED OUT, not overlooked: mutter clamps a move past the
# desktop bounds back inside (measured +7680+2190 -> +6736+1602) and the
# 8-monitor layout's largest gap is a 240px strip left of DP-0.
minimize_site_windows() {
  local pid="$1" wid n=0 st
  for wid in $(xdotool search --pid "$pid" 2>/dev/null); do
    st="$(xprop -id "$wid" WM_STATE 2>/dev/null || true)"
    case "$st" in *"window state"*) ;; *) continue ;; esac
    if xdotool windowminimize "$wid" 2>/dev/null; then n=$((n + 1)); fi
  done
  printf '%s\n' "$n"
}

extid_file() { printf '%s/%s.extid\n' "$PROFILES_ROOT" "$1"; }

# ⭐ WHICH EXTENSION BELONGS TO THIS PROFILE — ANSWERED FROM THE PROFILE ITSELF.
# The extension writes its own server-facing uuid into the profile's leveldb
# store, so the mapping is derivable per profile and does NOT depend on timing.
# Same mechanism cmd_map already uses, factored out so the launch path can use
# it too. Collect every candidate and let the live registry pick: the store
# ACCUMULATES uuids across launches, so disk alone cannot say which is current.
# ⚠️ Returns nothing when the curl fails, which makes "not registered" the
# answer on an unreachable server. That is the right way round — the caller
# must not record a pointer it could not verify.
live_id_for_profile() {
  local name="$1" store uuids u live_ids
  store="$(profile_dir "$name")/Default/Local Extension Settings"
  live_ids="$(curl -s -m 5 "${UNIBROWSE_SERVER:-http://127.0.0.1:9010}/extensions" 2>/dev/null \
    | /usr/bin/python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for e in d.get("connected",[]): print(e.get("extensionId",""))' 2>/dev/null || true)"
  [ -n "$live_ids" ] || return 1
  uuids="$( { strings "$store"/*/* 2>/dev/null \
          | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
          || true; } | awk '!seen[$0]++')"
  for u in $uuids; do
    if printf '%s\n' "$live_ids" | grep -qxF "ext_$u"; then printf 'ext_%s\n' "$u"; return 0; fi
  done
  return 1
}

# Wait for an extension that CONNECTED AFTER <t0>. Prints its id, or nothing.
#
# ⛔ REWRITTEN 2026-10-12. This used to diff the id SET against a snapshot taken
# before the launch and wait for an id that was not in it. That is wrong
# whenever the extension REUSES its stored id, which is the normal case: the id
# lives in chrome.storage.local inside the profile, so a relaunched browser
# comes back as the SAME extension. MEASURED tonight: contra relaunched twice
# and returned as ext_b8aeffe4 both times. The set difference is then empty, so
# a browser that registered in 92s was reported as "NO new extension registered
# within 150s" — and the failure branch then DELETED its .extid pointer, which
# is how a healthy browser became an unaddressable one.
# ⭐ connectedForMs is the reading that does not care whether the id is new: it
# is the extension's OWN connection age, so "connected after we launched" is
# directly measurable. The 10s slack absorbs poll latency and clock skew
# between this host and the server.
# ⚠️ Still refuses to guess when two extensions connect inside the window — a
# wrong pointer is worse than an absent one, which was right the first time.
# ⛔⛔ THE AMBIGUITY BRANCH USED TO `return 1` ON THE FIRST POLL, AND THAT BUILT A
# PERPETUAL RELAUNCH LOOP THAT PUT A BLANK about:blank WINDOW ON BEN'S DESKTOP
# EVERY 5 MINUTES. He raised it himself (#scripts 2026-10-15 15:46, "it's like
# blank unibrows windows are opening small with about blank").
# MECHANISM, measured 2026-10-15: claudelogin and alpacasignup are driven by TWO
# CRONS ON THE SAME `*/5` SCHEDULE, so they launch in the same minute. Each one's
# extension connects inside the OTHER's attribution window, both poll n=2, both
# return 1, both DELETE their .extid — so both read as down on the next tick and
# relaunch. Mutual, deterministic, and it cannot clear itself: the more reliably
# both browsers register, the more reliably each poisons the other's window.
# ⇒ Recency across ALL extensions is the wrong instrument. It cannot distinguish
# two concurrent launches, and two concurrent launches are GUARANTEED here.
# ⭐ Ask the profile instead (live_id_for_profile): the uuid is in that profile's
# own store and no other launch can touch it. Recency survives only as a
# fallback for a virgin profile whose store has not flushed yet — and it now
# KEEPS WAITING through ambiguity instead of giving up, because the deterministic
# answer usually arrives a few seconds later anyway.
# ⚠️ The old failure text claimed "NO new extension registered within 150s"
# after waiting as little as 5 seconds, and then asserted the service worker was
# not talking to :9010. Both were false on 2026-10-15: `map` resolved BOTH ids
# against the live registry at the same moment. A duration in a message must be
# the duration actually waited.
await_registration() {
  local t0="$1" name="$2" waited=0 fresh n id ambig_max=0
  while [ "$waited" -lt 150 ]; do
    sleep 5; waited=$((waited + 5))
    # (a) DETERMINISTIC — this profile's own store, cross-checked against live.
    if id="$(live_id_for_profile "$name")"; then printf '%s\n' "$id"; return 0; fi
    # (b) FALLBACK — recency, for a profile whose store has not flushed yet.
    fresh="$(curl -s -m 5 "${UNIBROWSE_SERVER:-http://127.0.0.1:9010}/extensions" 2>/dev/null \
      | /usr/bin/python3 -c 'import json,sys,time
t0=float(sys.argv[1])
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
age_limit=(time.time()-t0)+10
for e in d.get("connected",[]):
    if float(e.get("connectedForMs") or 0)/1000.0 <= age_limit:
        print(e.get("extensionId",""))' "$t0" 2>/dev/null || true)"
    n="$(printf '%s\n' "$fresh" | grep -c . || true)"
    case "$n" in
      0) ;;
      1) printf '%s\n' "$fresh" | grep . ; return 0 ;;
      *) if [ "$n" -gt "$ambig_max" ]; then ambig_max="$n"; fi ;;
    esac
  done
  # Exported so the caller can say what actually happened rather than guessing.
  AWAIT_WAITED="$waited"; AWAIT_AMBIG_MAX="$ambig_max"
  return 1
}

cmd_map() { # site -> the extensionId the server knows it by
  # ⭐ The extension stores its own server-facing uuid in the profile, so the
  # map is derivable from disk and needs no guessing from tab URLs. Asked for
  # by `freelance` 2026-10-10 20:36, who could see 8 identical-looking
  # docker-host-desktop connections and no way to tell which site each was.
  local row name store uuids live u n rec LIVE_IDS
  # The server is the only authority on what is connected RIGHT NOW. Empty on a
  # failed curl, which makes every id read STALE — loud, and the right way round.
  LIVE_IDS="$(curl -s -m 5 "${UNIBROWSE_SERVER:-http://127.0.0.1:9010}/extensions" 2>/dev/null \
    | /usr/bin/python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for e in d.get("connected",[]): print(e.get("extensionId",""))' 2>/dev/null || true)"
  printf '%-15s %s\n' SITE EXTENSION_ID
  for row in "${SITES[@]}"; do
    name="${row%%|*}"
    store="$(profile_dir "$name")/Default/Local Extension Settings"
    # ⛔ TWO BUGS LIVED HERE, both silent, found 2026-10-11 when `alpaca`'s
    # daily signup stopped because it could not tell 17 docker-host-desktop
    # extensions apart and this map returned ONLY ITS HEADER.
    #  1. The uuid is in the leveldb TABLE (`000007.ldb`), not in a `*.log` —
    #     the store holds `LOG`/`LOG.old` (plain text, no uuid) and `*.ldb`, so
    #     the old `*/*.log` glob matched nothing on every profile.
    #  2. `set -euo pipefail` is on (line 43), so `grep` finding nothing exits 1
    #     and KILLED THE WHOLE SCRIPT at the first profile — after the header had
    #     already printed. ⇒ Header-plus-nothing read as "no browsers are
    #     registered" when it actually meant "this function aborted". Hence the
    #     `|| true`: a profile with no uuid must print "(never connected)" and
    #     let the loop continue.
    # ⛔ A uuid ON DISK IS NOT A LIVE POINTER, and this function used to present
    #    one as if it were. The store ACCUMULATES uuids across launches: the
    #    extension mints a new one each time Chrome starts, and the previous
    #    ones stay behind in compacted .ldb files. MEASURED 2026-10-12 09:18 —
    #    claudelogin's store held exactly one findable uuid, bb94966c, which had
    #    DISCONNECTED at 03:17:52, while the live connection was 018237f9. With
    #    one candidate the old code took the `1)` branch and printed the dead id
    #    with no qualifier. `agents` was about to pin a login call to it.
    # ⇒ Two changes: prefer the uuid from the NEWEST store file, and cross-check
    #    every answer against the server's live registry. A stale id is now
    #    labelled, never returned bare. Disk alone cannot say which live
    #    connection belongs to which site, so when it disagrees we say that
    #    rather than guessing.
    # ⛔ A uuid ON DISK IS NOT A LIVE POINTER, and this function used to present
    #    one as if it were. The store ACCUMULATES uuids across launches: the
    #    extension mints a new one each time Chrome starts and the previous ones
    #    stay behind in compacted .ldb files. MEASURED 2026-10-12 09:18 —
    #    claudelogin's store held exactly one findable uuid, bb94966c, which had
    #    DISCONNECTED at 03:17:52, while the live connection was 018237f9. With
    #    one candidate the old code printed the dead id with no qualifier, and
    #    `agents` was about to pin a login call to it.
    # ⇒ Collect EVERY candidate, then let the server pick: the one that is
    #    actually connected wins. Disk alone cannot rank them — an mtime sort
    #    was tried and is also wrong, because `ls -t` word-splits on the space
    #    in "Local Extension Settings" and silently yields nothing, which read
    #    as "(never connected)" for a browser that was up.
    uuids="$( { strings "$store"/*/* 2>/dev/null \
            | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
            || true; } | awk '!seen[$0]++')"
    live=""
    # ⭐ The file written at launch is better evidence than anything on disk in
    #    the profile: it was recorded when the mapping was unambiguous. Still
    #    cross-checked against the server — a recorded id from a browser that
    #    has since died must not be handed out either.
    rec="$(cat "$(extid_file "$name")" 2>/dev/null || true)"
    if [ -n "$rec" ] && printf '%s' "$LIVE_IDS" | grep -qxF "$rec"; then
      live="$rec"
    fi
    for u in $uuids; do
      [ -n "$live" ] && break
      if printf '%s' "$LIVE_IDS" | grep -qxF "ext_$u"; then live="ext_$u"; break; fi
    done
    n="$(printf '%s' "$uuids" | grep -c . || true)"
    if [ -n "$live" ]; then
      printf '%-15s %s\n' "$name" "$live"
    elif [ "$n" = "0" ]; then
      printf '%-15s %s\n' "$name" "(never connected)"
    else
      printf '%-15s %s\n' "$name" "⛔ STALE, none of $n stored id(s) is connected — use the live registry"
    fi
  done
}

cmd_place() { # re-tile a RUNNING site onto its slot, without restarting it
  require_display
  # ⭐ Window geometry is an X operation, not input: no pointer moves, nothing
  # is clicked, and a logged-in browser keeps its session. That is why this
  # exists rather than down/up — once these profiles hold logins, restarting
  # to re-tile would be the expensive way to move a window.
  local name="$1" mon slot geo w h x y pid wid placed=0
  mon="$(site_field "$name" monitor)" || { echo "unknown site: $name" >&2; return 1; }
  slot="$(site_field "$name" slot)"
  pid="$(running_pid "$(profile_dir "$name")" || true)"
  [ -n "$pid" ] || { echo "$name: not running"; return 0; }
  geo="$(slot_geometry "$mon" "$slot")"; read -r w h x y <<<"$geo"
  # ⚠️ Chrome owns several X windows per process; only the named visible one is
  # the browser frame. Moving an unnamed one silently does nothing useful.
  # ⚠️ A MINIMIZED SITE HAS NO VISIBLE WINDOW, so since minimize-at-launch became
  # permanent (Ben, #scripts 2026-10-15) this reports "no visible window found"
  # for a browser that is perfectly healthy. That is not a fault. To re-tile one,
  # un-minimize it first: `xdotool windowactivate <wid>`, then `place`, then
  # `minimize-at-launch` takes over again on the next relaunch.
  for wid in $(xdotool search --pid "$pid" --onlyvisible 2>/dev/null); do
    [ -n "$(xdotool getwindowname "$wid" 2>/dev/null)" ] || continue
    xdotool windowsize "$wid" "$w" "$h" 2>/dev/null || continue
    xdotool windowmove "$wid" "$x" "$y" 2>/dev/null || continue
    placed=1
  done
  if [ "$placed" = "1" ]; then echo "$name: placed on $mon $slot (${w}x${h}+${x}+${y})"
  else echo "$name: no visible window found for pid $pid" >&2; fi
}

cmd_down() { # graceful; never a pattern kill
  local name="$1" dir pid
  dir="$(profile_dir "$name")"
  pid="$(running_pid "$dir" || true)"
  [ -n "$pid" ] || { echo "$name: not running"; return 0; }
  # ⛔ The pid came from matching this one profile path, and TERM lets Chrome
  # flush its cookie jar and session. A pattern kill here would take every
  # Chrome on the box, including Ben's.
  echo "$name: TERM $pid"
  kill -TERM "$pid"
  if wait_for_exit "$pid" 20; then
    echo "$name: exited"
  else
    # Deliberately NOT escalated to KILL: a Chrome that will not go on TERM is
    # usually mid-flush of its cookie jar, and the profile IS the asset here.
    echo "$name: ⚠️ still alive 20s after TERM — do NOT 'up' it yet, a launch now would hand off to it" >&2
    return 1
  fi
}

case "${1:-}" in
  monitors) cmd_monitors ;;
  map)      cmd_map ;;
  list)     cmd_list ;;
  place)    shift; [ $# -ge 1 ] || { echo "usage: $0 place <site|all>" >&2; exit 2; }
            if [ "$1" = "all" ]; then for row in "${SITES[@]}"; do cmd_place "${row%%|*}"; done
            else for s in "$@"; do cmd_place "$s"; done; fi ;;
  up)       shift; [ $# -ge 1 ] || { echo "usage: $0 up <site|all>" >&2; exit 2; }
            if [ "$1" = "all" ]; then
              for row in "${SITES[@]}"; do cmd_up "${row%%|*}"; sleep 2; done
            else
              for s in "$@"; do cmd_up "$s"; done
            fi ;;
  down)     shift; [ $# -ge 1 ] || { echo "usage: $0 down <site>" >&2; exit 2; }
            for s in "$@"; do cmd_down "$s"; done ;;
  *)
    cat <<USAGE
usage: $0 {monitors|list|up <site|all>|down <site>}

  monitors        live xrandr geometry for office's 8 outputs
  list            every configured site: monitor, slot, running pid, profile state
  map             site -> extensionId, read from each profile
  up <site>       launch that site's browser on its half-monitor slot (idempotent)
  place <site>    re-tile a RUNNING site without restarting it
  up all          launch every site, 2s apart
  down <site>     SIGTERM that site's browser so it flushes cookies

Profiles: $PROFILES_ROOT/<site>   (host-local to office; never deleted by this script)
Logs:     $LOG_DIR/<site>.log
USAGE
    exit 2 ;;
esac
