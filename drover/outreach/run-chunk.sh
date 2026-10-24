#!/bin/bash
# One live outreach chunk on Drover: pick N unrun rows, lease a VPN exit, run
# the Indexed Job, harvest verdicts into the lane's results file, clean up.
#
#   drover/outreach/run-chunk.sh [N=8] [shards=4]
#
# ⛔ Live: every `submitted` row is a real message to a town. Rows already in
# the results file are never picked (lane.py pick), and harvest appends only
# keys the file does not hold. Keep v1's lane off while this runs.
set -u
N=${1:-8}; SHARDS=${2:-4}
HERE=$(cd "$(dirname "$0")" && pwd)
O=/mnt/nas/data/code/business/outreach
Q=$O/captcha-svc-ordered.tsv; R=$O/captcha-svc-results-ord.tsv
K="kubectl --kubeconfig=/mnt/nas/data/code/server_admin/k8s-credentials/clusters/barn-cluster.yaml -n drover"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT; umask 077
python3 "$HERE/lane.py" pick --queue "$Q" --results "$R" --limit "$N" > "$W/rows.tsv" || exit 1
[ "$(wc -l < "$W/rows.tsv")" -le 1 ] && { echo "nothing to run"; exit 0; }
python3 "$HERE/extract_config.py" > "$W/config.json" || exit 1
ssh -p 4999 ben@192.168.1.42 'LEASE_HOLDER=thread-unibrowse-2 vpn-proxy lease us 90' > "$W/url" 2> "$W/err" || { echo "no lease"; cat "$W/err" | tail -1; exit 1; }
LID=$(grep -oE 'vpn-proxy: lease [0-9a-f]{8}' "$W/err" | grep -oE '[0-9a-f]{8}$' | tail -1)
$K delete job drover-outreach --ignore-not-found --wait=true >/dev/null
$K delete configmap drover-outreach --ignore-not-found >/dev/null
$K delete secret drover-proxy --ignore-not-found >/dev/null
$K create configmap drover-outreach --from-file=rows.tsv="$W/rows.tsv" --from-file=contact-config.json="$W/config.json" >/dev/null
$K create secret generic drover-proxy --from-literal=DROVER_PROXY="$(cat "$W/url")" >/dev/null; rm -f "$W/url"
sed -e "s#completions: 4#completions: $SHARDS#; s#parallelism: 4#parallelism: $SHARDS#; s#maxFailedIndexes: 4#maxFailedIndexes: $SHARDS#; s#DROVER_SHARDS, value: \"4\"#DROVER_SHARDS, value: \"$SHARDS\"#" \
  "$HERE/../k8s/outreach-job.yaml" | $K apply -f - >/dev/null
t0=$(date +%s)
until $K get job drover-outreach -o jsonpath='{.status.conditions[*].type}' | grep -qE 'Complete|Failed'; do sleep 20; done
$K logs -l job-name=drover-outreach --tail=-1 --max-log-requests=20 > "$W/logs"
python3 "$HERE/lane.py" harvest --results "$R" < "$W/logs"
grep '^ROW ' "$W/logs" | cut -c5- | python3 -c '
import sys, json, collections
rs = [json.loads(l) for l in sys.stdin]
print("rows", len(rs), dict(collections.Counter(r["status"] for r in rs)))
for r in rs: print(" ", r["key"][:16], r["status"], r["seconds"], r["note"][:80])'
echo "wall $(( $(date +%s) - t0 ))s for $(( $(wc -l < "$W/rows.tsv") - 1 )) rows on $SHARDS pods"
$K delete secret drover-proxy >/dev/null
[ -n "$LID" ] && ssh -p 4999 ben@192.168.1.42 "vpn-proxy release $LID >/dev/null 2>&1"
docker logs --since 2h drover-solve-broker 2>&1 | tail -3
