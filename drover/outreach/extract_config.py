#!/usr/bin/env python3
"""Lift the outreach lane's form heuristics out of the business engine, without
running it, so Drover fills the same fields with the same text as v1.

  extract_config.py > contact-config.json

⛔ ONE SOURCE OF TRUTH: bin/captcha_solve.py in business/outreach owns which
field is which (DISCOVER_CONTACT), the submit control (SUBMIT_RECT), the
message (MSG_TMPL, SUBJECT) and what success and refusal look like
(OK_CONTACT, FAIL_TEXT). This reads those assignments with ast and never
imports the module, whose top level reads keys and a spend ledger.
"""
import ast, json, sys

SRC = "/mnt/nas/data/code/business/outreach/bin/captcha_solve.py"
WANT = {"DISCOVER_CONTACT", "SUBMIT_RECT", "BODY", "MSG_TMPL", "SUBJECT", "OK", "OK_CONTACT", "FAIL_TEXT",
        "SITEKEY", "INJECT", "FIELD_PRESENT"}


def literal(node):
    """A string constant, an os.environ.get(name, default) default, or the
    pattern of re.compile(pattern, re.I)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Call):
        f = ast.unparse(node.func)
        if f == "os.environ.get" and len(node.args) == 2:
            return literal(node.args[1])
        if f == "re.compile":
            return literal(node.args[0])
    if isinstance(node, ast.JoinedStr) or isinstance(node, ast.BinOp):
        return ast.literal_eval(node)
    return None


out = {}
for n in ast.parse(open(SRC).read()).body:
    if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
        name = n.targets[0].id
        if name in WANT:
            out[name] = literal(n.value)
missing = WANT - {k for k, v in out.items() if v}
if missing:
    sys.exit(f"could not read {sorted(missing)} from {SRC}")
json.dump(out, sys.stdout, indent=1)
