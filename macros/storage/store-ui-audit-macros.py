#!/usr/bin/env python3
"""
Store/refresh the two ui-audit macros that give `guide`'s ui-audit skill its
logged-in-page path. Ben asked for the skill in #guide 2026-10-16 17:54; guide
owns the headless half, this is ours.

  ./store-ui-audit-macros.py            # embed + upsert, prints the sha it embedded
  ./store-ui-audit-macros.py --dry      # print the sha and the macro sizes, write nothing

⭐ WHY A SCRIPT AND NOT browser_store_macro: the macro body EMBEDS guide's
uiaudit.js verbatim (~7.5KB). Through the MCP tool that source has to travel in a
tool argument, i.e. through a model's context, every single time it is refreshed.
Here it is read from disk, so a refresh costs no tokens at all.

⛔ DRIFT IS SILENT, AND IT HAS ALREADY HAPPENED TWICE. uiaudit.js changed under
us mid-build (sha abe81b74 -> c8adc6fa within one hour, while guide iterated).
A stale embedded copy keeps returning plausible findings from old rules and
NOTHING reports it. ⇒ After any change to uiaudit.js: run this, then run
guide's fixture.html through the stored macro and confirm every check still
fires. The measured baseline is 11 findings at 390px with --expect "#must-see",
matching `uiaudit.sh` exactly (2026-10-16).

⛔ THE TRAP THAT COST A DEBUG CYCLE — ASI. uiaudit.js opens with `//` comment
lines, so `return <src>` becomes `return;` followed by an orphan expression:
the macro returns undefined and fails as "Cannot read properties of undefined
(reading 'findings')". The template therefore wraps it as `return (\n<src>\n)`.
Never substitute the source straight after a bare `return`.

⚠️ Writes to Mongo directly (same shape as an existing macro doc, usageCount and
successRate preserved on refresh) because there is no HTTP route for macro
storage and the ws-based scripts beside this one predate the server4 move.
"""
import argparse, hashlib, io, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = "/mnt/nas/data/code/projects/guide/skills/ui-audit/uiaudit.js"  # ~/.claude/skills/ui-audit -> here
MONGO_HOST = os.environ.get("UNIBROWSE_MONGO_HOST", "192.168.1.168")
SSH = os.environ.get("SSH_CMD", "ssh -p 4999 ben@")

ap = argparse.ArgumentParser()
ap.add_argument("--dry", action="store_true")
args = ap.parse_args()

raw = open(AUDIT, "rb").read()
src = raw.decode().rstrip()
# ⚠️ REPORT THE RAW-FILE HASH, i.e. what `sha256sum <file> | cut -c1-16` prints.
# Hashing the rstripped source instead produced a DIFFERENT number from guide's
# for byte-identical content (c8adc6fa vs 488086c2, 2026-10-16), which reads
# exactly like drift and cost a round trip to disprove. The embedded copy is
# still rstripped; only the reported hash changed.
sha = hashlib.sha256(raw).hexdigest()[:16]

tpl = lambda n: open(os.path.join(HERE, n)).read()
# iframe macro holds the source as a STRING (eval'd inside the frame realm);
# current-viewport macro holds it as an EXPRESSION (the macro body itself).
code = {
    "ui-audit-sweep-iframe": tpl("ui-audit-sweep-iframe.tpl.js").replace("__AUDIT_SRC__", json.dumps(src)),
    "ui-audit-current-viewport": tpl("ui-audit-current-viewport.tpl.js").replace("__AUDIT_IIFE__", src),
}

if args.dry:
    for n, c in code.items():
        print(f"{n}: {len(c)} bytes")
    print("uiaudit.js sha256[0:16] =", sha)
    sys.exit(0)

js = io.StringIO()
js.write("const now=new Date();\n")
for name, c in code.items():
    js.write(
        "db.macros.updateOne({site:'*',name:%s},{$set:{code:%s,updatedAt:now}});\n"
        "print('patched ' + %s + ' sha=%s');\n" % (json.dumps(name), json.dumps(c), json.dumps(name), sha)
    )
cmd = f"{SSH}{MONGO_HOST} 'docker exec -i unibrowse-mongodb mongosh --quiet unibrowse'"
p = subprocess.run(cmd, shell=True, input=js.getvalue(), text=True, capture_output=True)
print(p.stdout.strip() or p.stderr.strip())
print("embedded uiaudit.js sha256[0:16] =", sha)
