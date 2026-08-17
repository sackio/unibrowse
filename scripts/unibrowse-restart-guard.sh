#!/usr/bin/env bash
# unibrowse-restart-guard — show what a mcp-server restart would destroy,
# BEFORE it is destroyed.
#
# WHY THIS EXISTS
# ---------------
# `docker compose restart mcp-server` resets every attached tab and every tab
# reservation, LAN-wide. That cost is invisible at the moment you decide to pay
# it: nothing in the restart command, and nothing anyone runs beforehand, says
# how many seats are mid-task or what is in those tabs.
#
# It bit twice in two days, both times on the same tab:
#   2026-08-16  a 1006 drop on Laura's MacBook destroyed a filled, unsubmitted
#               Semantic Scholar API-key form. `genomics` re-filled it.
#   2026-08-17  I proposed a restart to deploy an identity fix while that
#               re-filled form was again sitting unsubmitted, waiting on a
#               human. `genomics` had to catch it and ask me to hold.
#
# ⛔ A filled-but-unsubmitted form lives ONLY in the tab. A restart destroys it
# with no error, no log line, and no way to tell afterwards that it happened —
# the tab simply comes back detached and empty-handed. The agent that owns it
# finds out by re-reading the page, if it thinks to.
#
# This script cannot preserve that state. It makes the cost VISIBLE before the
# decision, which is the half that is actually mine to fix — a network drop is
# not preventable from here, but a planned restart absolutely is.
#
# ⚠️ WHAT IT CANNOT TELL YOU. There is no "this tab has unsaved work" flag
# today — reservations live extension-side and carry an owner, not a state. So
# a reserved tab here means "some agent is mid-task", NOT "this is safe to
# kill because nothing says otherwise". ⭐ ABSENCE OF A WARNING IS NOT
# PERMISSION. When tabs are reserved, ASK THEIR OWNERS. The follow-up that
# would close this properly is a `dirty`/`note` field on the reservation, which
# needs an extension change and therefore a browser reload to deploy.
#
# USAGE
#   unibrowse-restart-guard.sh            # report; exit 1 if anything is attached
#   unibrowse-restart-guard.sh --quiet    # only output when something is at risk
#
# Exit 0 = nothing attached, restart is free.
# Exit 1 = tabs are attached; read the list and ask their owners first.
# Exit 2 = server unreachable (so the restart is moot, or it is already down).

set -uo pipefail

SERVER="${UNIBROWSE_SERVER:-http://localhost:9010}"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
log() { [ "$QUIET" -eq 1 ] || echo "$@"; }

resp="$(curl -s -m 10 "$SERVER/extensions" 2>/dev/null)"
if [ -z "$resp" ]; then
  echo "[guard] mcp-server unreachable at $SERVER — cannot tell what a restart would cost."
  echo "        That is NOT a green light. If the server is already down, the tabs are already gone;"
  echo "        if this is a probe failure, you are about to restart blind."
  exit 2
fi

printf '%s' "$resp" | python3 -c "$(cat <<'PY'
import sys, json

try:
    d = json.load(sys.stdin)
except Exception:
    print("[guard] /extensions did not return JSON — restarting blind. Stop and look.")
    raise SystemExit(2)

conns = d.get("connected", []) or []
total = sum(int(c.get("tabCount") or 0) for c in conns)

if total == 0:
    print("[guard] no attached tabs across %d connected browser(s) — a restart costs nothing." % len(conns))
    raise SystemExit(0)

print("⛔ A RESTART WOULD DETACH AT LEAST %d TAB(S) across %d browser(s):" % (total, len(conns)))
print("⚠️  AT LEAST — this is the SERVER's view (conn.tabIds), which undercounts.")
print("   Measured 2026-08-17: this said 3 while browser_list_attached_tabs said 8.")
print("   The server only knows about tabs it saw TAB_ATTACHED for; anything attached")
print("   before it learned of the extension is missing here. Treat the number as a")
print("   floor and get the real list from browser_list_attached_tabs.")
for c in conns:
    n = int(c.get("tabCount") or 0)
    if not n:
        continue
    up = round(int(c.get("connectedForMs") or 0) / 60000)
    print("  %-46s %-20s %2d tab(s)  connected %smin"
          % (c.get("extensionId"), c.get("kind"), n, up))
print("")
print("Every one of those loses its attachment AND its reservation. Anything typed into a")
print("form and not submitted is destroyed silently — no error, no log line, and the owning")
print("agent will not be told.")
print("")
print("⭐ Nothing here marks a tab as carrying unsaved work, so this list CANNOT tell you a")
print("   restart is safe. Ask the owners. Reservation owners are in:")
print("     browser_list_attached_tabs  →  tabs[].reservation.owner")
raise SystemExit(1)
PY
)"
rc=$?
[ $rc -eq 0 ] && log "[guard] clear."
exit $rc
