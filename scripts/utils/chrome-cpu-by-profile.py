#!/usr/bin/env python3
"""Which Chrome profile is eating office? CPU by profile and by process kind.

Written 2026-10-11 after `agents` asked unibrowse to find "the one per-site
browser spinning on a page" while office sat at load ~39 on 6 cores. There was
no one browser: ten profiles were each burning 20-73% of a core.

⛔ WHY THIS EXISTS RATHER THAN `ps`/`top`/`pgrep`: Chrome's child processes
REWRITE argv INTO ONE SPACE-SEPARATED STRING. So /proc/<pid>/cmdline holds a
single null-terminated field, and the usual `tr '\0' '\n'` split yields ONE line
with no separate --type= or --user-data-dir= argument to match. Every structured
read of a renderer returns "unknown" and it looks like the data is absent rather
than mis-parsed. ⇒ Split on WHITESPACE after replacing nulls, as below.
⛔ Same family as the recorded `pgrep -f <pattern>` trap, which matches the
shells mentioning the pattern including your own `bash -c` wrapper.

⚠️ AND READ A 10s+ WINDOW. Chrome CPU on this box is wildly variable: three
consecutive 3s samples gave 522%, 219% and 395% of the 600% available. A short
sample will mislead in either direction, and a measured difference smaller than
that spread is not a result. Sampling `ps` %CPU instead gives a LIFETIME average,
which on a 10-hour-old renderer hides what it is doing now.

⭐ Measured finding worth keeping: gpu-process cost tracks whether the PAGE is
busy, NOT whether an instance exists. Idle profiles read ~0.0-0.3% while busy
ones read 10-28%. There is no per-instance rasterizer tax to reclaim by closing
idle browsers, so --disable-gpu is not the lever it looks like.

usage: chrome-cpu-by-profile.py [window_seconds]   (default 10)
"""
import collections
import os
import sys
import time

def snapshot():
    """pid -> (cpu_ticks, profile, process_kind) for every Chrome process."""
    out = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open("/proc/%s/stat" % pid) as f:
                fields = f.read().rsplit(")", 1)[1].split()
            with open("/proc/%s/cmdline" % pid) as f:
                raw = f.read()
        except OSError:
            continue  # exited between listdir and open; normal
        # ⛔ nulls THEN whitespace — see the module docstring
        args = raw.replace("\0", " ").split()
        if not args or "chrome" not in args[0]:
            continue
        profile = kind = None
        for a in args:
            if a.startswith("--user-data-dir="):
                profile = a.split("/")[-1].rstrip("/")
            elif a.startswith("--type="):
                kind = a.split("=", 1)[1]
        utime, stime = int(fields[11]), int(fields[12])
        out[pid] = (utime + stime, profile or "?", kind or "BROWSER")
    return out

def main():
    window = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
    first = snapshot()
    time.sleep(window)
    second = snapshot()

    hz = os.sysconf("SC_CLK_TCK")
    cores = os.cpu_count()
    by_profile = collections.Counter()
    by_kind = collections.Counter()
    gpu = collections.Counter()

    for pid, (ticks, profile, kind) in second.items():
        if pid not in first:
            continue  # started mid-window; no baseline to subtract
        pct = (ticks - first[pid][0]) / hz / window * 100
        by_profile[profile] += pct
        by_kind[kind] += pct
        if kind == "gpu-process":
            gpu[profile] += pct

    with open("/proc/loadavg") as f:
        load = f.read().split()[0]
    print("window %.0fs   cores %d   load %s   ceiling %d00%%"
          % (window, cores, load, cores))

    print("\nby process kind (%% of ONE core):")
    for kind, pct in by_kind.most_common():
        print("  %7.1f%%  %s" % (pct, kind))

    print("\nby profile (gpu share in brackets):")
    for profile, pct in by_profile.most_common():
        if pct < 0.5:
            continue
        print("  %7.1f%%  %-18s [gpu %.1f%%]" % (pct, profile, gpu[profile]))

    total = sum(by_kind.values())
    print("\nTOTAL chrome %.1f%% of %d00%%  (%.0f%% of the box)"
          % (total, cores, total / cores))

if __name__ == "__main__":
    main()
