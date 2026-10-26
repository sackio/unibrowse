#!/bin/bash
# Newsletter signups on Drover (Ben, #business-outreach 2026-10-25 19:08): the
# rows the business lane's scripts could not do (captcha or no parseable form),
# filled by hand in signup mode (contact.py DISCOVER_SIGNUP), house IP, real
# clicks on captchas; reCAPTCHA the click cannot clear is bought (ask a3s, $5 cap).
#
#   drover/outreach/run-signups.sh [N=320] [shards=16]     # one chunk; DRY=1 fills without sending
#
# Queue:   business/outreach/data/drover-signups.tsv  (brand domain address persona last_status)
# Lane:    business/outreach/data/drover-signups-lane.tsv  (lane.py's results; dedupes re-runs)
# Report:  business/outreach/data/drover-signups-done.tsv  (date brand domain address result)
# Trip at Hand (jf) rows go first. Exits 3 when the queue is empty.
set -u
N=${1:-320}; SHARDS=${2:-16}
HERE=$(cd "$(dirname "$0")" && pwd)
O=/mnt/nas/data/code/business/outreach/data
L=$O/drover-signups-lane.tsv; DONE=$O/drover-signups-done.tsv
K="kubectl --kubeconfig=/mnt/nas/data/code/server_admin/k8s-credentials/clusters/barn-cluster.yaml -n drover"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
[ -f "$L" ] || printf 'key\taddress\tstatus\tnote\n' > "$L"
[ -f "$DONE" ] || printf 'date\tbrand\tdomain\taddress\tresult\n' > "$DONE"
# The queue in lane.py's row shape; key = brand|domain|address.
python3 - "$O/drover-signups.tsv" > "$W/queue.tsv" <<'EOF'
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
# Round-robin across brands so no brand starves. The old jf-first-then-file-order
# sort serialised the queue -- jf drained first, then ots, pb, re, ink in file
# order -- so `re` sat at 0 done and ots/pb/ink showed 0 rate for hours while jf
# ran (business, 2026-10-26; Ben #business 10:27 "every pipeline actively worked
# and fed at the right rate"). Interleave one row per brand per round, each
# brand keeping its own order; jf still leads each round, so its head start is
# kept without blocking the rest.
from collections import OrderedDict, deque
groups = OrderedDict([("jf", deque())])   # jf leads each round; others follow in file order
for r in rows:
    groups.setdefault(r["brand"], deque()).append(r)
rows = []
while any(groups.values()):
    for q in groups.values():
        if q:
            rows.append(q.popleft())
print("url\taddress\tfirst\tlast\tkey\ttown")
for r in rows:
    first, _, last = r["persona"].partition(" ")
    if r["persona"].startswith("Our Town Store "):   # ots rows: brand + town, not a person
        first, last = "Our Town Store", r["persona"][15:]
    print("\t".join([f"https://{r['domain']}/", r["address"], first, last, f"{r['brand']}|{r['domain']}|{r['address']}", ""]))
EOF
python3 "$HERE/lane.py" pick --queue "$W/queue.tsv" --results "$L" --limit "$N" > "$W/rows.tsv" || exit 1
[ "$(wc -l < "$W/rows.tsv")" -le 1 ] && { echo "queue empty"; exit 3; }
python3 "$HERE/extract_config.py" | python3 -c 'import json,sys;d=json.load(sys.stdin);d["MODE"]="signup";json.dump(d,sys.stdout)' > "$W/config.json" || exit 1
$K delete job drover-signups --ignore-not-found --wait=true >/dev/null
$K delete configmap drover-signups --ignore-not-found >/dev/null
$K delete secret drover-proxy-signups --ignore-not-found >/dev/null
$K create configmap drover-signups --from-file=rows.tsv="$W/rows.tsv" --from-file=contact-config.json="$W/config.json" >/dev/null
$K create secret generic drover-proxy-signups --from-literal=DROVER_PROXY= >/dev/null   # empty: the house IP
# outreach-job.yaml, renamed. The solve broker buys reCAPTCHA + hCaptcha tokens
# (Ben, ask a5d 2026-10-26; was reCAPTCHA-only a3s), inside the lane's one ledger,
# cap $20 (a5d). A widget the paid solver cannot handle still ends the row blocked.
sed -e "s#name: drover-outreach#name: drover-signups#g; s#name: drover-proxy}#name: drover-proxy-signups}#" \
    -e "s#completions: 4#completions: $SHARDS#; s#parallelism: 4#parallelism: $SHARDS#; s#maxFailedIndexes: 4#maxFailedIndexes: $SHARDS#" \
    -e "s#DROVER_SHARDS, value: \"4\"#DROVER_SHARDS, value: \"$SHARDS\"#; s#DRY, value: \"\"#DRY, value: \"${DRY:-}\"#" \
    "$HERE/../k8s/outreach-job.yaml" | $K apply -f - >/dev/null || exit 1
t0=$(date +%s)
until $K get job drover-signups -o jsonpath='{.status.conditions[*].type}' | grep -qE 'Complete|Failed'; do sleep 30; done
$K logs -l job-name=drover-signups --tail=-1 --max-log-requests=40 > "$W/logs"
grep '^ROW ' "$W/logs" | cut -c5- > "$W/rows.jsonl"
if [ -z "${DRY:-}" ]; then
  python3 "$HERE/lane.py" harvest --results "$L" < "$W/logs"
  python3 - "$W/rows.jsonl" >> "$DONE" <<'EOF'
import json, sys, time
for l in open(sys.argv[1]):
    r = json.loads(l)
    brand, domain, addr = r["key"].split("|")
    res = r["status"] if r["status"] in ("submitted", "noform") else "blocked"
    print("\t".join([time.strftime("%Y-%m-%d"), brand, domain, addr, res]))
EOF
fi
python3 -c '
import sys, json, collections
rs = [json.loads(l) for l in open(sys.argv[1])]
print("rows", len(rs), dict(collections.Counter(r["status"] for r in rs)))
for r in rs[:int(sys.argv[2])]: print(" ", r["key"][:50], r["status"], r["seconds"], r["note"][:90])' "$W/rows.jsonl" "${SHOW:-0}"
echo "wall $(( $(date +%s) - t0 ))s for $(( $(wc -l < "$W/rows.tsv") - 1 )) rows on $SHARDS pods"
