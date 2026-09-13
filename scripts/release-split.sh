#!/usr/bin/env bash
# release-split — say which commits reach a browser on a server restart, and
# which ones sit inert until someone presses ↻ on chrome://extensions.
#
# WHY THIS EXISTS
# ---------------
# ⛔ I GOT THIS WRONG THREE TIMES IN ONE DAY (2026-09-13), always in the same
# direction: understating what was still pending. Each time cost a broadcast to
# 161 seats plus a correction, and one of them told the fleet a fix was live
# when the half that mattered was not:
#
#   · 12:38 all-clear  — announced d125182 as shipped. Its extension half
#                        (filename/sourceUrl encoding) was not deployed, and the
#                        filename is the half a caller does NOT control, because
#                        it comes from Content-Disposition.
#   · 12:38 all-clear  — said the 180s transfer window "reaches every browser
#                        immediately because it is server-side". The extension
#                        enforces its own 30s handler timeout; transfers died at
#                        33s for a seat who measured it six minutes later.
#   · 12:53 follow-up  — still said "one extension-side commit". It was four.
#
# ⭐ THE POINT IS NOT THAT I MISREMEMBERED. It is that this split is MECHANICALLY
# DERIVABLE and I was recalling it while composing prose instead. A fact you can
# compute should never be recalled — recall fails silently and, as above, it
# fails in whichever direction you were already inclined to believe.
#
# ⚠️ A COMMIT CAN BE BOTH. d125182 and 30e895f each touch src/ AND extension/,
# so "which side is it" is the wrong question; "which half of it has landed" is
# the right one. BOTH is the most dangerous class precisely because the server
# half deploying makes it look done.
#
# THE RULE THIS ENCODES
#   src/, docker-compose*   -> live on `docker compose restart mcp-server`
#   extension/              -> live only at each browser's next ↻, one browser
#                              at a time, and NOTHING you deploy changes that
#   dist/                   -> build output; ignored, it is not a source of truth
#
# USAGE
#   scripts/release-split.sh                 # unpushed commits (@{u}..HEAD)
#   scripts/release-split.sh <rev-range>     # e.g. main..HEAD, or a1b2c3d..HEAD
#   scripts/release-split.sh <sha> [<sha>…]  # explicit commits
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
  RANGE="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo main)..HEAD"
  COMMITS=$(git rev-list --reverse "$RANGE")
  echo "range: $RANGE"
elif [ $# -eq 1 ] && [[ "$1" == *..* ]]; then
  COMMITS=$(git rev-list --reverse "$1")
  echo "range: $1"
else
  COMMITS="$*"
fi

[ -z "${COMMITS:-}" ] && { echo "no commits in range"; exit 0; }

server=(); extension=(); both=()
for c in $COMMITS; do
  files=$(git show --stat=999 --format="" --name-only "$c")
  e=$(printf '%s\n' "$files" | grep -c '^extension/' || true)
  s=$(printf '%s\n' "$files" | grep -cE '^(src/|docker-compose)' || true)
  subj=$(git log --format=%s -1 "$c" | cut -c1-64)
  short=$(git rev-parse --short "$c")
  if   [ "$e" -gt 0 ] && [ "$s" -gt 0 ]; then both+=("$short  $subj")
  elif [ "$e" -gt 0 ];                   then extension+=("$short  $subj")
  elif [ "$s" -gt 0 ];                   then server+=("$short  $subj")
  fi
done

echo
echo "SERVER-SIDE — live on \`docker compose restart mcp-server\`, every browser at once:"
[ ${#server[@]} -eq 0 ] && echo "  (none)" || printf '  ✅ %s\n' "${server[@]}"
echo
echo "⛔ EXTENSION-SIDE — reaches a browser ONLY at that browser's next ↻ on chrome://extensions."
echo "   A server deploy does NOT deliver these. Until then they look BROKEN, not pending."
[ ${#extension[@]} -eq 0 ] && echo "  (none)" || printf '  ⛔ %s\n' "${extension[@]}"
echo
echo "⚠️ BOTH — the server half ships and the extension half does not. THE MOST DANGEROUS CLASS:"
echo "   deploying makes these look complete. Say explicitly which half a caller gets."
[ ${#both[@]} -eq 0 ] && echo "  (none)" || printf '  ⚠️ %s\n' "${both[@]}"
echo
if [ $(( ${#extension[@]} + ${#both[@]} )) -gt 0 ]; then
  echo "⇒ $(( ${#extension[@]} + ${#both[@]} )) commit(s) carry code no restart can deliver."
  echo "  Name them in the release note, or a seat will read a failure as a broken fix."
else
  echo "⇒ Everything here ships on a restart. Safe to announce as live."
fi
