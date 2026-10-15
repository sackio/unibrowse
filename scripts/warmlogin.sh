#!/usr/bin/env bash
# Warm-sessions login helper — runs on server3's HOST, drives the
# `unibrowse-warm` container's Chrome on display :98.
#
# ⭐ WHY IT EXISTS. Ben, Slack #unibrowse 2026-10-15, after I recommended he
# type his own passwords through a live relay instead: "no I definitely want to
# give you my password credentials and I'll take them here ... and I do want you
# to that report credentials appropriate env files". So: he hands them over, they
# live in ONE mode-600 env file, and this script is the only thing that reads it.
#
# ⛔ THE WHOLE POINT OF THIS SCRIPT IS THAT A PASSWORD NEVER REACHES argv.
# `osdrive.sh type <value>` would work and is wrong here: a container's command
# line is readable in the host's `ps` by every user on server3 — i.e. by every
# agent seat on it — and it lands in shell history too. `secret` reads the value
# into a shell variable and pipes it through a BUILTIN printf into
# `osdrive.sh type-secret`, which types from stdin. Nothing in ps, nothing on
# disk, nothing echoed.
# ⛔ Do not add a `--password` flag, do not `export` it, and do not pass it to
# `docker exec -e`. All three put the value somewhere another seat can read it.
#
# ⛔ IT ALSO NEVER PRINTS A VALUE. `keys` lists NAMES. If you need to know
# whether a credential is right, try it in the browser and read the screenshot —
# do not echo it to find out.
#
# ⚠️ The env file is HOST-LOCAL to server3 by design, NOT on the NAS. Mode 600
# on the NAS would still be readable by every seat running as `ben` on four
# hosts; on server3's own disk it is readable by seats on one host. That is a
# reduction, not privacy — see the note in docker-compose.yml's `warm` service.
set -euo pipefail

ENVFILE="${WARM_ENV_FILE:-/home/ben/.secrets/unibrowse-warm.env}"
CONTAINER="${WARM_CONTAINER:-unibrowse-warm}"
PROFILE="${WARM_PROFILE:-warm-shopping}"
DISP="${WARM_DISPLAY:-:98}"

# Read one key WITHOUT sourcing the file. `source` would execute whatever is in
# it, and this file is written by hand from a chat message.
getval() {
  local k="$1" v
  v="$(sed -n "s/^[[:space:]]*${k}=//p" "$ENVFILE" | head -1)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

in_container() { docker exec -e DISPLAY="$DISP" "$CONTAINER" "$@"; }

# ⚠️ The lock scripts/warm-keepalive.sh respects. Held only while a `login`
# runs, so an unattended keepalive cycle cannot navigate out from under a
# half-typed password.
lock_acquire() { mkdir "${WARM_LOCK:-/tmp/warm-drive.lock}" 2>/dev/null; }
lock_release() { rmdir "${WARM_LOCK:-/tmp/warm-drive.lock}" 2>/dev/null || true; }

cmd="${1:-help}"; shift || true
case "$cmd" in

init)
  if [ ! -f "$ENVFILE" ]; then
    install -d -m 700 "$(dirname "$ENVFILE")"
    : > "$ENVFILE"; chmod 600 "$ENVFILE"
    echo "created empty $ENVFILE (mode 600) — no credentials in it yet"
  fi
  perm="$(stat -c %a "$ENVFILE")"
  [ "$perm" = "600" ] || { echo "⛔ $ENVFILE is mode $perm, expected 600"; exit 1; }
  echo "env=$ENVFILE mode=$perm owner=$(stat -c %U "$ENVFILE")"
  "$0" keys
  ;;

keys)   # NAMES only, never values.
  if [ -s "$ENVFILE" ]; then
    sed -n 's/^[[:space:]]*\([A-Z0-9_]*\)=.*/\1/p' "$ENVFILE" | sort | tr '\n' ' '; echo
  else
    echo "(no keys yet)"
  fi
  ;;

secret) # secret KEY [delay-ms] — type that credential into the focused field.
  k="${1:?usage: warmlogin.sh secret KEY [delay]}"; d="${2:-70}"
  v="$(getval "$k")"
  [ -n "$v" ] || { echo "⛔ $k is not set in $ENVFILE"; exit 1; }
  printf '%s' "$v" | docker exec -i -e DISPLAY="$DISP" "$CONTAINER" \
      osdrive.sh type-secret "$d"
  echo "typed $k (${#v} chars)"
  ;;

up)     # up [url] — start Chrome on :98 with the warm profile.
  in_container osdrive.sh up "$PROFILE" "${1:-https://www.amazon.com/}"
  ;;

go)     # go URL — focus the address bar and navigate.
  in_container osdrive.sh key ctrl+l; sleep 0.3
  in_container osdrive.sh type "$1" 30; sleep 0.2
  in_container osdrive.sh key Return
  ;;

shot)   # shot — PNG to stdout. ⛔ Never into /mnt/nas: a screenshot of this
        # browser shows a logged-in retail account, and the NAS is fleet-readable.
  f="/app/shots/warm-$(date +%H%M%S).png"
  in_container osdrive.sh shot "$f" >/dev/null
  docker exec "$CONTAINER" cat "$f"
  ;;

login)  # login SITE — the whole sign-in, keyboard-only. SITE: amazon|ebay|doordash
        # ⭐ KEYBOARD-ONLY, NOT COORDINATES, and that is measured rather than
        # tidy: Amazon's /ap/signin AUTOFOCUSES the email field — a probe string
        # typed with zero clicks landed in it (server3, 2026-10-15). Coordinates
        # would re-break on every layout change; focus order does not.
        # ⚠️ An Escape precedes each submit. Chrome's passkey/autofill bubble
        # opens OVER the Continue button, so a click there hits the bubble; with
        # the bubble dismissed, Return submits the form.
  site="${1:?usage: warmlogin.sh login amazon|ebay|doordash}"
  # FOCUS_XY / SUBMIT_XY empty  ⇒  the page autofocuses its field and Return
  # submits. Set  ⇒  this site does NOT autofocus and needs a real click.
  # ⚠️ MEASURED PER SITE 2026-10-15, because the two behave differently and
  # assuming either way loses a password into whatever had focus:
  #   amazon  /ap/signin  AUTOFOCUSES  (probe string landed with zero clicks)
  #   ebay    /signin/    DOES NOT     (probe went nowhere; field stayed empty)
  # ⇒ A site whose coordinates are set is a site whose layout can move. If a
  # shot shows an empty field after `login`, re-measure the coordinates; do not
  # retry the macro, because a retry types the password again with no target.
  FOCUS_XY=""; SUBMIT_XY=""
  case "$site" in
    amazon)   url="https://www.amazon.com/gp/sign-in.html"; U=AMAZON_EMAIL;   P=AMAZON_PASSWORD ;;
    ebay)     url="https://signin.ebay.com/signin/";        U=EBAY_EMAIL;     P=EBAY_PASSWORD
              FOCUS_XY="950 345"; SUBMIT_XY="950 409" ;;
    doordash) url="https://www.doordash.com/consumer/login/"; U=DOORDASH_EMAIL; P=DOORDASH_PASSWORD ;;
    *) echo "⛔ unknown site: $site"; exit 1 ;;
  esac
  [ -n "$(getval "$U")" ] || { echo "⛔ $U is not set in $ENVFILE — nothing to log in with"; exit 1; }
  [ -n "$(getval "$P")" ] || { echo "⛔ $P is not set in $ENVFILE"; exit 1; }

  focus() { [ -n "$FOCUS_XY" ] && { in_container osdrive.sh move $FOCUS_XY 400 >/dev/null
                                     in_container osdrive.sh click 1 >/dev/null; sleep 1; }; true; }
  submit() {
    in_container osdrive.sh key Escape >/dev/null; sleep 0.2
    if [ -n "$SUBMIT_XY" ]; then
      in_container osdrive.sh move $SUBMIT_XY 350 >/dev/null
      in_container osdrive.sh click 1 >/dev/null
    else
      in_container osdrive.sh key Return >/dev/null
    fi
  }

  lock_acquire || echo "⚠️ another driver holds ${WARM_LOCK:-/tmp/warm-drive.lock} — continuing anyway"
  trap lock_release EXIT
  "$0" go "$url" >/dev/null; sleep 7
  in_container osdrive.sh key Escape >/dev/null; sleep 0.2
  focus
  "$0" secret "$U" >/dev/null
  submit; sleep 7
  focus
  "$0" secret "$P" >/dev/null
  submit; sleep 9
  # ⛔ THE ONLY HONEST SUCCESS SIGNAL HERE IS A HUMAN-READ SCREENSHOT. There is
  # no DOM to query — no extension, no CDP — so a title match is a HINT, never
  # proof. ⚠️ It fails toward "fine": a captcha page and a signed-in page can
  # share a title. Read the shot before believing a login worked.
  echo "window title: $(in_container osdrive.sh title 2>/dev/null | head -2 | tr '\n' ' ')"
  echo "⇒ read the screenshot: warmlogin.sh shot > /tmp/x.png"
  # ⚠️ EXPECT TO STOP HERE ON EBAY. MEASURED 2026-10-15: username → Continue
  # returns "Please verify yourself to continue" with an hCaptcha "I am human"
  # checkbox, BEFORE the password is ever asked for. ⛔ We do not tick it —
  # `warmlogin.sh relay` hands the display to Ben and he ticks it himself.
  ;;

relay)  # relay [ttl-seconds] — show display :98 to Ben so HE solves the
        # captcha or types the 2FA code, with his own pointer and keystrokes.
        # ⛔ NOT a way to answer a bot check ourselves. Ben's standing order and
        # osrelay.py's own header: this replays a HUMAN's gesture. An agent does
        # not drive the widget.
        # ⛔ Whoever holds the URL can move the mouse and press keys in a browser
        # holding Ben's cards. Short TTL, and `relay stop` when the solve lands.
  if [ "${1:-}" = "stop" ]; then
    pid="$(docker exec "$CONTAINER" cat /tmp/osrelay-98.pid 2>/dev/null || true)"
    if [ -n "$pid" ] && docker exec "$CONTAINER" grep -q osrelay "/proc/$pid/cmdline" 2>/dev/null; then
      # Literal pid, read from the pidfile and verified against its own cmdline.
      # ⛔ Never `pkill -f osrelay` here: a pattern kill matches its own shell.
      docker exec "$CONTAINER" kill "$pid" && echo "relay stopped (pid $pid)"
    else
      echo "no relay running"
    fi
    exit 0
  fi
  ttl="${1:-900}"
  # ⭐ REUSE THE TOKEN ON A RESTART OR BEN'S LINK DIES. The ATC artifact proxies
  # to /r/<token>/, so a fresh token 404s the page he already has open, and the
  # failure looks like the relay being down rather than the URL having moved.
  #   OSRELAY_TOKEN=<the old one> warmlogin.sh relay
  docker exec -d -e DISPLAY="$DISP" -e OSRELAY_TOKEN="${OSRELAY_TOKEN:-}" "$CONTAINER" sh -c \
    "python3 /usr/local/bin/osrelay.py --display $DISP --port 9702 --bind 0.0.0.0 --ttl $ttl \
       --notify ${WARM_NOTIFY:-unibrowse} \
       --prompt 'Solve this and sign in — your own taps and keystrokes' \
       >/tmp/osrelay-98.log 2>&1 & echo \$! > /tmp/osrelay-98.pid"
  sleep 3
  docker exec "$CONTAINER" cat /tmp/osrelay-98.log 2>/dev/null | head -8
  echo "⇒ front it with an ATC artifact: proxy http://192.168.0.103:9702/r/<token>/"
  ;;

x)      # x ARGS... — any other osdrive.sh subcommand (move/click/key/type/...).
  in_container osdrive.sh "$@"
  ;;

*) sed -n '1,30p' "$0" ;;
esac
