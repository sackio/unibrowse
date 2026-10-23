#!/usr/bin/env python3
"""reprobe.py -- one agents2 Console credit read, start to finish.

Exists because the read needs four things done in order and one of them is
DANGEROUS TO LEAVE HALF-DONE: 1Password must be disabled for the Console login
page to be driveable at all (it injects a chrome-extension:// iframe and Chrome
then refuses the debugger for the whole tab), and if it is left disabled Ben
loses autofill in EVERY window, silently, until somebody notices.
⇒ The re-enable is in a `finally`. Do not refactor it out.

Usage:  python3 -I reprobe.py [email]        (default agents2@sack.io)
Prints one JSON line. Exit 0 = grant figure read, 2 = mint refused, 1 = other.
"""
import json, os, subprocess, sys, importlib.util

SP = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ub", SP + "/ub.py")
ub = importlib.util.module_from_spec(spec); spec.loader.exec_module(ub)

EXT = "ext_018237f9-6041-43d6-b318-98da990f11d2"   # office desktop Chrome
ONEPW = "aeblfdkhhhdcdjpifhhbdiojplfjncoa"
EMAIL = sys.argv[1] if len(sys.argv) > 1 else "agents2@sack.io"

def mktab():
    r = ub.call("browser_create_tab", {"extensionId": EXT, "incognito": True,
                "focus": False, "url": "https://platform.claude.com/login",
                "agent": "unibrowse"}, 90)
    try:    return json.loads(r)["tabId"]
    except Exception: raise SystemExit("could not create tab: " + str(r)[:200])

tabs, out = [], {"account": EMAIL}
try:
    ub.call("browser_disable_extension", {"extensionId": EXT, "id": ONEPW}, 60)
    tabs = [mktab(), mktab()]
    env = dict(os.environ, UB_TAB_A=str(tabs[0]), UB_TAB_B=str(tabs[1]), UB_EXT=EXT)
    p = subprocess.run([sys.executable, "-I", SP + "/cc2.py", EMAIL],
                       capture_output=True, text=True, timeout=540, env=env, cwd=SP)
    line = (p.stdout or "").strip().splitlines()
    out = json.loads(line[-1]) if line else {"account": EMAIL, "error": "no output from cc2.py",
                                             "stderr": (p.stderr or "")[:200]}
except subprocess.TimeoutExpired:
    out = {"account": EMAIL, "error": "cc2.py timed out after 540s"}
except Exception as e:
    out = {"account": EMAIL, "error": "%s: %s" % (type(e).__name__, str(e)[:200])}
finally:
    # ⛔ ALWAYS, even on an exception or a SystemExit above.
    for t in tabs:
        try: ub.call("browser_close_tab", {"extensionId": EXT, "tabId": t}, 45)
        except Exception: pass
    try:
        r = ub.call("browser_enable_extension", {"extensionId": EXT, "id": ONEPW}, 60)
        out["onepassword_restored"] = ("enabled" in str(r).lower())
    except Exception as e:
        out["onepassword_restored"] = False
        out["ONEPASSWORD_STILL_OFF"] = str(e)[:150]

print(json.dumps(out)[:1200])
g = str(out.get("grants", ""))
sys.exit(0 if g and g not in ("PENDING", "NO-GRANT-TABLE")
         else 2 if "NONE" in str(out.get("mint", "")) else 1)
