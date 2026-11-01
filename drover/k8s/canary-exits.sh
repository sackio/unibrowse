#!/bin/bash
# Canary N fresh VPN exits in turn: lease one, run drover-canary through it,
# print the verdict, release it. Answers "is it the IP or the browser?": if
# fresh exits differ, the IP matters.
#
#   drover/k8s/canary-exits.sh [N=3] [country=us]
#
# ⛔ The lease URL holds the proxy password: it goes only into a k8s Secret,
# never to stdout. Fresh exits are new Nord connections; vpn-proxy throttles
# launches (3 per 10 min) and this script respects its rc 13 by waiting.
set -u
N=${1:-3}; CC=${2:-us}
HERE=$(cd "$(dirname "$0")" && pwd)
K="kubectl --kubeconfig=/mnt/nas/data/code/server_admin/k8s-credentials/clusters/barn-cluster.yaml -n drover"
export LEASE_HOLDER=${LEASE_HOLDER:-thread-unibrowse-2}
for i in $(seq 1 "$N"); do
  while :; do
    URL=$(VPN_FRESH=1 vpn-proxy lease "$CC" 15 2>/tmp/canary-lease.$$); rc=$?
    [ $rc -ne 13 ] && break
    w=$(grep -oE '[0-9]+ ?s' /tmp/canary-lease.$$ | head -1 | tr -dc 0-9); sleep "${w:-120}"
  done
  ID=$(grep -oE 'vpn-proxy: lease [0-9a-f]{8}' /tmp/canary-lease.$$ | grep -oE '[0-9a-f]{8}$' | tail -1)
  rm -f /tmp/canary-lease.$$
  [ $rc -ne 0 ] && { echo "exit $i: no lease (rc=$rc)"; continue; }
  $K delete job drover-canary --ignore-not-found --wait=true >/dev/null
  $K delete secret drover-proxy --ignore-not-found >/dev/null
  $K create secret generic drover-proxy --from-literal=DROVER_PROXY="$URL" >/dev/null
  unset URL
  $K apply -f "$HERE/canary-job.yaml" >/dev/null
  for _ in $(seq 60); do
    $K get job drover-canary -o jsonpath='{.status.conditions[*].type}' | grep -qE 'Complete|Failed' && break; sleep 10
  done
  LOG=$($K logs job/drover-canary --tail=-1)
  echo "exit $i: $(grep '^{"healthy"' <<<"$LOG" || echo 'no verdict')"
  # Feed the fleet ledger (vpn-proxy health), ok as well as blocked: a ledger
  # that only hears refusals skips every exit. By IP, which the rows carry.
  grep '^ROW ' <<<"$LOG" | cut -c5- | python3 -c '
import sys, json
for l in sys.stdin:
    r = json.loads(l)
    v = {"passed": "ok", "blocked": "blocked", "empty": "blocked"}.get(r["verdict"])
    if v and r.get("exitIp"):
        print(r["exitIp"], v, (r.get("vendor") or "").lower(), r["site"].split("/")[2])' |
  while read -r ip v ven host; do vpn-proxy report "$ip" "$v" --vendor "$ven" --site "$host" >/dev/null 2>&1; done
  [ -n "$ID" ] && vpn-proxy release "$ID" >/dev/null 2>&1
done
$K delete secret drover-proxy --ignore-not-found >/dev/null
