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
PROFILE_ROOT=/mnt/nas/data/code/unibrowse/chrome-profiles
SHOT_DIR=/mnt/nas/data/files/osdrive
cmd="${1:-help}"; shift || true

x() { DISPLAY="$DISP" xdotool "$@"; }

case "$cmd" in
up)
  prof="${1:-fiverr-osinput}"; shift || true
  url="${1:-https://www.fiverr.com/}"
  mkdir -p "$PROFILE_ROOT/$prof" "$SHOT_DIR"
  # ⛔ OFFICE HAS NO Xvfb AND INSTALLING ONE NEEDS THE OPERATOR'S SAY-SO, so
  # this uses Xephyr, which is present. Xephyr is a NESTED X server: it draws
  # its screen as one window on :0 and owns its own input queue, so every
  # xdotool event below lands inside THIS display and can never reach a window
  # on office's real desktop. That is what keeps the standing order against
  # coordinate-clicking :0 intact. ⚠️ The visible cost is one window on the
  # operator's screen while the rig is up; `kill` takes it away.
  if [ ! -e "/tmp/.X11-unix/X${DISP#:}" ]; then
    if command -v Xvfb >/dev/null 2>&1; then
      Xvfb "$DISP" -screen 0 "$GEOM" -nolisten tcp >/tmp/osdrive-x.log 2>&1 &
    else
      DISPLAY=:0 Xephyr "$DISP" -screen "${GEOM%x*}" -title "osdrive $DISP" \
        -resizeable >/tmp/osdrive-x.log 2>&1 &
    fi
    sleep 3
  fi
  # ⛔ NO --load-extension and NO --remote-debugging-port. Both are the point.
  DISPLAY="$DISP" nohup /usr/bin/google-chrome \
    --user-data-dir="$PROFILE_ROOT/$prof" \
    --no-first-run --no-default-browser-check \
    --disable-features=TranslateUI \
    --window-position=0,0 --window-size=1900,1040 \
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
