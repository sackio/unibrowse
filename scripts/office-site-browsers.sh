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
# ⛔ CHROME 155 IGNORES --load-extension UNLESS YOU ALSO DISABLE
# DisableLoadExtensionCommandLineSwitch, AND IT FAILS SILENTLY. MEASURED here
# 2026-10-10: the first contra launch came up fine, placed correctly, looking
# healthy — and its profile's Preferences held only Chrome's three built-in
# component extensions. No unibrowse, no error, no clue in the log. A browser
# that launches and never connects is the worst shape this can fail in.
# ⚠️ Both features go in ONE --disable-features flag; a second one does not
# merge with the first.
# ⚠️ scripts/launch-chrome-isolated.sh still lacks this and will hit it on any
# host whose Chrome is current; the container sidecars are unaffected only
# because they run an older Chromium.
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
    # ⚠️ Idempotent on purpose. A second Chrome on the same --user-data-dir does
    # NOT start a second browser; it hands the URL to the running one and exits,
    # which looks like success and silently does something else.
    echo "$name: already up (pid $pid) — leaving it alone"
    return 0
  fi

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
}

cmd_map() { # site -> the extensionId the server knows it by
  # ⭐ The extension stores its own server-facing uuid in the profile, so the
  # map is derivable from disk and needs no guessing from tab URLs. Asked for
  # by `freelance` 2026-10-10 20:36, who could see 8 identical-looking
  # docker-host-desktop connections and no way to tell which site each was.
  local row name store uuid
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
    uuid="$( { strings "$store"/*/* 2>/dev/null \
            | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
            || true; } | sort -u | head -2 | tr '\n' ' ')"
    case "$(echo $uuid | wc -w)" in
      0) printf '%-15s %s\n' "$name" "(never connected)" ;;
      1) printf '%-15s ext_%s\n' "$name" "$(echo $uuid)" ;;
      *) printf '%-15s %s\n' "$name" "AMBIGUOUS: $uuid" ;;
    esac
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
