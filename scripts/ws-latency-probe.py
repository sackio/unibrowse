#!/usr/bin/env python3
"""Is browser_evaluate actually unreliable, or is the PAGE not answering?

⭐ WHY THIS EXISTS. On 2026-10-24 the captcha lane was losing ~a third of its
evaluates to `WebSocket response timeout after 30000ms`, and I had written into
a durable note that this was a TRANSPORT fault and recommended standing up a
chromium sidecar on another host. Ben approved that deploy. This probe is what
stopped it: 40/40 evaluates returned on the SAME sidecar, median 0.02s, max
0.04s, at load 11.76. The transport was fine. The lane's own pages were dying
mid-row (reCAPTCHA's callback submits the form, the page navigates, and the
MAIN-world relay goes with it), which is a different fault with a different fix
and no new hardware.

⇒ RUN THIS BEFORE BLAMING A HOST. "Everything is slow and timing out" is what a
starved box looks like AND what a dead page looks like, and the two have nothing
in common except the symptom. A clean result here means the host is not the
variable — go and look at what you are asking the page to do.

⚠️ Measures a TRIVIAL page on purpose. It is a control, not a workload: it says
whether the path works, never whether your real pages will answer.

Usage: python3 -I scripts/ws-latency-probe.py [N]        (default 40)
"""
import json, time, sys, urllib.request, importlib.util, os
SP = "/mnt/nas/data/code/unibrowse/scripts/console-credits"
spec = importlib.util.spec_from_file_location("ub", SP + "/ub.py")
ub = importlib.util.module_from_spec(spec); spec.loader.exec_module(ub)

N = int(sys.argv[1]) if len(sys.argv) > 1 else 40
PROF = "wsprobe-%d" % int(time.time())
ext = tab = None
try:
    r = ub.call("browser_launch_isolated_chrome",
                {"profileName": PROF, "freshProfile": True, "headless": True,
                 "url": "https://example.com", "agent": "unibrowse"}, 180)
    try:
        j = json.loads(r)
    except Exception:
        print("LAUNCH RAW:", r[:400]); raise SystemExit(1)
    ext, tab = j.get("extensionId"), j.get("tabId")
    print("launched ext=%s tab=%s display=%s" % (ext, tab, j.get("display")))
    if not tab:
        print("no tabId -- cannot probe"); raise SystemExit(1)

    ok = to = other = 0
    times = []
    for i in range(N):
        t0 = time.time()
        try:
            out = ub.call("browser_evaluate",
                          {"tabTarget": tab, "expression": "1+1",
                           "extensionId": ext}, 45)
            dt = time.time() - t0
            times.append(dt)
            if "WebSocket response timeout" in out:
                to += 1; print("  %2d TIMEOUT %.1fs" % (i, dt))
            elif out.strip().strip('"') == "2":
                ok += 1
            else:
                other += 1; print("  %2d OTHER %.1fs %s" % (i, dt, out[:90]))
        except Exception as e:
            dt = time.time() - t0; times.append(dt)
            other += 1; print("  %2d RAISED %.1fs %s" % (i, dt, str(e)[:90]))
        time.sleep(0.4)
    times.sort()
    print("\nRESULT ok=%d timeout=%d other=%d of %d" % (ok, to, other, N))
    if times:
        print("evaluate latency: min=%.2fs med=%.2fs max=%.2fs"
              % (times[0], times[len(times)//2], times[-1]))
    print("office load:", open("/proc/loadavg").read().split()[:3])
finally:
    if ext:
        try: print("close:", ub.call("browser_close_isolated_chrome",
                                     {"extensionId": ext}, 60)[:120])
        except Exception as e: print("close failed:", str(e)[:120])
