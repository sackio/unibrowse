"""The outreach lane's contact-form job, run by the Drover worker:

  drover_worker.py contact --row JSON --config contact-config.json [--dry]

Owned by the outreach lane; the worker (drover/worker/*) is unibrowse's. This
file is loaded by path from the worker, which passes itself in as `w` for the
hand (w.Hands), the X input (w.xdo) and the motion model (w.CFG, w.hm).
"""
import json, os, random, re, sys, time

# Captcha widgets a hand can press, by the frame they render in, with where
# the checkbox sits inside it (fractions of the frame's box), and the field a
# solved widget writes its token into.
WIDGETS = [
    ("recaptcha", "iframe[src*='recaptcha/api2/anchor'],iframe[src*='recaptcha/enterprise/anchor']", 0.10, 0.5, "g-recaptcha-response"),
    ("hcaptcha", "iframe[src*='hcaptcha.com'][src*='frame=checkbox']", 0.10, 0.5, "h-captcha-response"),
    ("turnstile", "iframe[src*='challenges.cloudflare.com']", 0.10, 0.5, "cf-turnstile-response"),
]
TOKEN = ("(n => [...document.querySelectorAll(`textarea[name=\"${n}\"],input[name=\"${n}\"]`)]"
         ".some(e => e.value.length > 20))")
CAPTCHA_PRESENT = ("!!document.querySelector(\"[data-sitekey],.g-recaptcha,.h-captcha,.cf-turnstile,"
                   "script[src*='recaptcha/api.js'],script[src*='recaptcha/enterprise.js'],script[src*='hcaptcha.com/1/api.js']\")")


def paid_solve(b, url, kind, cfg):
    """Ask the host's solve broker (outreach/solve_broker.py) for a token and
    write it in with the lane's own INJECT. The broker holds the 2Captcha key,
    the ONE spend ledger and the cap; a pod never buys anything itself.
    Returns (token_landed, why)."""
    import urllib.request
    k = json.loads(b.eval(cfg["SITEKEY"]) or "{}")
    if not k.get("key"):
        return False, "no sitekey on the page"
    if kind == "turnstile":
        task = "turnstile"
    elif b.eval("!!document.querySelector(\"iframe[src*='recaptcha/api2/anchor'][src*='size=invisible'],[data-size=invisible]\")"):
        task = "recaptcha-invisible"
    elif b.eval("!!document.querySelector(\"iframe[src*='recaptcha'][src*='anchor']\")"):
        task = "recaptcha-v2"
    else:
        return False, "no reCAPTCHA widget to solve (v3/score) — not bought"
    field = "cf-turnstile-response" if task == "turnstile" else "g-recaptcha-response"
    # ⛔ Check the field exists BEFORE buying (the lane paid for turnstile tokens
    # with nowhere to write them, 2026-10-23).
    if not json.loads(b.eval(cfg["FIELD_PRESENT"].replace("__FIELD__", field)) or "{}").get("n"):
        return False, f"no {field} field in the page — not bought"
    req = urllib.request.Request(os.environ["DROVER_SOLVER_URL"], data=json.dumps(
        {"url": url, "kind": task, "sitekey": k["key"], "action": k.get("action"), "enterprise": k.get("enterprise")}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ.get("DROVER_SOLVER_TOKEN", "")})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=240).read())
    except Exception as e:
        return False, f"solve broker unreachable: {e}"
    if r.get("error"):
        return False, "paid solve refused: " + r["error"][:120]
    inj = cfg["INJECT"].replace("__TOKEN__", json.dumps(r["token"])).replace("__FIELD__", json.dumps(r["field"]))
    # An open alert() freezes every evaluate in the page (live 2026-10-25: two
    # tokens bought, both writes "gave no answer in 30s"). Close one if it is up.
    try:
        b.send("Page.handleJavaScriptDialog", {"accept": True}, timeout=5)
    except Exception:
        pass
    fired, seen = 0, []                                # seen: what each write attempt reported, for the note
    for _ in range(2):                                 # the token is paid for: try the write twice
        try:
            res = json.loads(b.eval_main(inj) or "{}")
            fired += res.get("callbacks") or 0
            seen.append(f"w{res.get('fields')}/{res.get('after')}")
        except Exception as e:
            seen.append("x:" + str(e)[:60])
            time.sleep(1)
            continue
        time.sleep(1)
        try:
            if b.eval(TOKEN + f"({json.dumps(r['field'])})"):
                return True, f"paid ${r.get('cost')}"
        except Exception:
            pass
        if fired:
            break
    # ⛔ On INVISIBLE reCAPTCHA the widget's callback IS the site's submit, so a
    # fired callback followed by an empty field can mean the form already went
    # (live chunk 2026-10-24: two such rows were first recorded `blocked`).
    if fired:
        return None, f"token bought (${r.get('cost')}), widget callback fired ({fired}), field empty after — may have submitted"
    return False, f"token bought (${r.get('cost')}) but it did not land in the page [{' '.join(seen)}]"


# Marks the button that dismisses a visible cookie/consent layer (data-ub-cc)
# and returns true, or false when no such layer is up. A layer is a fixed or
# sticky box whose text talks about cookies or consent. Refusing beats accepting.
# The open reCAPTCHA challenge popup, as [left, top, w, h, innerWidth,
# innerHeight, dpr], or null once it is closed (its container goes hidden).
CHALLENGE_RECT = r"""(() => {
  const f = [...document.querySelectorAll("iframe[src*='recaptcha'][src*='bframe']")].find(f => {
    const r = f.getBoundingClientRect();
    return r.height > 100 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(f).visibility !== "hidden"
      && (!f.offsetParent || getComputedStyle(f.offsetParent).visibility !== "hidden");
  });
  if (!f) return null;
  const r = f.getBoundingClientRect();
  return [r.left, r.top, r.width, r.height, innerWidth, innerHeight, devicePixelRatio];
})()"""

DISMISS_CONSENT = r"""(() => {
  document.querySelectorAll('[data-ub-cc]').forEach(e => e.removeAttribute('data-ub-cc'));
  const shown = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const layer = e => { for (let p = e; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if ((pos === 'fixed' || pos === 'sticky') && /cookie|consent|gdpr|privacy/i.test(p.innerText || '')) return true; }
    return false; };
  const btns = [...document.querySelectorAll('button, a[role=button], [role=button], input[type=button], input[type=submit]')]
    .filter(e => shown(e) && layer(e));
  const label = e => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim();
  for (const re of [/^(reject|decline|deny)( all)?\b|necessary only|only (necessary|essential)|essential only/i,
                    /^(accept|allow|agree|ok|okay|got it|i understand|understood|i agree)\b/i, /^(close|dismiss|×|x)$/i]) {
    const b = btns.find(e => re.test(label(e)));
    if (b) { b.setAttribute('data-ub-cc', '1'); return true; }
  }
  return false;
})()"""


NEAR_TARGET = r"""((sel, x, y) => {
  const t = document.querySelector(sel), e = document.elementFromPoint(x, y);
  if (!t || !e) return false;
  return e === t || t.contains(e) || e.contains(t) || e.control === t
      || (e.parentElement && e.parentElement === t.parentElement);
})"""


def click_field(b, hands, w, sel):
    """Hands.click, plus one guarded second chance. The click's own hit test can
    refuse a hand that is on the field: live 2026-10-25 the page saw the pointer
    exactly at the aim and the test still failed (a floating label or wrapper on
    top). So when it refuses, press only if what lies under the aim is the field,
    its label, a wrapper or a sibling, and keep the row only if the field then
    has focus: the page's own word that the press reached it."""
    try:
        hands.click(sel)
        return
    except RuntimeError as e:
        m = re.search(r"aim (\d+),(\d+)", str(e))
        if "pointer would not land" not in str(e) or not m:
            raise
        x, y = int(m.group(1)), int(m.group(2))
        px, py = hands.where()                          # the press lands where the hand IS
        if abs(px - (hands.dx + x)) > 3 or abs(py - (hands.dy + y)) > 3:
            raise
        if not b.eval(NEAR_TARGET + f"({json.dumps(sel)}, {x}, {y})"):
            raise
        pre, dwell = w.hm.press_timing(w.CFG)
        w.xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")
        time.sleep(0.3)
        if not b.eval(f"(t => !!t && (document.activeElement === t || t.contains(document.activeElement)))"
                      f"(document.querySelector({json.dumps(sel)}))"):
            raise


def job_contact(b, row, cfg, w, dry=False, shot=None):
    """One outreach row: open a town's contact form, fill it by hand, press any
    captcha checkbox, submit, and read the verdict. Field choice, message and
    the success/refusal patterns are the v1 lane's own (outreach/
    extract_config.py lifts them), so both lanes post the same text and score
    the same way. Statuses match the lane's results file.

    ⛔ No captcha is ever bought in the pod. With DROVER_SOLVER_URL set, a
    widget the hand could not clear goes to the host's solve broker (one
    ledger, one cap); without it, or when the broker refuses, the row ends
    `blocked` before submit. A form is never sent without the token it asked for.
    `dry` stops before the submit press: a timing run that sends nothing."""
    import re
    t0 = time.time()
    ok_rx, fail_rx = re.compile(cfg["OK_CONTACT"], re.I), re.compile(cfg["FAIL_TEXT"], re.I)

    def done(status, note):
        if shot:
            try:
                b.shot(shot)
            except (TimeoutError, RuntimeError):
                pass
        return {"key": row["key"], "address": row["address"], "status": status, "note": note[:300],
                "exitIp": (b.ident or {}).get("ip"), "seconds": round(time.time() - t0, 1)}

    try:
        b.navigate(row["url"], settle=2.0)
    except Exception as e:
        return done("error", f"navigate: {e}")
    # Forms render late (JS builders, consent walls): ask again for ~20 s.
    found = {}
    for _ in range(10):
        try:
            found = json.loads(b.eval(cfg["DISCOVER_CONTACT"]) or "{}")
        except Exception as e:
            found = {"ok": False, "why": f"discover failed: {e}"}
        if found.get("ok"):
            break
        time.sleep(2)
    if not found.get("ok"):
        return done("noform", found.get("why", "no form"))
    town = row.get("town") or row["address"].split("@")[0]
    values = {"email": row["address"], "first": row["first"], "last": row["last"],
              "full": (row["first"] + " " + row["last"]).strip(), "subject": cfg["SUBJECT"],
              "message": cfg["MSG_TMPL"].replace("{address}", row["address"]).replace("{town}", town)}
    hands = w.Hands(b)
    try:
        hands.calibrate()
        # A cookie modal can cover the form and lock the page's scroll (live
        # 2026-10-25, ghentmn.gov: CookieConsent's #cc-main over every field,
        # "could not scroll into view"). Dismiss it by hand, refusing first.
        for _ in range(2):
            if not b.eval(DISMISS_CONSENT):
                break
            hands.click("[data-ub-cc]")
            time.sleep(random.uniform(0.6, 1.2))
        for k in ("first", "last", "full", "email", "subject", "message"):
            if k != "email" and k != "message" and not found["fields"].get(k):
                continue
            sel = f"[data-ub-f='{k}']"
            click_field(b, hands, w, sel)
            hands.type(values[k])
            # The last keystroke can still be in flight when typing returns
            # (measured: "Stor" for "Store"). Give the page a moment to catch up.
            for _ in range(10):
                got = b.eval(f"(e => e && e.value)(document.querySelector({json.dumps(sel)}))")
                if got == values[k]:
                    break
                time.sleep(0.15)
            if got != values[k]:
                return done("error", f"field {k} reads back {str(got)[:60]!r}")
            time.sleep(random.uniform(0.3, 1.0))
        for i in range(len(found.get("boxes") or [])):
            hands.click(f"[data-ub-f='box{i}']")
            time.sleep(random.uniform(0.2, 0.6))
    except RuntimeError as e:
        return done("blocked", f"form field unreachable — {e}")
    kind = "none"
    if b.eval(CAPTCHA_PRESENT):
        kind = "captcha"
        for name, sel, fx, fy, field in WIDGETS:
            if not b.eval(f"!!document.querySelector({json.dumps(sel)})"):
                continue
            kind = name
            try:
                left, top, bw, bh, dpr = hands.reach(sel)
            except RuntimeError as e:
                return done("blocked", f"{name}: widget unreachable — {e}")
            hands.move_screen(round(hands.dx + (left + bw * fx) * dpr), round(hands.dy + (top + bh * fy) * dpr), width=24 * dpr)
            pre, dwell = w.hm.press_timing(w.CFG)
            w.xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")
            for _ in range(8):
                time.sleep(1)
                if b.eval(TOKEN + f"({json.dumps(field)})"):
                    break
            break
        token = any(b.eval(TOKEN + f"({json.dumps(f)})") for *_, f in WIDGETS)
        if not token and not dry and os.environ.get("DROVER_SOLVER_URL") and kind in ("recaptcha", "turnstile", "captcha"):
            token, why = paid_solve(b, row["url"], kind, cfg)
            if token is None:
                after = ""
                try:
                    after = b.eval(cfg["BODY"]) or ""
                except Exception:
                    pass
                if re.search(cfg["OK_CONTACT"], after, re.I) and not re.search(cfg["FAIL_TEXT"], after, re.I):
                    return done("submitted", f"{kind}+paid|callback|ok-text")
                return done("unsure", f"{kind}: {why}")
            if not token and why.startswith("no reCAPTCHA widget to solve"):
                # Score-only reCAPTCHA (v3): nothing to press or buy; the page
                # mints its own token when the form submits. Send it by hand and
                # let the page's reply score the row (live 2026-10-25: 17 of 32
                # rows were refused here without a press).
                kind += "+v3"
            elif not token:
                return done("blocked", f"{kind}: {why} — did not submit")
            else:
                kind += "+paid"
                # The challenge popup a pressed checkbox opened can still sit over
                # the form after the bought token lands (live 2026-10-25: five rows
                # "submit ... covered"). Escape does not close it (chunk y: ten
                # rows still covered); a person clicks the page beside it, which
                # lands on reCAPTCHA's full-page backdrop and dismisses it.
                for _ in range(2):
                    r = b.eval(CHALLENGE_RECT)
                    if not r:
                        break
                    left, top, cw, ch, vw, vh, dpr = r
                    x = random.uniform(20, left - 20) if left > 80 else random.uniform(left + cw + 20, vw - 20)
                    y = random.uniform(vh * 0.3, vh * 0.7)
                    hands.move_screen(round(hands.dx + x * dpr), round(hands.dy + y * dpr))
                    time.sleep(random.uniform(0.1, 0.3))
                    w.xdo("click", "1")
                    time.sleep(random.uniform(0.6, 1.2))
                else:
                    w.xdo("key", "Escape")
        if not token and not kind.endswith("+v3"):
            served = b.eval("[...document.querySelectorAll(\"iframe[src*='bframe'],iframe[src*='hcaptcha.com'][src*='challenge']\")]"
                            ".some(f => { const r = f.getBoundingClientRect(); return r.top > -1000 && r.height > 100; })")
            return done("blocked", f"{kind}: " + ("challenge served — did not submit" if served
                                                  else "no token and nothing solved — did not submit"))
    if dry:
        return done("dry", f"{kind}: filled, not sent")
    before = b.eval(cfg["BODY"]) or ""
    url0 = b.eval("location.href")
    sub = json.loads(b.eval(cfg["SUBMIT_RECT"]) or "{}")
    if not sub.get("ok"):
        return done("blocked", f"{kind}: no submit control found")
    try:
        hands.click("[data-ub-f='submit']")
    except RuntimeError as e:
        return done("blocked", f"{kind}: submit control unreachable — {e}")
    # ⛔ From here the town may have the message. Anything that goes wrong is
    # `unsure`, never `error`: the lane sweeps `error` rows again, and a re-run
    # of a row that did send is a second message to a stranger. The marker on
    # stderr tells lane.py the same if this process dies past this point.
    print("PRESSED", file=sys.stderr, flush=True)
    try:
        time.sleep(5)
        try:
            after, url1 = b.eval(cfg["BODY"]) or "", b.eval("location.href")
        except Exception:
            time.sleep(3)
            after, url1 = b.eval(cfg["BODY"]) or "", b.eval("location.href")
    except Exception as e:
        return done("unsure", f"{kind}: submit pressed, page unreadable after — {e}")
    s = sub.get("label", "")
    bad = fail_rx.search(after)
    if bad and not fail_rx.search(before):              # only a NEW refusal counts
        return done("blocked", f"{kind}|{s}|rejected: {bad.group(0)!r}")
    if ok_rx.search(after) and not ok_rx.search(before):
        return done("submitted", f"{kind}|{s}|ok-text")
    if url1 != url0 or after != before:
        return done("submitted", f"{kind}|{s}|page-changed")
    return done("blocked", f"{kind}|{s}|no confirmation")
