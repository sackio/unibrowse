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
PENDING=$(( ${#extension[@]} + ${#both[@]} ))
TOTAL=$(( ${#server[@]} + PENDING ))

if [ "$PENDING" -gt 0 ]; then
  echo "⇒ $PENDING of $TOTAL commit(s) here TOUCH extension code."
  echo "  Name them in the release note, or a seat will read a failure as a broken fix."
else
  echo "⇒ Everything here ships on a restart. Safe to announce as live."
fi

# ⛔ THIS TOOL ANSWERS "TOUCHES extension/", NOT "NOT YET ON A BROWSER".
# Those coincide only for a RELEASE SET — commits being deployed right now.
# Run over a long backlog they diverge badly, because extension code from weeks
# ago was delivered by whatever reloads happened since.
#
# MEASURED 2026-09-13, on this script's SECOND run: with no arguments it
# defaulted to all 137 unpushed commits and reported "54 commits carry code no
# restart can deliver". Most of those 54 were on browsers long ago. The script
# I wrote THAT MORNING to stop me overstating what was pending had just
# overstated it by an order of magnitude, in the same direction, in a sentence
# I would have pasted into a broadcast.
#
# ⭐ The general trap: a derived number is only as honest as its RANGE. Deriving
# instead of recalling removes one failure mode and adds another — the reader
# assumes the denominator is the one they had in mind, and nothing says it is not.
if [ "$PENDING" -gt 0 ]; then
  echo
  echo "⚠️  \"Touches extension/\" is NOT the same as \"not yet on any browser\"."
  echo "   Those agree only for commits you are deploying NOW. Over a long range"
  echo "   this OVERSTATES what is pending — older extension code already arrived"
  echo "   via whatever ↻ happened since."
  if [ "$TOTAL" -gt 12 ]; then
    echo "   ⛔ $TOTAL commits is a BACKLOG, not a release. Do not quote this count as"
    echo "      'undelivered'. Re-run against the set you are actually shipping:"
    echo "        scripts/release-split.sh <last-deployed-sha>..HEAD"
  fi
  echo "   ⇒ To learn what a browser is ACTUALLY running, ask the browser."
fi
