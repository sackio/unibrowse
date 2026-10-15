#!/usr/bin/env bash
# OS-input browser rig — a real Chrome with NO unibrowse extension and NO
# debugger, driven only by XTEST (xdotool) and read by X screenshots.
#
# ⭐ WHY IT EXISTS. Ben, Slack #freelance 2026-10-12 18:26, directing that
# Fiverr be driven "like you're helping someone who can't physically use the
# site themselves". Everything unibrowse normally uses — CDP input, the
# debugger, the extension — is absent here by design, so the browser is
# indistinguishable from one a person is sitting at.
#
# ⛔ DISPLAY :97, NEVER :0. Office's real desktop is :0 and a standing order
# forbids coordinate-clicking it: ~40 seats share this host and a blind click
# there lands in whatever window the operator left focused. A dedicated Xvfb
# display honours that order and still gives real OS input.
#
# ⛔ WHAT THIS CANNOT DO: vary pointer PRESSURE. XTEST has no force channel —
# Chrome reports pressure 0.5 for any mouse button that is down, real or XTEST,
# and 0 when it is up. That is already the correct value (measured 2026-10-09:
# XTEST gave 0.5 where CDP gave 0), so nothing needs varying. Carrying a
# phone's touch force onto a mouse pointer would mean presenting a fake
# touchscreen to the browser, which is hardware spoofing and is not built here.
#
# ⛔ NOT FOR ANSWERING A CAPTCHA ON OUR OWN JUDGEMENT. `path` exists to replay
# a GESTURE A HUMAN MADE, from the captcha relay. An agent must not drive a
# bot-check widget itself.
set -euo pipefail
DISP="${OSDRIVE_DISPLAY:-:97}"
GEOM="${OSDRIVE_GEOM:-1920x1080x24}"
# ⭐ Overridable so this same script runs inside a container, where neither NAS
# path exists. Defaults are office's, so nothing changes for the existing rig.
# ⛔ DO NOT POINT PROFILE_ROOT AT /mnt/nas IN A CONTAINER. A Chrome profile is
# LevelDB plus SQLite and both corrupt over NFS; the profile belongs on local
# disk (a docker volume), and only SHOT_DIR is safe on the NAS.
PROFILE_ROOT="${OSDRIVE_PROFILE_ROOT:-/mnt/nas/data/code/unibrowse/chrome-profiles}"
SHOT_DIR="${OSDRIVE_SHOT_DIR:-/mnt/nas/data/files/osdrive}"
CHROME_BIN="${OSDRIVE_CHROME:-/usr/bin/google-chrome}"
# ⭐ EXTRA FLAGS, EMPTY BY DEFAULT SO OFFICE'S RIG IS UNCHANGED. The container
# rig sets --use-angle=swiftshader --enable-unsafe-swiftshader, without which
# Chrome reports "WebGL1 blocklisted" under Xvfb and the page sees NO WebGL at
# all — a desktop browser with zero WebGL is a stranger thing to an anti-bot
# gate than a driven one, because no real desktop presents that way.
# ⛔ Do not make this a default: on a host WITH a GPU the same flags force
# software rendering, which is a worse fingerprint, not a better one.
OSDRIVE_CHROME_EXTRA_ARGS="${OSDRIVE_CHROME_EXTRA_ARGS:-}"
cmd="${1:-help}"; shift || true

x() { DISPLAY="$DISP" xdotool "$@"; }

case "$cmd" in
up)
  prof="${1:-fiverr-osinput}"; shift || true
  url="${1:-https://www.fiverr.com/}"
  mkdir -p "$PROFILE_ROOT/$prof" "$SHOT_DIR"
  # ⛔ A PROFILE THAT MOVED HOSTS CARRIES A LOCK THAT NAMES THE OLD ONE, and
  # Chrome then refuses to start with "The profile appears to be in use by
  # another Google Chrome process" — which reads as "something else is running"
  # when nothing is. MEASURED 2026-10-15 moving fiverr-osinput to server3:
  # SingletonLock is a symlink to <hostname>-<pid>, and both were office's.
  # Same cause after any unclean exit. Paths are literal and inside the profile
  # we are about to launch, so this cannot reach anything else.
  for lock in SingletonLock SingletonSocket SingletonCookie; do
    rm -f "$PROFILE_ROOT/$prof/$lock"
  done
  # ⛔ OFFICE HAS NO Xvfb AND INSTALLING ONE NEEDS THE OPERATOR'S SAY-SO, so
  # this uses Xephyr, which is present. Xephyr is a NESTED X server: it draws
  # its screen as one window on :0 and owns its own input queue, so every
  # xdotool event below lands inside THIS display and can never reach a window
  # on office's real desktop. That is what keeps the standing order against
  # coordinate-clicking :0 intact. ⚠️ The visible cost is one window on the
  # operator's screen while the rig is up; `kill` takes it away.
  # ⛔ A SOCKET FILE IS NOT A LIVE X SERVER, and treating it as one takes the whole
  # rig PERMANENTLY dark. MEASURED 2026-10-15 on unibrowse-warm: /tmp/.X11-unix/X98
  # outlived its Xvfb by 6 minutes, so an `-e` test skipped the launch and every
  # Chrome start after it died with "Missing X server or $DISPLAY" for 18 minutes.
  # The keepalive logged "Chrome did not start", which names the symptom and hides
  # the cause — this is the failure-toward-"something else is wrong" shape.
  # ⇒ PROBE THE DISPLAY, and clear the corpse, because Xvfb refuses to replace it
  # ("Server is already active for display N") and that reads as a running server.
  # ⚠️ The rm is bounded by the case: $DISP is a display number, never a path.
  if ! DISPLAY="$DISP" xdotool getdisplaygeometry >/dev/null 2>&1; then
    case "$DISP" in
      :[0-9]|:[0-9][0-9]) rm -f "/tmp/.X11-unix/X${DISP#:}" ;;
    esac
    if command -v Xvfb >/dev/null 2>&1; then
      Xvfb "$DISP" -screen 0 "$GEOM" -nolisten tcp >/tmp/osdrive-x.log 2>&1 &
    else
      DISPLAY=:0 Xephyr "$DISP" -screen "${GEOM%x*}" -title "osdrive $DISP" \
        -resizeable >/tmp/osdrive-x.log 2>&1 &
    fi
    sleep 3
  fi
  # ⛔ NO --load-extension and NO --remote-debugging-port. Both are the point.
  # ⛔ --password-store=basic IS LOAD-BEARING WHEN THE PROFILE IS PORTABLE.
  # MEASURED 2026-10-15 on fiverr-osinput: all 397 cookies carry the `v10`
  # prefix and Local State has no os_crypt.encrypted_key, i.e. they are sealed
  # with Chrome's fixed no-keyring key and therefore decrypt on any machine.
  # Letting Chrome find a keyring instead would re-seal new cookies as `v11`
  # and quietly make the profile non-portable — and the breakage would appear
  # on the NEXT move, not this one.
  DISPLAY="$DISP" nohup "$CHROME_BIN" \
    --user-data-dir="$PROFILE_ROOT/$prof" \
    --password-store=basic \
    --no-first-run --no-default-browser-check \
    --disable-features=TranslateUI \
    --window-position=0,0 --window-size=1900,1040 \
    $OSDRIVE_CHROME_EXTRA_ARGS \
    "$url" >/tmp/osdrive-chrome.log 2>&1 &
  sleep 8
  echo "display=$DISP profile=$PROFILE_ROOT/$prof"
  x search --onlyvisible --class chrome 2>/dev/null | head -3 || echo "no chrome window yet"
  ;;
title)   x search --onlyvisible --class chrome 2>/dev/null | while read -r w; do x getwindowname "$w"; done ;;
shot)
  out="${1:-$SHOT_DIR/osdrive-$(date +%H%M%S).png}"
  DISPLAY="$DISP" import -window root "$out"
  echo "$out"
  ;;
move)  # move X Y [ms] — eased, with jitter, like a hand rather than a teleport
  tx="$1"; ty="$2"; ms="${3:-350}"
  read -r cx cy < <(x getmouselocation --shell | sed -n 's/^X=//p;s/^Y=//p' | paste -sd' ')
  steps=$(( ms / 16 )); [ "$steps" -lt 6 ] && steps=6
  for i in $(seq 1 "$steps"); do
    f=$(awk -v i="$i" -v n="$steps" 'BEGIN{t=i/n; print (t<0.5? 2*t*t : 1-(-2*t+2)^2/2)}')
    nx=$(awk -v a="$cx" -v b="$tx" -v f="$f" 'BEGIN{printf "%d", a+(b-a)*f + (rand()*2-1)*1.5}')
    ny=$(awk -v a="$cy" -v b="$ty" -v f="$f" 'BEGIN{printf "%d", a+(b-a)*f + (rand()*2-1)*1.5}')
    x mousemove "$nx" "$ny"; sleep 0.016
  done
  x mousemove "$tx" "$ty"
  ;;
click) x click "${1:-1}" ;;
hold)  # hold X Y MS — press, keep the button down, release. A human's gesture.
  tx="$1"; ty="$2"; ms="$3"
  "$0" move "$tx" "$ty" 400
  x mousedown 1
  end=$(( $(date +%s%3N) + ms ))
  while [ "$(date +%s%3N)" -lt "$end" ]; do
    x mousemove_relative -- "$(( RANDOM % 3 - 1 ))" "$(( RANDOM % 3 - 1 ))"
    sleep 0.03
  done
  x mousemove "$tx" "$ty"; x mouseup 1
  ;;
drag)  # drag X1 Y1 X2 Y2 [ms]
  "$0" move "$1" "$2" 300; x mousedown 1; sleep 0.08
  "$0" move "$3" "$4" "${5:-600}"; sleep 0.06; x mouseup 1
  ;;
type)  x type --clearmodifiers --delay "${2:-90}" -- "$1" ;;
# ⭐ type-secret — TYPE A PASSWORD WITHOUT THE VALUE EVER REACHING argv.
# `type` puts its argument on the command line, and a container's command line
# is readable in the HOST's `ps` by every user on that host, plus `docker
# inspect` and the shell history of whoever ran it. This variant reads the value
# from STDIN and hands it to xdotool's own --file - , so it exists only in a
# pipe: nothing to find in ps, nothing written to disk, nothing echoed back.
# ⛔ Never "improve" this into `type-secret <value>`. The argv form is the leak.
# ⚠️ The trailing newline is stripped deliberately — xdotool would type it as
# Return and submit the form before the next field is filled.
#   usage:  printf %s "$pw" | osdrive.sh type-secret [delay]
type-secret)
       tr -d '\r\n' | x type --clearmodifiers --delay "${1:-90}" --file - ;;
key)   x key --clearmodifiers -- "$1" ;;
wheel) n="${1:-3}"; b=4; [ "$n" -lt 0 ] && { b=5; n=$(( -n )); }
       for _ in $(seq 1 "$n"); do x click "$b"; sleep 0.12; done ;;
path)  # path FILE — replay a human gesture: JSON [{x,y,ms,down}] in order
       python3 - "$1" <<'PY'
import json,os,subprocess,sys,time
disp=os.environ.get("OSDRIVE_DISPLAY",":97")
pts=json.load(open(sys.argv[1]))
def xd(*a): subprocess.run(["xdotool",*a],env={**os.environ,"DISPLAY":disp},check=False)
t0=time.time(); down=False
for p in pts:
    due=t0+p.get("ms",0)/1000.0
    d=due-time.time()
    if d>0: time.sleep(d)
    xd("mousemove",str(int(p["x"])),str(int(p["y"])))
    if p.get("down") and not down: xd("mousedown","1"); down=True
    elif p.get("down") is False and down: xd("mouseup","1"); down=False
if down: xd("mouseup","1")
print("replayed",len(pts),"points")
PY
  ;;
kill)  pkill -f "user-data-dir=$PROFILE_ROOT/${1:-fiverr-osinput}" || true; echo stopped ;;
*) sed -n '1,40p' "$0" ;;
esac
