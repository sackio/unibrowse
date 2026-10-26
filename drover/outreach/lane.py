#!/usr/bin/env python3
"""The outreach contact-form lane on Drover.

In a pod (k8s/outreach-job.yaml), `run` takes this pod's shard of the rows and
gives each row a fresh browser:

  lane.py run --rows /lane/rows.tsv --config /lane/contact-config.json [--dry]

On the host, `pick` writes the rows still to do and `harvest` folds the pods'
verdicts into the lane's ONE results file:

  lane.py pick --queue Q.tsv --results R.tsv [--limit N] > rows.tsv
  lane.py harvest --results R.tsv < pod-logs

⛔ These are real town contact forms: a duplicate is a second message to a
stranger. So a key already in the results file is never picked, shards are
disjoint, a pod is never retried (a retry would re-send its rows), and harvest
appends only keys the file does not hold yet. The results file has one writer:
harvest, on the host.
"""
import argparse, csv, json, os, subprocess, sys, time

COLS = ["url", "address", "first", "last", "key", "town"]


def read_tsv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def done_keys(results):
    try:
        return {r["key"] for r in read_tsv(results)}
    except FileNotFoundError:
        return set()


def retryable(results):
    """Drover rows that stopped before the submit press, run once only: a
    `blocked` note without the `kind|button|outcome` a press writes, or an
    `error` (pre-press by construction, see run()). v1 rows (notes not
    starting "drover ") are never retried: some bought a token whose callback
    may have sent. Ben, ask unibrowse/a4o, 2026-10-25."""
    try:
        rows = read_tsv(results)
    except FileNotFoundError:
        return set()
    seen = {}
    for r in rows:
        seen.setdefault(r["key"], []).append(r)
    return {k for k, rs in seen.items() if len(rs) == 1 and rs[0]["note"].startswith("drover ")
            and (rs[0]["status"] == "error" or (rs[0]["status"] == "blocked" and "|" not in rs[0]["note"]
                                                  and "x:Runtime.evaluate gave no answer" not in rs[0]["note"]))}


def pick(a):
    done = done_keys(a.results)
    rows = [r for r in read_tsv(a.queue) if r["key"] not in done]
    if a.retry:
        again = retryable(a.results)
        rows = [r for r in read_tsv(a.queue) if r["key"] in again]
    if a.keys:
        want = set(open(a.keys[1:]).read().split() if a.keys.startswith("@") else a.keys.split(","))
        rows = [r for r in read_tsv(a.queue) if r["key"] in want]   # explicit keys: the caller's call
    seen = set()  # the queue carries exact-duplicate rows; run() sends every row it
    rows = [r for r in rows if not (r["key"] in seen or seen.add(r["key"]))]  # is handed, so one key twice = two sends. Dedupe by key, keep order.
    rows = rows[: a.limit] if a.limit else rows
    w = csv.DictWriter(sys.stdout, COLS, delimiter="\t", extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    print(f"picked {len(rows)} row(s)", file=sys.stderr)


def run(a):
    rows = read_tsv(a.rows)
    i, n = int(os.environ.get("JOB_COMPLETION_INDEX", "0")), int(os.environ.get("DROVER_SHARDS", "1"))
    for r in rows[i::n]:
        cmd = ["python3", a.worker, "contact", "--row", json.dumps(r), "--config", a.config]
        if a.dry:
            cmd.append("--dry")
        t0 = time.time()
        # ⛔ A row that dies after the worker printed PRESSED may have reached
        # the town, so it is `unsure`, which nothing re-runs; before that it is
        # `error`, which the lane may sweep.
        def died(err, why):
            pressed = "PRESSED" in (err or "")
            return {"status": "unsure" if pressed else "error",
                    "note": ("submit pressed, then " if pressed else "") + why[:200]}
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=a.row_wall)
            try:
                out = json.loads(p.stdout.strip().splitlines()[-1])
            except (ValueError, IndexError):
                out = died(p.stderr, (p.stderr.strip().splitlines() or ["no output"])[-1])
        except subprocess.TimeoutExpired as e:
            err = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")
            out = died(err, f"row wall {a.row_wall}s")
        out.update(key=r["key"], address=r["address"], seconds=out.get("seconds", round(time.time() - t0, 1)))
        print("ROW " + json.dumps(out), flush=True)


def harvest(a):
    done = done_keys(a.results) - retryable(a.results)
    if a.keys:                                         # a re-run the operator asked for by key (Ben, ask unibrowse/a4s)
        done -= set(open(a.keys[1:]).read().split() if a.keys.startswith("@") else a.keys.split(","))
    new = []
    for line in sys.stdin:
        line = line.split("ROW ", 1)[-1] if "ROW " in line else ""
        if not line.strip():
            continue
        r = json.loads(line)
        if r["key"] in done or r["status"] == "dry":
            continue
        done.add(r["key"])
        note = f"drover {r.get('exitIp') or '?'} {r.get('seconds')}s: {r.get('note', '')}".replace("\t", " ").replace("\n", " ")
        new.append("\t".join([r["key"], r["address"], r["status"], note]))
    if new:
        with open(a.results, "a") as f:
            f.write("\n".join(new) + "\n")
    print(f"appended {len(new)} row(s) to {a.results}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("pick"); p.add_argument("--queue", required=True); p.add_argument("--results", required=True)
    p.add_argument("--limit", type=int); p.add_argument("--keys", help="comma-separated keys, ignoring results (dry timing runs)")
    p.add_argument("--retry", action="store_true", help="the once-only retry set (see retryable)")
    p = sp.add_parser("run"); p.add_argument("--rows", required=True); p.add_argument("--config", required=True)
    p.add_argument("--dry", action="store_true"); p.add_argument("--row-wall", type=int, default=420)
    p.add_argument("--worker", default="/opt/drover/worker/drover_worker.py")
    p = sp.add_parser("harvest"); p.add_argument("--results", required=True)
    p.add_argument("--keys", help="keys (comma-separated or @file) the results file may take once more")
    a = ap.parse_args()
    {"pick": pick, "run": run, "harvest": harvest}[a.cmd](a)


if __name__ == "__main__":
    main()
