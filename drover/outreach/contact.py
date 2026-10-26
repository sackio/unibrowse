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
    elif kind == "hcaptcha":
        task = "hcaptcha"
    elif b.eval("!!document.querySelector(\"iframe[src*='recaptcha/api2/anchor'][src*='size=invisible'],[data-size=invisible]\")"):
        task = "recaptcha-invisible"
    elif b.eval("!!document.querySelector(\"iframe[src*='recaptcha'][src*='anchor']\")"):
        task = "recaptcha-v2"
    else:
        return False, "no reCAPTCHA widget to solve (v3/score) — not bought"
    field = {"turnstile": "cf-turnstile-response", "hcaptcha": "h-captcha-response"}.get(task, "g-recaptcha-response")
    # ⛔ Check the field exists BEFORE buying (the lane paid for turnstile tokens
    # with nowhere to write them, 2026-10-23).
    if not json.loads(b.eval(cfg["FIELD_PRESENT"].replace("__FIELD__", field)) or "{}").get("n"):
        return False, f"no {field} field in the page — not bought"
    req = urllib.request.Request(os.environ["DROVER_SOLVER_URL"], data=json.dumps(
        {"url": url, "kind": task, "sitekey": k["key"], "action": k.get("action"), "enterprise": k.get("enterprise"),
         "proxy": os.environ.get("DROVER_PROXY") if os.environ.get("DROVER_PROXY", "").startswith("socks5") else None}).encode(),
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
    if any("no answer" in x for x in seen):
        # The write hung, so it may have run: a callback that submits and then
        # alerts or navigates never answers (retry 2026-10-25: 15 of 32 rows).
        # Unsure, never blocked, so nothing re-runs it into a second message.
        return None, f"token bought (${r.get('cost')}), write hung [{' '.join(seen)}] — may have submitted"
    return False, f"token bought (${r.get('cost')}) but it did not land in the page [{' '.join(seen)}]"


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

# Marks the button that dismisses a visible cookie/consent layer (data-ub-cc)
# and returns true, or false when no such layer is up. A layer is a fixed or
# sticky box whose text talks about cookies or consent. Refusing beats accepting.
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


# Hide whatever newsletter-signup popup is covering an already-found field, so
# the fill can reach it. A popup (Klaviyo, Shopify forms-embed, Poptin, LTK,
# Justuno ...) fires a few seconds AFTER DISCOVER_SIGNUP, so the field is found
# uncovered and then covered when reach() goes to fill it -- ~14% of signup
# blocks, measured 2026-10-26 (memo eaf5c323). Given the target selector, this
# peels off up to 6 stacked overlays: each pass asks elementFromPoint what sits
# on the field's centre, climbs to that coverer's outermost positioned ancestor
# that does NOT contain the target (the popup/backdrop root), and hides it. A
# shadow-DOM popup (Shopify forms-embed, Klaviyo) surfaces here as its own host
# element, so hiding that host removes the whole popup without piercing the
# shadow root -- which a light-DOM close-button search could never do. Finally
# it releases any scroll lock the popup set on the page. Returns a comma list of
# what it hid (for the log), or "" if the field's centre was already clear.
DISMISS_OVERLAY = r"""((sel) => {
  const t = document.querySelector(sel);
  if (!t) return "";
  const positioned = x => { const p = getComputedStyle(x).position;
    return p === 'fixed' || p === 'absolute' || p === 'sticky'; };
  const desc = el => { const c = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + c).slice(0, 80); };
  const hidden = [];
  for (let i = 0; i < 6; i++) {
    const r = t.getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!e || e === t || t.contains(e) || e.contains(t) || e.control === t) break;
    let root = e;
    for (let p = e; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (p.contains(t)) break;                 // never hide an ancestor of the target
      if (positioned(p)) root = p;
    }
    if (root === document.body || root === document.documentElement || root.contains(t)) break;
    root.style.setProperty('display', 'none', 'important');
    hidden.push(desc(root));
  }
  for (const el of [document.documentElement, document.body]) {
    el.style.overflow = ''; el.style.position = '';
    el.classList.remove('no-scroll', 'modal-open', 'overflow-hidden', 'ReactModal__Body--open'); }
  return hidden.join(', ');
})"""


NEAR_TARGET = r"""((sel, x, y) => {
  const t = document.querySelector(sel), e = document.elementFromPoint(x, y);
  if (!t || !e) return false;
  return e === t || t.contains(e) || e.contains(t) || e.control === t
      || (e.parentElement && e.parentElement === t.parentElement);
})"""


# Signup mode (cfg MODE=signup): a site's own newsletter form, never a contact,
# login, account, search or checkout form (Ben, #business-outreach 2026-10-25
# 19:08; business-3's brief: no contact forms, no accounts, nothing but an
# email typed). Picks the email input whose form looks like a list signup, marks
# it, any name fields and consent boxes beside it, and the submit control INSIDE
# that form: a page-wide "Sign up" button is usually an account signup.
DISCOVER_SIGNUP = r"""(() => {
  const vis = e => { const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.disabled; };
  const mark = (e, k) => { e.setAttribute('data-ub-f', k); return e; };
  document.querySelectorAll('[data-ub-f]').forEach(e => e.removeAttribute('data-ub-f'));
  const NEWS = /subscribe|newsletter|list-manage|klaviyo|ctct|convertkit|mailerlite|sendinblue|brevo|mailchimp|omnisend|sign ?up|join|updates|email list|mailing list|stay in (touch|the loop)|inbox/i;
  const BAD = /log ?in|sign ?in|password|register|create (an )?account|checkout|search|comment|contact us|get a quote|request a quote|message/i;
  const SUB = "button[type=submit],input[type=submit],input[type=image],button:not([type]),button[type=button],[role=button],a[class*=button i],a[class*=btn i]";
  const scopeOf = em => em.closest('form') || em.closest('*:has(button),*:has(input[type=submit]),*:has([role=button])') || null;
  const cands = [];
  for (const em of document.querySelectorAll("input[type=email],input[name*=mail i],input[id*=mail i],input[placeholder*=mail i]")) {
    if (!vis(em) || /search/i.test(em.type + em.name + em.id)) continue;
    const sc = scopeOf(em);
    if (!sc || sc === document.body || sc === document.documentElement) continue;
    if (sc.querySelector('textarea, input[type=password], input[type=search], select[name*=country i][required]')) continue;
    const others = [...sc.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image])")]
      .filter(e => vis(e) && e !== em && !/first|last|name/i.test(e.name + e.id + (e.placeholder || '')));
    if (others.some(e => e.required || e.type === 'tel')) continue;      // asks for more than an email and a name
    const blob = (sc.getAttribute('action') || '') + ' ' + (sc.className || '') + ' ' + (sc.id || '') + ' ' + (sc.innerText || '').slice(0, 600);
    if (BAD.test(blob) && !NEWS.test(blob)) continue;
    const btn = [...sc.querySelectorAll(SUB)].filter(vis)
      .sort((a, b) => /subscribe|sign ?up|join|submit|go|send|→|›|»/i.test(b.innerText || b.value || b.getAttribute('aria-label') || '') -
                      /subscribe|sign ?up|join|submit|go|send|→|›|»/i.test(a.innerText || a.value || a.getAttribute('aria-label') || ''))[0];
    if (!btn) continue;
    // A newsletter popup is the best target there is, and while it is up it
    // locks the page's scroll and covers the footer form (live chunk 1,
    // 2026-10-25: 32 rows "could not scroll", 14 "pointer would not land").
    const r = em.getBoundingClientRect();
    let pop = false;
    for (let p = em; p && p !== document.body; p = p.parentElement)
      if (getComputedStyle(p).position === 'fixed') { pop = r.top >= 0 && r.bottom <= innerHeight; break; }
    cands.push({em, sc, btn, news: NEWS.test(blob), extra: others.length, pop});
  }
  const pick = cands.find(c => c.pop && (c.news || c.extra === 0)) || cands.find(c => c.news) || cands.find(c => c.extra === 0);
  if (!pick) return JSON.stringify({ok: false, why: cands.length ? 'only non-newsletter email forms' : 'no-signup-form'});
  const {em, sc, btn} = pick;
  mark(em, 'email'); mark(btn, 'submit');
  const used = new Set([em]);
  const put = (sel, k) => { for (const e of sc.querySelectorAll(sel))
      if (vis(e) && !used.has(e)) { used.add(e); return mark(e, k) } return null };
  const fst = put("input[name*=first i],input[id*=first i],input[name=FNAME],input[placeholder*=first i]", 'first');
  const lst = put("input[name*=last i],input[id*=last i],input[name=LNAME],input[placeholder*=last i]", 'last');
  const nm = (!fst && !lst) ? put("input[type=text][name*=name i]:not([name*=user i]):not([name*=company i]),input[type=text][placeholder*=name i]", 'full') : null;
  const boxes = [];
  for (const b of sc.querySelectorAll("input[type=checkbox]"))
    if (vis(b) && !b.checked && !/sms|text|phone/i.test((b.name || '') + (b.id || ''))) { mark(b, 'box' + boxes.length); boxes.push(1); }
  return JSON.stringify({ok: true, fields: {email: true, first: !!fst, last: !!lst, full: !!nm}, boxes,
    label: (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim().slice(0, 30)});
})()"""


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


# The site's own Contact page, from a link on the landing page: a same-site
# href whose path or text says contact, preferring the shortest path.
CONTACT_LINK = r"""(() => {
  const here = location.hostname.replace(/^www\./, '');
  const c = [...document.querySelectorAll('a[href]')].filter(a => {
    try { const u = new URL(a.href); return u.hostname.replace(/^www\./, '') === here &&
      /contact|get-in-touch/i.test(u.pathname + ' ' + a.textContent) && !/career|job/i.test(u.pathname); }
    catch (e) { return false; } }).map(a => a.href.split('#')[0]);
  c.sort((x, y) => x.length - y.length);
  return c[0] && c[0] !== location.href.split('#')[0] ? c[0] : null;
})()"""


# ⛔ The v1 source's SUBMIT_RECT (cfg["SUBMIT_RECT"]) searches the WHOLE document
# for a send/submit/contact button, with a bare `cands[0]` fallback. On a town
# page that grabs a header "Contact" nav button or a "Submit Search" box -- a
# wrong-button click that reads as a FALSE "submitted" (delta.utah.gov clicked
# Submit Search) or an off-form "unreachable" (camden.delaware.gov aimed at a
# top-right header button). Measured 2026-10-26. Scope to the FORM that holds the
# marked email field; fall back to a text-matched document search (never a bare
# first button) only when the fields are not wrapped in a <form>. Drover-local
# override; the v1 engine has the same bug -- told `business` to adopt it.
SUBMIT_CONTACT = r"""(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const SUB = "button[type=submit],input[type=submit],input[type=image],button:not([type]),button[type=button],[role=button],a[class*=button i],a[class*=btn i]";
  const re = /send|submit|sign ?up|subscribe|join|contact/i;
  const em = document.querySelector("[data-ub-f='email']");
  const form = em && em.closest('form');
  let pick = null;
  if (form) {
    const inForm = [...form.querySelectorAll(SUB)].filter(vis);
    pick = inForm.find(e => re.test((e.innerText || e.value || '') + ' ' + (e.name || '') + ' ' + (e.id || ''))) || inForm[0];
  }
  if (!pick) {   // no <form> wrapper (or an empty one): text-matched doc search, never a bare first button
    pick = [...document.querySelectorAll(SUB)].filter(vis)
      .find(e => re.test((e.innerText || e.value || '') + ' ' + (e.name || '') + ' ' + (e.id || '')));
  }
  if (!pick) return JSON.stringify({ok: false});
  pick.setAttribute('data-ub-f', 'submit');
  const r = pick.getBoundingClientRect();
  return JSON.stringify({ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
    w: Math.round(r.width), label: (pick.innerText || pick.value || '').trim().slice(0, 30)});
})()"""


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
    signup = cfg.get("MODE") == "signup"
    ok_rx, fail_rx = re.compile(cfg["OK"] if signup else cfg["OK_CONTACT"], re.I), re.compile(cfg["FAIL_TEXT"], re.I)

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
            found = json.loads(b.eval(DISCOVER_SIGNUP if signup else cfg["DISCOVER_CONTACT"]) or "{}")
        except Exception as e:
            found = {"ok": False, "why": f"discover failed: {e}"}
        if found.get("ok"):
            break
        time.sleep(2)
    if not found.get("ok") and not signup:
        # Rows often carry only a homepage: follow the site's own Contact link
        # once and look again (r8 2026-10-26: 5/7 homepages ended `noform`).
        try:
            href = b.eval(CONTACT_LINK)
        except Exception:
            href = None
        if href:
            try:
                b.navigate(href, settle=2.0)
                for _ in range(10):
                    try:
                        found = json.loads(b.eval(cfg["DISCOVER_CONTACT"]) or "{}")
                    except Exception as e:
                        found = {"ok": False, "why": f"discover failed: {e}"}
                    if found.get("ok"):
                        break
                    time.sleep(2)
            except Exception as e:
                found = {"ok": False, "why": f"contact link {href}: {e}"}
    if not found.get("ok"):
        return done("noform", found.get("why", "no form"))
    town = row.get("town") or row["address"].split("@")[0]
    # A row may carry its own subject and message (per-recipient text, e.g. the
    # ca-up lane); "\n" in the TSV cell is a newline.
    values = {"email": row["address"], "first": row["first"], "last": row["last"],
              "full": (row["first"] + " " + row["last"]).strip(),
              "subject": (row.get("subject") or cfg["SUBJECT"]).replace("\\n", "\n"),
              "message": (row.get("message") or cfg["MSG_TMPL"].replace("{address}", row["address"])
                          .replace("{town}", town)).replace("\\n", "\n")}
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
        for k in ("first", "last", "full", "email") if signup else ("first", "last", "full", "email", "subject", "message"):
            if k != "email" and k != "message" and not found["fields"].get(k):
                continue
            sel = f"[data-ub-f='{k}']"
            try:
                click_field(b, hands, w, sel)
            except RuntimeError as e:
                # A newsletter popup landed on the footer form after discovery;
                # hide it and try once more (memo eaf5c323). Only for a
                # reach/landing failure -- anything else is a real error.
                if "covered by" not in str(e) and "pointer would not land" not in str(e):
                    raise
                hid = b.eval(DISMISS_OVERLAY + f"({json.dumps(sel)})")
                if not hid:
                    raise
                time.sleep(random.uniform(0.4, 0.9))
                click_field(b, hands, w, sel)
            # Type, then verify by reading the field back. xdotool returns when it
            # has SENT keystrokes, not when the page processed them, and a late
            # re-render (React/Wix/Gravity Forms) can drop the tail or take focus
            # away entirely (measured: "Our " for "Our Store", "" for a full name).
            # So CONVERGE instead of erroring on the first miss: when the field is
            # a prefix of the target, type only the missing suffix (covers the
            # empty case too); otherwise clear and retype. Re-focus each round,
            # because a dropped tail usually means focus was lost mid-type.
            got = ""
            hands.type(values[k])
            for _ in range(4):
                for _ in range(10):                 # let in-flight keystrokes land
                    got = b.eval(f"(e => e && e.value)(document.querySelector({json.dumps(sel)}))") or ""
                    if got == values[k]:
                        break
                    time.sleep(0.15)
                if got == values[k]:
                    break
                if not b.eval(f"(t => !!t && (document.activeElement === t || t.contains(document.activeElement)))"
                              f"(document.querySelector({json.dumps(sel)}))"):
                    click_field(b, hands, w, sel)   # focus was lost; take it back
                if values[k].startswith(got):
                    hands.type(values[k][len(got):])            # finish the tail (empty got => whole value)
                else:
                    w.xdo("key", "ctrl+a"); w.xdo("key", "Delete")   # wrong/extra chars: clear, retype
                    hands.type(values[k])
            if got != values[k]:
                g, v = str(got), values[k]
                at = next((i for i in range(min(len(g), len(v))) if g[i] != v[i]), min(len(g), len(v)))
                return done("error", f"field {k} reads back {len(g)}/{len(v)} chars after 4 tries, differs at {at}: "
                                     f"got {g[max(0, at - 20):at + 20]!r} want {v[max(0, at - 20):at + 20]!r}")
            time.sleep(random.uniform(0.3, 1.0))
        for i in range(len(found.get("boxes") or [])):
            hands.click(f"[data-ub-f='box{i}']")
            time.sleep(random.uniform(0.2, 0.6))
    except RuntimeError as e:
        return done("blocked", f"form field unreachable — {e}")
    kind = "none"
    url_form = b.eval("location.href")  # baseline: a nav away from here after a
    # bought token means the form submitted. paid_solve's write can hang BECAUSE
    # the widget callback submitted and then navigated, which was logged `unsure`
    # and deflated the pass rate (Ben, #unibrowse 2026-10-26).
    if b.eval(CAPTCHA_PRESENT):
        kind = "captcha"
        for name, sel, fx, fy, field in WIDGETS:
            if not b.eval(f"!!document.querySelector({json.dumps(sel)})"):
                continue
            kind = name
            try:
                left, top, bw, bh, dpr = hands.reach(sel)
            except RuntimeError:
                # The checkbox could not be brought into view even with reach()'s
                # scripted fallback: on an INVISIBLE reCAPTCHA the anchor iframe
                # is present but has no clickable box (trentontn.net, live
                # 2026-10-25). Don't give up -- break to the paid_solve path,
                # which detects invisible/v2 and buys the right token (and
                # refuses a v3/no-widget cleanly). Strictly better than ending
                # the row here: a reachable box was already reached above.
                break
            hands.move_screen(round(hands.dx + (left + bw * fx) * dpr), round(hands.dy + (top + bh * fy) * dpr), width=24 * dpr)
            pre, dwell = w.hm.press_timing(w.CFG)
            w.xdo("sleep", f"{pre:.3f}", "mousedown", "1", "sleep", f"{dwell:.3f}", "mouseup", "1")
            for _ in range(8):
                time.sleep(1)
                if b.eval(TOKEN + f"({json.dumps(field)})"):
                    break
            break
        token = any(b.eval(TOKEN + f"({json.dumps(f)})") for *_, f in WIDGETS)
        if signup and not token and kind == "captcha":
            # Score-only reCAPTCHA (v3): no widget, nothing to press or buy;
            # the page mints its own token on submit. Signups never buy one.
            kind += "+v3"
        if not token and not dry and os.environ.get("DROVER_SOLVER_URL") and kind in (("recaptcha", "hcaptcha") if signup else ("recaptcha", "hcaptcha", "turnstile", "captcha")):   # +hcaptcha on signups (Ben, ask a5d 2026-10-26; was reCAPTCHA-only a3s)
            token, why = paid_solve(b, row["url"], kind, cfg)
            if token is None:
                after, navd = "", False
                try:
                    after = b.eval(cfg["BODY"]) or ""
                    navd = bool(url_form) and (b.eval("location.href") or url_form) != url_form
                except Exception:
                    pass
                failed = bool(re.search(cfg["FAIL_TEXT"], after, re.I))
                if not failed and re.search(cfg["OK_CONTACT"], after, re.I):
                    return done("submitted", f"{kind}+paid|callback|ok-text")
                # A bought token whose write hung AND the page then left the form
                # submitted it -- the callback sent and navigated, which is WHY the
                # write never answered. Count it instead of burying it as `unsure`;
                # that miscount was deflating the pass rate (Ben, #unibrowse 10-26).
                if navd and not failed:
                    return done("submitted", f"{kind}+paid|callback|navigated")
                return done("unsure", f"{kind}: {why}")
            if not token and (why.startswith("no reCAPTCHA widget to solve")
                              or why == "no sitekey on the page"):
                # Score-only reCAPTCHA (v3): nothing to press or buy; the page
                # mints its own token when the form submits. Send it by hand and
                # let the page's reply score the row (live 2026-10-25: 17 of 32
                # rows were refused here without a press). "no sitekey on the
                # page" is the SAME case: v3's api.js sets CAPTCHA_PRESENT but
                # renders no widget and leaves data-sitekey empty, so there is
                # nothing to solve -- blocking here was calling a captcha
                # "present" when none was there to clear (Ben, #unibrowse
                # 2026-10-26; measured on atkinsar.gov, alton.nh.gov).
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
    # Signup discovery already marked the button inside the signup form itself.
    sub = {"ok": True, "label": found.get("label", "")} if signup else json.loads(b.eval(SUBMIT_CONTACT) or "{}")
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
    # cfg["BODY"] is document.body.innerText, which carries NO input VALUES, so a
    # form that submits over AJAX and then clears or replaces its fields leaves
    # after == before even though it sent -- the "no confirmation" bucket that
    # deflated the pass rate (85 rows, Ben #unibrowse 2026-10-26). Ask the form
    # itself, the signal the v1 engine's own notes name (f=0 ⇒ gone ⇒ submitted):
    # the field we filled is gone, or no longer holds what we typed ⇒ it sent.
    # Still holding our text ⇒ the press did nothing, genuinely blocked. This only
    # reclassifies a terminal row (no "|"-less note ⇒ never swept, never re-sent),
    # so a wrong call cannot cost a second message to a town.
    try:
        st = b.eval("(s => { const e = document.querySelector(s);"
                    " return e ? ('v:' + (e.value || '')) : 'gone'; })("
                    + json.dumps("[data-ub-f='email']") + ")") or ""
    except Exception:
        st = "v:" + values["email"]
    if st == "gone":
        return done("submitted", f"{kind}|{s}|form-gone")
    if not st.startswith("v:" + values["email"]):
        return done("submitted", f"{kind}|{s}|fields-cleared")
    return done("blocked", f"{kind}|{s}|no confirmation")
