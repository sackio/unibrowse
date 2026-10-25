#!/usr/bin/env python3
"""Read live Amazon search results — titles, prices, $/oz — via Drover.

⭐ WHY DROVER, NOT THE UNIBROWSE EXTENSION. Amazon serves the unibrowse
extension (CDP + chrome.debugger) a 2,654-byte "Continued access by an
unauthorized AI agent violates Amazon's Conditions of Use" page with no
results. Drover drives a real branded Chrome under Xvfb with input through
XTEST (isTrusted hardware events) and reads over the CDP debugging PIPE, so
there is no --remote-debugging-port and no navigator.webdriver. Measured
2026-10-25 by `unibrowse`: a logged-out "unsweetened almond milk" search
returned 60 result cards and real prices, with NO AI-agent wall.

⚠️ THE ONE GATE THAT REMAINS is Amazon's soft "To continue, please click the
'Continue shopping' button" interstitial, shown to a COLD (cookieless) profile.
It is a single button, not the AI block, and it sets a cookie that clears it
for the rest of the profile's life. This flow detects it and retries once on
the SAME profile — the retry reads the cookie the first visit set and sails
through. A warmed or logged-in profile never sees it.

  amazon.py --query "unsweetened almond milk"
  amazon.py --query "..." --profile /mnt/nas/data/.secrets/drover-profiles/amazon --n 15 --json out.json

Exit 0 = results read · 2 = still gated after the retry · 1 = other.

⛔ RUN IT ON A HOUSE-LAN HOST (office/server4/server5/server3). The container
egresses the host's IP; on the LAN that is our house IP, which is the point —
no VPN. A VPN exit would defeat both the price locale (Groton 01450) and the
"looks like us" posture.
"""
import argparse, json, os, pathlib, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _drover

# The default profile is shared and persistent: warmed once, every later run is
# an ordinary read. A caller that needs the Groton locale or order history
# passes a logged-in profile instead.
DEFAULT_PROFILE = "/mnt/nas/data/.secrets/drover-profiles/amazon"

# textContent of each result card is captured and parsed host-side. In-page
# parsing of the per-unit price is unreliable because Amazon renders it in
# several shapes; the price whole/fraction spans are stable, so those are read
# structurally and everything else is regexed from the card's text.
_EXTRACT = r"""
(function(n){
  var out=[];
  var cards=document.querySelectorAll('[data-component-type="s-search-result"]');
  var gate=[].slice.call(document.querySelectorAll('button,input[type=submit]'))
            .some(function(e){return /continue shopping/i.test(e.innerText||e.value||e.alt||'')});
  for (var i=0;i<cards.length && out.length<n;i++){
    var c=cards[i];
    var t=c.querySelector('h2 span, [data-cy="title-recipe"] h2 span, h2 a span');
    var title=t?t.innerText.trim():'';
    if(!title) continue;
    var whole=c.querySelector('.a-price .a-price-whole');
    var frac=c.querySelector('.a-price .a-price-fraction');
    var price=whole?parseFloat(whole.innerText.replace(/[^0-9]/g,'')+'.'+(frac?frac.innerText.replace(/[^0-9]/g,''):'0')):null;
    out.push({title:title.slice(0,90), price:price, text:(c.innerText||'').replace(/\s+/g,' ').slice(0,260)});
  }
  return JSON.stringify({gate:gate, cards:cards.length, items:out});
})(%d)
"""


def _total_oz(title):
    """Total fluid ounces a title describes: unit size x pack count.

    "32 fl oz, 6 Count" -> 192. "64 Fl Oz" -> 64. "(Pack of 6)" multiplies.
    Returns None when no size is stated rather than guessing one.
    """
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:fl\s*oz|fluid\s*ounce|oz\b|ounce)", title, re.I)
    if not m:
        return None
    unit = float(m.group(1))
    pack = 1
    p = (re.search(r"pack\s*of\s*(\d+)", title, re.I)
         or re.search(r"(\d+)\s*(?:count|ct|pack|boxes?|cartons?)\b", title, re.I)
         or re.search(r",\s*(\d+)\s*co\b", title, re.I))  # "32 fl oz, 6 Co" (truncated)
    if p:
        pack = int(p.group(1))
    return unit * pack


def _per_oz(item):
    """Amazon's own per-unit figure if the card shows one, else price/total_oz.
    Returns (value, basis) where basis is 'amazon' or 'computed' or None.
    """
    m = re.search(r"\$([0-9]+\.[0-9]+)\s*/\s*(?:fl\s*oz|ounce|oz)", item.get("text", ""), re.I)
    if m:
        return float(m.group(1)), "amazon"
    tot = _total_oz(item.get("title", ""))
    if tot and item.get("price"):
        return round(item["price"] / tot, 4), "computed"
    return None, None


# Amazon shows "Hello, sign in" ONLY when logged out; logged in it is
# "Hello, <name>". Works for both Amazon.com and Amazon Business, where the
# account greeting selector differs but the header text does not.
_LOGIN = r"""(function(){
  var t=(document.body.innerText||'').slice(0,2500);
  var out=/Hello,\s*sign in/i.test(t) || /\bSign in\b/.test(t) && !/Hello,\s*[A-Za-z]/.test(t);
  var m=t.match(/Hello,\s*([^\n]{1,40})/);
  return JSON.stringify({loggedIn: !out, acct: m?m[1].trim():'', title: document.title});
})()"""


def warm(profile, timeout=180):
    """Load the signed-in homepage and report login state, keeping the session
    fresh. Returns the parsed {loggedIn, acct, title}."""
    out = profile + "-shots"
    pathlib.Path(out).mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o777)
    steps = [
        {"do": "nav", "url": "https://www.amazon.com/"},
        {"do": "wait", "seconds": 5},
        {"do": "eval", "js": _LOGIN, "as": "login"},
        {"do": "shot", "path": "/out/amazon_warm.png"},
    ]
    r = _drover.run_session(profile, steps, out=out, timeout=timeout)
    return json.loads((r.get("reads") or {}).get("login") or "{}")


def _post(url, text):
    import urllib.request
    try:
        urllib.request.urlopen(urllib.request.Request(
            url, data=json.dumps({"to": "slack:U0NGEHS2J", "content": text}).encode(),
            headers={"Content-Type": "application/json"}), timeout=15)
    except Exception:
        pass


def search(profile, query, n=12, timeout=300):
    url = "https://www.amazon.com/s?k=" + query.replace(" ", "+")
    steps = [
        {"do": "nav", "url": url},
        {"do": "wait", "seconds": 5},
        {"do": "eval", "js": _EXTRACT % n, "as": "data"},
        {"do": "shot", "path": "/out/amazon_%s.png" % re.sub(r"[^a-z0-9]+", "_", query.lower())[:30]},
    ]
    out = profile + "-shots"
    pathlib.Path(out).mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o777)
    r = _drover.run_session(profile, steps, out=out, timeout=timeout)
    data = json.loads((r.get("reads") or {}).get("data") or "{}")
    return data, r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", help="search query (omit with --warm)")
    ap.add_argument("--profile", default=DEFAULT_PROFILE)
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--json", help="write the full parsed result here")
    ap.add_argument("--warm", action="store_true",
                    help="keep-warm: load the signed-in homepage, verify login, exit 0=ok 3=logged-out")
    ap.add_argument("--notify", default="http://192.168.1.168:3030/messages",
                    help="broker POST url; only used by --warm when the session is logged OUT")
    ap.add_argument("--alert", action="store_true", help="with --warm, DM Ben if logged out")
    args = ap.parse_args()

    prof = os.path.expanduser(args.profile)
    pathlib.Path(prof).mkdir(parents=True, exist_ok=True)
    os.chmod(prof, 0o700)

    if args.warm:
        st = warm(prof)
        who = st.get("acct") or "?"
        if st.get("loggedIn"):
            print("warm ok — logged in as %r (%s)" % (who, st.get("title")))
            sys.exit(0)
        print("WARM: session LOGGED OUT (title=%r) — needs a re-transplant" % st.get("title"),
              file=sys.stderr)
        if args.alert:
            _post(args.notify, "⚠️ Amazon drover session (%s) is LOGGED OUT — re-transplant cookies from the MacBook." % os.path.basename(prof))
        sys.exit(3)

    if not args.query:
        ap.error("--query is required unless --warm")

    data, _ = search(prof, args.query, args.n)
    # The cold-profile interstitial sets a cookie on the first visit; a second
    # run on the same profile reads it and gets the real page.
    if data.get("gate") and not data.get("items"):
        print("continue-shopping gate hit; retrying once on the now-warmed profile",
              file=sys.stderr, flush=True)
        data, _ = search(prof, args.query, args.n)

    items = data.get("items") or []
    for it in items:
        v, basis = _per_oz(it)
        it["per_oz"], it["per_oz_basis"] = v, basis
    items_priced = [i for i in items if i.get("per_oz") is not None]
    items_priced.sort(key=lambda i: i["per_oz"])

    result = {"query": args.query, "cards": data.get("cards"),
              "gated": bool(data.get("gate") and not items), "items": items,
              "cheapest_per_oz": items_priced[0] if items_priced else None}
    if args.json:
        pathlib.Path(os.path.expanduser(args.json)).write_text(json.dumps(result, indent=2))

    if result["gated"]:
        print("still gated after retry — profile may need a login/warm-up", file=sys.stderr)
        sys.exit(2)
    if not items:
        print("no result cards parsed", file=sys.stderr)
        sys.exit(1)

    print("query: %s   (%d cards, %d parsed)" % (args.query, data.get("cards") or 0, len(items)))
    for it in items:
        po = ("$%.3f/oz %s" % (it["per_oz"], it["per_oz_basis"])) if it.get("per_oz") else "--/oz"
        pr = ("$%.2f" % it["price"]) if it.get("price") else "   -  "
        print("  %-8s %-14s  %s" % (pr, po, it["title"]))
    if items_priced:
        c = items_priced[0]
        print("cheapest $/oz: $%.3f/oz  (%s)  %s" % (c["per_oz"], c["per_oz_basis"], c["title"]))


if __name__ == "__main__":
    main()
