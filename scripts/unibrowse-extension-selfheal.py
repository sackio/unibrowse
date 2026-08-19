#!/usr/bin/env /usr/bin/python3
"""Idle-gated self-heal for the office host browser extension.

WHY THIS EXISTS. Occurrences #5/#6/#7 (2026-08-17/18/19) are the same bug:
Chrome stops starting the extension's service worker for any registered event,
so the socket dies and nothing on our side can recover it -- the keepalive
alarm stays registered with a scheduledTime that simply never fires, and
browser_reload_extension travels over the socket that is already gone. The
only known repair is the Reload control on the unibrowse card at
chrome://extensions, which means driving Chrome's UI. Three identical manual
repairs in three days is the reason this is automated.

⛔ THIS DRIVES THE OPERATOR'S DESKTOP. Two hard rules, both enforced below:
  1. AT-SPI (AXPress) only -- never coordinates. FOUR windows on this display
     share the geometry 3840,1080 1920x1080, and one of them is a gnome-terminal
     running an agent session. A coordinate click can land in a SHELL.
  2. Idle-gated. The X server's idle time is re-checked immediately before
     EVERY press, and the sequence aborts the moment a human touches the
     keyboard -- a half-finished sequence is harmless (a popup, or an
     extensions tab), a press landing under someone's hands is not.

Safe to run read-only at any time: --dry-run injects no input.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

EXT_ID = "pikjoohganfooeancifkoccakcocchmk"
PROFILE = os.path.expanduser("~/.config/google-chrome/Profile 1")
SERVER = os.environ.get("UNIBROWSE_SERVER", "http://localhost:9010")
ATC = os.environ.get("ATC_URL", "http://192.168.1.168:3030")
NOTIFY = os.environ.get("UNIBROWSE_SELFHEAL_NOTIFY", "unibrowse,agents")

# Path to the Extensions toolbar button, identical in every Chrome window
# (measured 2026-08-19 across 8 windows). Used only as a HINT -- the button is
# still verified by role and name before pressing, so a Chrome UI change makes
# this fail loudly rather than press something else.
TOOLBAR_HINT = [0, 0, 5, 1, 0, 6, 6]


def log(msg):
    print(f"{datetime.now():%F %T} {msg}", flush=True)


# ─── AT-SPI helpers ────────────────────────────────────────────────────────

def kids(node):
    """Children of a node. A negative child count is libatspi's ERROR return --
    iterating it as a count yields a silent empty list that is indistinguishable
    from a genuinely empty container. That sentinel misdirected five separate
    investigations on 2026-08-16; treat it as an error, never as zero."""
    try:
        n = node.get_child_count()
    except Exception:
        return []
    if n < 0:
        raise RuntimeError("get_child_count() returned -1: failed call, not an empty container")
    out = []
    for i in range(n):
        try:
            c = node.get_child_at_index(i)
        except Exception:
            c = None
        if c is not None:
            out.append((i, c))
    return out


def nm(n):
    try:
        return n.get_name() or ""
    except Exception:
        return ""


def rl(n):
    try:
        return n.get_role_name() or ""
    except Exception:
        return ""


def chrome_app(pid=None):
    for _, app in kids(Atspi.get_desktop(0)):
        try:
            if nm(app) not in ("Google-chrome", "Google Chrome", "chrome"):
                continue
            if pid is not None and app.get_process_id() != pid:
                continue
        except Exception:
            continue
        return app
    return None


def walk(root, want, limit=120000):
    """Yield (path, node) for nodes matching want(node). Iterative; bounded."""
    stack = [(root, [])]
    seen = 0
    while stack and seen < limit:
        node, path = stack.pop()
        seen += 1
        try:
            if want(node):
                yield path, node
        except Exception:
            pass
        try:
            for i, c in reversed(kids(node)):
                stack.append((c, path + [i]))
        except RuntimeError:
            raise
        except Exception:
            pass


def resolve(root, path):
    node = root
    for i in path:
        node = node.get_child_at_index(i)
    return node


def press(node, what):
    """Invoke the element's own action. No coordinates are involved."""
    n_actions = node.get_n_actions()
    for i in range(n_actions):
        if node.get_action_name(i) in ("press", "click", "activate", "open", "jump"):
            node.do_action(i)
            log(f"  pressed: {what}")
            return True
    if n_actions:
        node.do_action(0)
        log(f"  pressed (default action): {what}")
        return True
    raise RuntimeError(f"{what}: element exposes no actions")


# ─── gates ─────────────────────────────────────────────────────────────────

def idle_ms():
    env = dict(os.environ)
    env.setdefault("DISPLAY", ":1")
    return int(subprocess.check_output(["xprintidle"], env=env, timeout=15).strip())


def require_idle(threshold_ms, stage):
    """⛔ Re-checked before EVERY press, not once at the start. The operator can
    sit down mid-sequence, and the whole point of the gate is that we never
    press under someone's hands."""
    ms = idle_ms()
    if ms < threshold_ms:
        raise AbortForOperator(f"{stage}: idle {ms/1000:.1f}s < {threshold_ms/1000:.0f}s -- operator is active")
    return ms


class AbortForOperator(Exception):
    pass


def host_browser_present():
    try:
        with urllib.request.urlopen(f"{SERVER}/extensions", timeout=10) as r:
            return bool(json.load(r).get("hostBrowserPresent"))
    except Exception as e:
        log(f"  /extensions probe failed: {e}")
        return None


def preserve_evidence(tag):
    """The heartbeat ring is 80 records (~20 min) and the reload starts
    overwriting it immediately, so the outage window must be copied BEFORE the
    repair. While the worker is dead nothing is being written, so there is no
    rush until we press -- but after we press it is gone."""
    dest = os.path.expanduser(f"~/.unibrowse-selfheal/evidence/{tag}")
    for sub, src in (
        ("settings", f"{PROFILE}/Local Extension Settings/{EXT_ID}"),
        ("extstate", f"{PROFILE}/Extension State"),
    ):
        d = os.path.join(dest, sub)
        os.makedirs(d, exist_ok=True)
        try:
            for f in os.listdir(src):
                if f.endswith((".log", ".ldb")):
                    shutil.copy2(os.path.join(src, f), d)
        except Exception as e:
            log(f"  evidence copy failed for {sub}: {e}")
    log(f"  evidence preserved: {dest}")
    return dest


def notify(subject, body, priority="info"):
    for who in [w.strip() for w in NOTIFY.split(",") if w.strip()]:
        payload = json.dumps({
            "to": who, "from": "unibrowse-selfheal",
            "subject": subject, "content": body, "priority": priority,
        }).encode()
        try:
            req = urllib.request.Request(
                f"{ATC}/messages", data=payload,
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:
            log(f"  notify {who} failed: {e}")


# ─── the repair ────────────────────────────────────────────────────────────

def find_toolbar_button(app):
    """Locate the Extensions toolbar button. Tries the measured path first, but
    VERIFIES role+name before use, so a Chrome layout change fails loudly."""
    for widx, win in kids(app):
        try:
            node = resolve(win, TOOLBAR_HINT)
            if rl(node) == "push button" and nm(node) == "Extensions":
                return widx, node
        except Exception:
            pass
    for widx, win in kids(app):
        for _, node in walk(win, lambda n: rl(n) == "push button" and nm(n) == "Extensions"):
            return widx, node
    return None, None


def find_named(app, names, roles=("push button", "menu item", "button")):
    lowered = [s.lower() for s in names]
    for widx, win in kids(app):
        for path, node in walk(win, lambda n: rl(n) in roles and nm(n).strip().lower() in lowered):
            return widx, node, path
    return None, None, None


def find_card_reload(app):
    """Find the unibrowse card's Reload.

    ⚠️ TWO buttons are named 'Reload'. The browser toolbar's page-Reload has NO
    'document web' ancestor; the extension card's does. Discriminating by name
    alone reloads the current page and silently does nothing for us. We also
    require a sibling heading 'unibrowse' so we cannot press another card."""
    for widx, win in kids(app):
        if not nm(win).startswith("Extensions"):
            continue
        for path, node in walk(win, lambda n: rl(n) in ("push button", "button")
                               and nm(n).strip().lower() == "reload"):
            parent = resolve(win, path[:-1])
            sibs = [(rl(c), nm(c)) for _, c in kids(parent)]
            if not any(r == "heading" and n.strip().lower() == "unibrowse" for r, n in sibs):
                continue
            anc, is_doc = node, False
            for _ in range(20):
                anc = anc.get_parent()
                if anc is None:
                    break
                if rl(anc) == "document web":
                    is_doc = True
                    break
            if not is_doc:
                continue
            return widx, node
    return None, None


def repair(threshold_ms, dry_run):
    app = chrome_app()
    if app is None:
        raise RuntimeError("no Google Chrome application on the accessibility bus")

    widx, node = find_card_reload(app)
    if node is None:
        log("  chrome://extensions not open -- opening it via the toolbar")
        widx, tb = find_toolbar_button(app)
        if tb is None:
            raise RuntimeError("Extensions toolbar button not found")
        if dry_run:
            log(f"  DRY RUN: would press Extensions toolbar button (window {widx})")
        else:
            require_idle(threshold_ms, "before toolbar press")
            press(tb, "Extensions toolbar button")
            time.sleep(1.5)

        _, mg, _ = find_named(app, ["Manage extensions", "Manage Extensions"])
        if mg is None:
            if dry_run:
                log("  DRY RUN: 'Manage extensions' not visible (popup not open) -- expected")
            else:
                raise RuntimeError("'Manage extensions' not found after opening the popup")
        else:
            if dry_run:
                log("  DRY RUN: would press 'Manage extensions'")
            else:
                require_idle(threshold_ms, "before 'Manage extensions'")
                press(mg, "Manage extensions")
                time.sleep(2.5)

        widx, node = find_card_reload(app)

    if node is None:
        if dry_run:
            log("  DRY RUN: card Reload not reachable without pressing -- expected")
            return False
        raise RuntimeError("unibrowse card Reload not found")

    log(f"  located unibrowse card Reload (window {widx})")
    if dry_run:
        log("  DRY RUN: would press Reload -- stopping here, nothing was pressed")
        return False

    # Last-moment re-check: the toolbar -> popup -> page sequence above takes
    # several seconds, and THIS is the press that actually causes an outage.
    # If the extension reconnected while we were navigating, pressing Reload
    # would drop a working socket.
    if host_browser_present():
        log("  host browser reconnected mid-sequence -- NOT pressing Reload")
        return False

    require_idle(threshold_ms, "before Reload press")
    press(node, "unibrowse card Reload")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idle-threshold", type=float, default=180,
                    help="seconds of X idle required before any press (default 180)")
    ap.add_argument("--wait-minutes", type=float, default=0,
                    help="keep polling this long for an idle window (0 = single attempt)")
    ap.add_argument("--poll-seconds", type=float, default=60)
    ap.add_argument("--dry-run", action="store_true", help="locate everything, press nothing")
    ap.add_argument("--force", action="store_true", help="repair even if the server says the browser is present")
    args = ap.parse_args()

    threshold_ms = int(args.idle_threshold * 1000)
    deadline = time.time() + args.wait_minutes * 60

    present = host_browser_present()
    if present and not args.force:
        log("host browser is present -- nothing to do")
        return 0
    if present is None and not args.force:
        log("could not probe the server; refusing to drive the UI on an unknown state")
        return 2

    log(f"host browser DOWN (dry_run={args.dry_run}, idle gate {args.idle_threshold:.0f}s)")

    attempt = 0
    while True:
        attempt += 1

        # ⛔ RE-CHECK EVERY ITERATION, not just at startup. While we sit here
        # waiting for the desk to go idle, the extension can come back by some
        # other route -- most likely a human noticing and clicking Reload
        # themselves, which is exactly what happened on 2026-08-19. A version
        # that only checked at startup stayed armed against a now-HEALTHY
        # extension and would have reloaded it the moment the operator stepped
        # away, manufacturing the very outage it exists to repair. The failure
        # direction is toward ACTING, so it must be re-tested, not assumed.
        if not args.force:
            still_down = host_browser_present()
            if still_down:
                log("host browser came back by other means -- standing down, nothing to repair")
                return 0
            if still_down is None:
                log("server probe failed; refusing to drive the UI on an unknown state")
                return 2

        try:
            ms = idle_ms()
        except Exception as e:
            log(f"xprintidle failed: {e}")
            return 2

        if ms < threshold_ms and not args.dry_run:
            remaining = deadline - time.time()
            if remaining <= 0:
                log(f"idle {ms/1000:.0f}s < gate; wait window expired -- leaving it for a human")
                notify("self-heal stood down: operator active",
                       f"Extension still down. X idle stayed under {args.idle_threshold:.0f}s for the whole "
                       f"{args.wait_minutes:.0f}-minute window, so the repair was never attempted -- it drives "
                       f"the desktop UI and the operator was using it.\n\nRepair by hand: the Reload control on "
                       f"the unibrowse card at chrome://extensions (AXPress, never a coordinate click).",
                       "warning")
                return 3
            log(f"attempt {attempt}: idle {ms/1000:.0f}s < gate {args.idle_threshold:.0f}s -- waiting "
                f"({remaining/60:.0f} min left)")
            time.sleep(args.poll_seconds)
            continue

        tag = datetime.now().strftime("%Y%m%d-%H%M%S")
        if not args.dry_run:
            preserve_evidence(tag)
        try:
            pressed = repair(threshold_ms, args.dry_run)
        except AbortForOperator as e:
            log(f"ABORTED mid-sequence: {e}")
            if time.time() < deadline:
                time.sleep(args.poll_seconds)
                continue
            notify("self-heal aborted: operator returned mid-repair",
                   f"{e}\n\nNothing was left in a bad state -- at worst an extensions tab is open. "
                   f"The extension is still down.", "warning")
            return 3
        except Exception as e:
            log(f"repair failed: {e}")
            notify("self-heal FAILED", f"{e}\n\nExtension still down; repair by hand.", "warning")
            return 1

        if args.dry_run:
            log("dry run complete -- nothing was pressed")
            return 0

        if not pressed:
            # repair() declined (the browser came back mid-sequence). Do NOT
            # fall through to the verification below: it would observe a
            # healthy browser and report a self-heal that never happened.
            log("nothing was pressed -- not claiming a repair")
            return 0

        for _ in range(12):
            time.sleep(5)
            if host_browser_present():
                log("VERIFIED: host browser is present again")
                notify("host browser self-healed on office",
                       f"The unibrowse card's Reload was pressed via AT-SPI at {datetime.now():%F %T} "
                       f"after the desk went idle, and the extension reconnected.\n\n"
                       f"Evidence from the outage was preserved first: ~/.unibrowse-selfheal/evidence/{tag}\n\n"
                       f"⚠️ This says the socket is back, not that sign-in works -- confirm with a "
                       f"browser_get_version round-trip pinned to the extensionId before relying on it.")
                return 0
        log("pressed Reload but the browser did not come back within 60s")
        notify("self-heal pressed Reload but the browser did not return",
               "The Reload control was pressed and the extension did not reconnect within 60s. "
               "This is NOT the known service-worker bug's usual behaviour -- investigate rather than "
               "pressing again.", "warning")
        return 1


if __name__ == "__main__":
    sys.exit(main())
