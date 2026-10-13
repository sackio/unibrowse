#!/usr/bin/env bash
# unibrowse-restart-guard — show who a mcp-server restart will disrupt,
# BEFORE you restart.
#
# ⛔ CORRECTION, 2026-08-17, MEASURED AFTER THE FIRST VERSION SHIPPED:
# A RESTART DOES NOT DESTROY TAB STATE. The premise below was wrong, and I had
# already told four seats it was true.
#
# Measured across an actual restart: browser_list_attached_tabs returned the
# SAME 9 tabs afterwards, with reservations carrying their PRE-restart claim
# times (three different agents, claimed 08-13, 13:02 and 13:07). Attachments and
# reservations live EXTENSION-side and survive the server dying. What resets is
# the SERVER's routing bookkeeping — /extensions reported tabCount=0 for all
# four extensions while the extension list still showed 9 tabs.
#
# ⇒ The real cost of a restart is that tabTarget routing degrades until each
# extension re-announces its tabs, NOT lost form state. A filled, unsubmitted
# form survives a restart. It does NOT survive a 1006 socket drop, which is
# what actually destroyed another agent's form on 08-16 — a different failure that
# this script cannot see and cannot prevent.
#
# ⭐ The general error: I inferred "restart destroys attachments" from the
# server's own tabCount going to zero, and never checked the extension's view.
# Server-side bookkeeping resetting is not the same as the thing it books
# keeping resetting.
#
# The script is still worth running before a restart — the tab list tells you
# who is mid-task so you can ask them — but read it as "who will notice", not
# "what will be lost".
#
# WHY THIS EXISTS
# ---------------
# `docker compose restart mcp-server` drops every seat's tabTarget routing
# until extensions re-announce. That cost is invisible at the moment you decide
# to pay it: nothing in the restart command, and nothing anyone runs
# beforehand, says how many seats are mid-task.
#
# It bit twice in two days, both times on the same tab:
#   2026-08-16  a 1006 drop on a remote browser destroyed a filled, unsubmitted
#               Semantic Scholar API-key form. That agent re-filled it.
#   2026-08-17  I proposed a restart to deploy an identity fix while that
#               re-filled form was again sitting unsubmitted, waiting on a
#               human. The affected agent had to catch it and ask me to hold.
#
# ⚠️ Note what the second entry actually was, now that the premise is corrected:
# a hold I asked for on a false belief. The form was never at risk from the
# restart. They were right to flag it and I was wrong about why.
#
# ⛔ A filled-but-unsubmitted form lives ONLY in the tab, and a 1006 SOCKET DROP
# destroys it with no error, no log line, and no way to tell afterwards — the
# tab comes back detached and empty-handed, and the owning agent finds out by
# re-reading the page, if it thinks to. That failure is real; it is just not
# the one a restart causes, and this script cannot see or prevent it.
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
# Exit 0 = server tracks nothing attached (see caveat — not proof).
# Exit 1 = tabs are attached; read the list and ask their owners first.
# Exit 2 = server unreachable (so the restart is moot, or it is already down).

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="${UNIBROWSE_SERVER:-http://localhost:9010}"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
log() { [ "$QUIET" -eq 1 ] || echo "$@"; }

# ⛔ ADDED 2026-10-12 AFTER A RESTART LANDED AHEAD OF ITS OWN BUILD.
# The question "is a deploy ALREADY pending?" had no cheap answer, so nobody
# asked it. Measured tonight: the running process started 18:05:35, commit
# ca5ae92 was made at 18:05:41 and dist was built at 18:06:21 — so the process
# was six seconds older than the commit it was supposed to be carrying. The
# exemption Ben asked for at 18:01 was built, never loaded, and read as
# delivered. An auto-capture of the host he had just exempted then ran for 22
# minutes. Nothing errored.
# ⭐ This is the only reading that settles it: PROCESS START vs BUILD TIME. A
# container grep cannot, because dist/ is bind-mounted and goes green the
# instant a build finishes with the old code still in memory.
# ⚠️ PENDING here is a FLOOR, not a diagnosis. A rebuild can be comment-only
# (measured 2026-10-10 on d88d0cb), which makes this read PENDING when nothing
# functional is owed. Check `git log --stat` before concluding you must restart.
deploy_state() {
  local started dist_mtime src_commit
  started="$(docker inspect -f '{{.State.StartedAt}}' unibrowse-mcp-server 2>/dev/null)" || return 0
  [ -z "$started" ] && return 0
  started="$(date -d "$started" +%s 2>/dev/null)" || return 0
  dist_mtime="$(find "$REPO/dist" -maxdepth 2 -name '*.js' -printf '%T@\n' 2>/dev/null \
                | sort -rn | head -1 | cut -d. -f1)"
  src_commit="$(cd "$REPO" 2>/dev/null && git log -1 --format=%ct -- src/ 2>/dev/null)"
  [ -z "$dist_mtime" ] && return 0

  log ""
  log "⛔ IS A DEPLOY ALREADY PENDING?  (process start vs build time — the only reading that settles it)"
  log "   process started : $(date -d "@$started" '+%Y-%m-%d %H:%M:%S')"
  log "   newest dist/*.js: $(date -d "@$dist_mtime" '+%Y-%m-%d %H:%M:%S')"
  [ -n "$src_commit" ] && \
  log "   newest src/ commit: $(date -d "@$src_commit" '+%Y-%m-%d %H:%M:%S')"

  if [ -n "$src_commit" ] && [ "$src_commit" -gt "$dist_mtime" ]; then
    log "   ⛔ src/ WAS COMMITTED AFTER THE LAST BUILD — \`npm run build\` FIRST or you ship nothing."
  fi
  if [ "$dist_mtime" -gt "$started" ]; then
    log "   ⛔ PENDING: dist/ is $((dist_mtime - started))s NEWER than the running process."
    log "      ⇒ The process cannot have loaded that build. Whatever it contains is NOT live,"
    log "        however green a container grep looks."
    log "      ⚠️ A FLOOR, not a diagnosis — a comment-only rebuild reads identical. Confirm with:"
    log "        git log --stat --since=\"\$(date -d @$started '+%Y-%m-%d %H:%M:%S')\" -- src/"
  else
    log "   ✅ The running process is NEWER than the newest build — nothing in dist/ is stranded."
  fi
}

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
    print("[guard] server tracks no attached tabs across %d connected browser(s)." % len(conns))
    print("        ⚠️ This is the SERVER's view and it reads 0 immediately after a restart even")
    print("        while extensions still hold tabs. Confirm with browser_list_attached_tabs.")
    raise SystemExit(0)

print("⚠️  %d SEAT-VISIBLE TAB(S) across %d browser(s) — tabTarget routing degrades for these:" % (total, len(conns)))
print("⚠️  A FLOOR — this is the SERVER's view (conn.tabIds), which undercounts.")
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
print("⛔ These do NOT lose their tab state — attachments and reservations live extension-side")
print("and survive a restart (measured 2026-08-17). What degrades is the SERVER's routing")
print("bookkeeping until each extension re-announces. A filled, unsubmitted form SURVIVES a")
print("restart; it does not survive a 1006 socket drop, which is a different failure.")
print("")
print("⭐ Read this as WHO WILL NOTICE, not what will be lost. Ask the owners if any are")
print("   mid-flow. Reservation owners are in:")
print("     browser_list_attached_tabs  →  tabs[].reservation.owner")
raise SystemExit(1)
PY
)"
rc=$?
[ $rc -eq 0 ] && log "[guard] clear."

# ⛔ ADDED 2026-10-11 AFTER A MEASURED HALF-DEPLOYMENT.
# A restart is only half of shipping, and the other half fails SILENTLY, because
# code and config travel by two different mechanisms:
#   · CODE   — dist/ is bind-mounted, so `restart` picks up whatever `npm run build`
#              last wrote. No build ⇒ no new code.
#   · CONFIG — `restart` reuses the EXISTING container's environment and never
#              re-reads docker-compose.yml. Only `up -d` recreates it.
# Measured 16:21 EDT shipping 1fc5291: build + restart put the new code in the
# running container while UNIBROWSE_SCREENSHOT_DIR stayed EMPTY, so the code took
# its `|| "/tmp"` fallback — the exact bug the change existed to fix. The code grep
# said SUCCESS. Nothing errored, nothing was broken, and nothing shipped.
# ⭐ The general error: verifying one of two independent mechanisms and inferring
# the other. Same shape as the header's 08-17 correction, one level in.
if [ $rc -eq 0 ] || [ $rc -eq 1 ]; then
  log ""
  log "⛔ VERIFY A DEPLOY TWICE — CODE *AND* CONFIG. They ship by different mechanisms."
  log "   Changed src/?     npm run build          (dist/ is bind-mounted; no build ⇒ no new code)"
  log "   Changed compose?  docker compose up -d --no-deps mcp-server"
  log "                     ⛔ \`restart\` does NOT re-read docker-compose.yml — env stays STALE."
  log "   Then prove BOTH in the RUNNING container, never by \"Started\":"
  log "     docker exec unibrowse-mcp-server sh -c 'grep -l <new-symbol> /app/dist/*.js'"
  log "     docker exec unibrowse-mcp-server sh -c 'echo \$NEW_ENV_VAR'   # empty ⇒ NOT applied"
  log "   Measured 2026-10-11: code live + env empty read as a clean deploy and shipped nothing."
  deploy_state
fi
exit $rc
