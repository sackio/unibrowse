#!/usr/bin/env python3
"""Transplant a logged-in session from a unibrowse-driven browser into a kept
Drover profile, so the profile is signed in without a password or a 2FA code.

⭐ WHY. Amazon (and eBay, DoorDash) serve the unibrowse CDP extension a bot
wall; Drover drives a real Chrome with XTEST and is not walled. But Drover has
no login for these sites. A session that is ALREADY logged in on one of the
operator's real browsers can be copied: its auth cookies (at-main, ebaysid,
...) are read over the unibrowse MCP and set into the Drover profile with the
`setcookies` step, which uses Storage.setCookies and so carries httpOnly
cookies that document.cookie cannot.

⛔ COOKIE VALUES NEVER TOUCH THIS PROCESS'S STDOUT, ARGV, OR AN AGENT CONTEXT.
They are read server-to-server from the MCP straight into a 600 file in the
profile's .run dir, handed to Drover through a mounted /share, and the file is
deleted in the finally. This script prints the login's NAMES and the verify
screenshot path, never a value.

  transplant.py --ext ext_b39... --domain amazon.com --profile .../amazon \
                --verify-url https://www.amazon.com/ --label amazon

Then Read the printed screenshot to confirm the signed-in state.
"""
import argparse, json, os, pathlib, shutil, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _drover

MCP = os.environ.get("UNIBROWSE_MCP", "http://127.0.0.1:9010/mcp")


def mcp_cookies(ext, domain, mcp=MCP):
    """Read cookies for a domain from a unibrowse-connected browser, via the
    MCP HTTP transport. Returns the raw cookie list; values are not logged."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": "browser_get_cookies",
                                  "arguments": {"extensionId": ext, "domain": domain}}}).encode()
    req = urllib.request.Request(mcp, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode()
    # streamable HTTP: the result arrives on a `data:` SSE line
    payload = None
    for line in raw.splitlines():
        line = line[5:].strip() if line.startswith("data:") else (line if line.startswith("{") else "")
        if not line:
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        if j.get("id") == 1 and "result" in j:
            payload = j["result"]
            break
    if payload is None:
        raise SystemExit("MCP returned no result for browser_get_cookies")
    text = payload["content"][0]["text"]
    return json.loads(text).get("cookies", [])


def mcp_capture(ext, tab, urls, mcp=MCP):
    """Full-session capture via browser_capture_session: cookies for every requested
    domain (incl HttpOnly) PLUS the tab's localStorage/sessionStorage — the token
    store a modern SPA/MSAL login keeps auth in, which no cookie carries. Returns the
    whole object; values are not logged (the caller prints only names/counts)."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": "browser_capture_session",
                                  "arguments": {"extensionId": ext, "tabTarget": tab,
                                                "urls": urls,
                                                # don't let jsonResponse truncate a full
                                                # session (many large MSAL token values) —
                                                # truncation yields invalid/partial JSON.
                                                "max_tokens": 5000000}}}).encode()
    req = urllib.request.Request(mcp, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode()
    payload = None
    for line in raw.splitlines():
        line = line[5:].strip() if line.startswith("data:") else (line if line.startswith("{") else "")
        if not line:
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        if j.get("id") == 1 and "result" in j:
            payload = j["result"]
            break
    if payload is None:
        raise SystemExit("MCP returned no result for browser_capture_session")
    # strict=False: cookie/storage VALUES can contain raw control chars (a token
    # with an embedded newline, say); the re-serialization to the share file escapes
    # them properly. Strict parsing would reject the whole capture over one value.
    return json.loads(payload["content"][0]["text"], strict=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ext", required=True, help="source extensionId (the logged-in browser)")
    ap.add_argument("--domain", help="cookie domain, e.g. amazon.com (cookie-only mode)")
    ap.add_argument("--profile", required=True, help="target Drover profile dir")
    ap.add_argument("--verify-url", required=True)
    ap.add_argument("--label", default="site")
    ap.add_argument("--full", action="store_true",
                    help="full-session capture (cookies + localStorage/sessionStorage) via "
                         "browser_capture_session — for SPA/MSAL/OAuth logins cookies alone can't carry")
    ap.add_argument("--tab", default=None, help="source tabTarget for --full (the authed tab)")
    ap.add_argument("--urls", default="",
                    help="comma-separated extra URLs/origins to capture cookies for (--full); "
                         "the authed tab's own URL is always included")
    args = ap.parse_args()
    if not args.full and not args.domain:
        ap.error("--domain is required unless --full")

    prof = os.path.expanduser(args.profile)
    pathlib.Path(prof).mkdir(parents=True, exist_ok=True)
    os.chmod(prof, 0o700)
    out = prof + "-shots"
    pathlib.Path(out).mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o777)

    if args.full:
        extra = [u.strip() for u in args.urls.split(",") if u.strip()]
        cap = mcp_capture(args.ext, args.tab, extra)
        cookies = cap.get("cookies", [])
        storage = cap.get("storage", {})
        cur = cap.get("currentUrl", "")
        local = storage.get("local") or {}
        session = storage.get("session") or {}
        cnames = sorted({c.get("name", "") for c in cookies})
        snames = sorted(list(local.keys()) + list(session.keys()))
        print("captured %d cookies: %s" % (len(cookies), ", ".join(cnames)))
        print("captured storage origin=%s local=%d session=%d: %s"
              % (storage.get("origin", ""), len(local), len(session), ", ".join(snames)))

        share = pathlib.Path(prof + ".run", "share")
        if share.exists():
            shutil.rmtree(share)
        share.mkdir(mode=0o777, parents=True)
        (share / "cookies.json").write_text(json.dumps(cookies))
        os.chmod(str(share / "cookies.json"), 0o600)
        (share / "storage.json").write_text(json.dumps(storage))
        os.chmod(str(share / "storage.json"), 0o600)
        os.chmod(str(pathlib.Path(prof + ".run")), 0o711)

        origin = storage.get("origin") or cur or args.verify_url
        steps = [
            {"do": "setcookies", "from": "/share/cookies.json"},
            {"do": "nav", "url": origin},
            {"do": "setstorage", "from": "/share/storage.json"},
            {"do": "nav", "url": args.verify_url},
            {"do": "wait", "seconds": 7},
            {"do": "eval", "js": "JSON.stringify({title:document.title,"
                                 "snippet:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,400)})",
             "as": "state"},
            {"do": "shot", "path": "/out/%s_verify.png" % args.label},
        ]
        try:
            r = _drover.run_session(prof, steps, timeout=300, share=str(share), out=out)
            for s in r.get("steps", []):
                print(s.get("i"), s.get("do"), s.get("status"),
                      {k: v for k, v in s.items() if k in ("set", "names", "keys")})
            print("STATE:", (r.get("reads") or {}).get("state"))
            print("SHOT:", "%s/%s_verify.png" % (out, args.label))
        finally:
            shutil.rmtree(share, ignore_errors=True)
            os.chmod(str(pathlib.Path(prof + ".run")), 0o700)
            print("cleaned: session files + share dir removed")
        return

    cookies = mcp_cookies(args.ext, args.domain)
    names = sorted({c.get("name", "") for c in cookies})
    print("read %d cookies for %s: %s" % (len(cookies), args.domain, ", ".join(names)))

    share = pathlib.Path(prof + ".run", "share")
    if share.exists():
        shutil.rmtree(share)
    share.mkdir(mode=0o777, parents=True)
    dst = share / "cookies.json"
    dst.write_text(json.dumps(cookies))
    os.chmod(str(dst), 0o644)
    os.chmod(str(pathlib.Path(prof + ".run")), 0o711)

    steps = [
        {"do": "setcookies", "from": "/share/cookies.json"},
        {"do": "nav", "url": args.verify_url},
        {"do": "wait", "seconds": 6},
        {"do": "eval", "js": "JSON.stringify({title:document.title,"
                             "snippet:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,400)})",
         "as": "state"},
        {"do": "shot", "path": "/out/%s_verify.png" % args.label},
    ]
    try:
        r = _drover.run_session(prof, steps, timeout=300, share=str(share), out=out)
        for s in r.get("steps", []):
            print(s.get("i"), s.get("do"), s.get("status"),
                  {k: v for k, v in s.items() if k in ("set", "names")})
        print("STATE:", (r.get("reads") or {}).get("state"))
        print("SHOT:", "%s/%s_verify.png" % (out, args.label))
    finally:
        shutil.rmtree(share, ignore_errors=True)
        os.chmod(str(pathlib.Path(prof + ".run")), 0o700)
        print("cleaned: cookie file + share dir removed")


if __name__ == "__main__":
    main()
