#!/usr/bin/env bash
# ⛔ `tsup` bundles with esbuild, which STRIPS types and never checks them, so a
# reference to a name that does not exist builds clean and ships. It then throws
# ReferenceError at the first call — measured 2026-10-23: resolveTarget() in
# src/tools/human-mode.ts read an out-of-scope `display`, which broke every
# browser_human_click / _move / _type-with-selector in the deployed server while
# `npm run build` reported success.
#
# `npm run typecheck` cannot gate this: the repo carries ~116 pre-existing TS2322
# handler-signature errors, so its exit status is always 1 and everybody ignores
# it. ⇒ Gate on the error classes that are ALWAYS a real bug, whatever the
# signature noise says, and let the rest stay noisy.
#
#   TS2304/TS2552  a name that does not exist      -> ReferenceError at runtime
#   TS2448/TS2454  used before assigned            -> undefined at runtime
#   TS7027         unreachable code detected       -> a branch that never runs
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=$(npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TS2304|TS2552|TS2448|TS2454|TS7027" || true)
if [ -n "$OUT" ]; then
  echo "⛔ scope/flow errors — these throw at runtime and esbuild will not catch them:"
  echo "$OUT"
  exit 1
fi
echo "✅ no scope/flow errors"
