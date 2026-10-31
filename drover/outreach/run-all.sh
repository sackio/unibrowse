#!/bin/bash
# Proper parallel outreach driver (Ben, Slack #unibrowse 2026-10-26: "stop
# current run and do it properly now"). Supersedes v2's single sequential
# signups loop: runs the two Our Town Store lanes CONCURRENTLY, each looped to
# drain, then one dedupe-safe retry pass of the lane's own retry set.
#
#   drover/outreach/run-all.sh          # background it: nohup ... &
#
#   signups  -- newsletter signups, HOUSE IP (Ben OKed #business-outreach 10-25
#               15:32; business-3 confirmed 10-26). run-signups.sh, job
#               drover-signups. Drains on exit 3.
#   contact  -- town contact forms, VPN exit (NORD/vpn-proxy). run-chunk.sh,
#               job drover-outreach. Drains when a chunk picks 0 rows.
#
# Distinct k8s job names, so the two lanes never collide. The $5 2Captcha cap
# self-enforces inside solve_broker (it sums business/outreach/captcha-spend.tsv
# on every request and refuses past $5) -- past the cap, reCAPTCHA rows come
# back `blocked`, which is expected, not an error. ⛔ Never Groton MA (verified
# 0 rows in both queues 2026-10-26); each row is pinned to its own address +
# persona by the lane. hCaptcha is clicked, never relayed; results append to the
# lane files only (dedupe: a key already recorded is never re-sent).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LOG=${LOG:-/tmp/drover-outreach-all.log}
SIG_N=${SIG_N:-320};  SIG_SHARDS=${SIG_SHARDS:-16}
CON_N=${CON_N:-48};   CON_SHARDS=${CON_SHARDS:-8}
ts(){ date '+%Y-%m-%d %H:%M:%S'; }

signups(){
  local rc
  while :; do
    "$HERE/run-signups.sh" "$SIG_N" "$SIG_SHARDS" >>"$LOG" 2>&1; rc=$?
    echo "$(ts) [signups] chunk rc=$rc" >>"$LOG"
    [ "$rc" -eq 3 ] && { echo "$(ts) [signups] DRAINED" >>"$LOG"; break; }
    [ "$rc" -ne 0 ] && sleep 15
  done
}

contact(){
  local out rc
  while :; do
    out=$("$HERE/run-chunk.sh" "$CON_N" "$CON_SHARDS" 2>&1); rc=$?
    printf '%s\n' "$out" >>"$LOG"; echo "$(ts) [contact] chunk rc=$rc" >>"$LOG"
    printf '%s' "$out" | grep -q 'nothing to run' && { echo "$(ts) [contact] DRAINED" >>"$LOG"; break; }
    [ "$rc" -ne 0 ] && sleep 15
  done
  # One dedupe-safe retry pass: lane.py's --retry re-attacks its once-only retry
  # set (transient failures it marked retryable), never a submitted row.
  echo "$(ts) [contact] retry pass" >>"$LOG"
  RETRY=1 "$HERE/run-chunk.sh" "$CON_N" "$CON_SHARDS" >>"$LOG" 2>&1
}

echo "=== $(ts) run-all start  signups=$SIG_N/$SIG_SHARDS (house)  contact=$CON_N/$CON_SHARDS (vpn) ===" >>"$LOG"
signups & SIG=$!
contact & CON=$!
wait "$SIG"; wait "$CON"
echo "=== $(ts) run-all: both lanes drained ===" >>"$LOG"
