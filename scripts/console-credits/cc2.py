#!/usr/bin/env python3
import json,os,re,subprocess,sys,time,importlib.util
SP=os.path.dirname(os.path.abspath(__file__))
spec=importlib.util.spec_from_file_location("ub",SP+"/ub.py"); ub=importlib.util.module_from_spec(spec); spec.loader.exec_module(ub)
# tab ids are per-launch: pass UB_TAB_A / UB_TAB_B, or edit after browser_launch_isolated_chrome
A=int(os.environ.get("UB_TAB_A","0")); B=int(os.environ.get("UB_TAB_B","0"))
if not A or not B: raise SystemExit("set UB_TAB_A and UB_TAB_B to the two attached tab ids")
class EvalFailed(Exception): pass
def ev(t,e,to=70):
    r=ub.ev(t,e,to).strip().strip('"')
    # ⛔⛔ A FAILED EVALUATE COMES BACK AS CONTENT TEXT, NOT AS AN ERROR. Measured
    #   2026-10-20: ev(B,...) returned "Failed to evaluate JavaScript: Cannot attach
    #   debugger to restricted URL: about:blank"; the caller took that 74-char string
    #   for the 6-digit code, TYPED IT INTO input[name=code] and submitted it. The page
    #   answered "There was an error verifying your code", so the run was blamed on the
    #   code flow and the real fault — a detached tab B — never surfaced.
    # ⭐ Any helper that cannot distinguish a value from its own failure will hand the
    #   failure onward as data. Make it raise.
    if r.startswith("Failed to evaluate") or "Cannot attach debugger" in r \
       or r.startswith("Error:") or r.startswith("MCP error"):
        raise EvalFailed(r[:200])
    return r
def nav(t,u): return ub.call("browser_navigate",{"tabTarget":t,"url":u},90)
def fg(t): ub.call("browser_switch_tab",{"tabTarget":t}); time.sleep(2)
def click(t,xy): ub.call("browser_realistic_click",{"tabTarget":t,"x":xy[0],"y":xy[1],"moveFirst":False})
def typ(t,s): ub.call("browser_realistic_type",{"tabTarget":t,"text":s})
def J(s):
    try: return json.loads(s.replace('\\"','"'))
    except Exception: return None

LAYOUT="(()=>{const e=document.querySelector('input[type=email]');const b=e?e.getBoundingClientRect():null;const c=[...document.querySelectorAll('button')].find(x=>/continue with email/i.test(x.innerText||''));const r=c?c.getBoundingClientRect():null;return JSON.stringify({e:b&&b.width?[Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]:null,c:r&&r.width?[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]:null})})()"
# ⭐ The page's own background attestation (invisible hCaptcha). Returns a token or says
#   why not. Minting is NOT the same as mounting: widgets can be present with no token.
MINT=("(async()=>{const ids=[...document.querySelectorAll('[data-hcaptcha-widget-id]')]"
  ".map(e=>e.getAttribute('data-hcaptcha-widget-id'));"
  "const lens=()=>[...document.querySelectorAll(\"textarea[name='h-captcha-response']\")]"
  ".map(t=>(t.value||'').length);"
  "if(!ids.length||!window.hcaptcha)return 'no-widget';"
  "if(lens().some(n=>n>0))return 'already '+JSON.stringify(lens());"
  "const t0=Date.now();"
  "try{await Promise.race([window.hcaptcha.execute(ids[0],{async:true}),"
  "new Promise((_,r)=>setTimeout(()=>r(new Error('race')),8000))])}catch(e){}"
  "const dl=Date.now()+6000;"
  "while(Date.now()<dl&&!lens().some(n=>n>0))await new Promise(r=>setTimeout(r,250));"
  "return (lens().some(n=>n>0)?'ok ':'NONE ')+(Date.now()-t0)+'ms '+JSON.stringify(lens())})()")

def lay(): return J(ev(A,LAYOUT))

# ⛔ REUSE_LINK=1 finishes an attempt whose link was ALREADY sent and whose tab A still
#   shows "To continue, click the link sent to ...". It must not re-navigate A: the code
#   has to be typed back into the very tab that asked for it.
REUSE=os.environ.get("REUSE_LINK")=="1"
EXT=os.environ.get("UB_EXT","")

def signout():
    # ⛔⛔ platform.claude.com/logout DOES NOT END THE SESSION. Measured 2026-10-20: after
    #   agents2 signed in, nav(/logout) then nav(/login) landed on /dashboard STILL SIGNED
    #   IN, so the layout probe found no email field and every later account in the batch
    #   died "login card not laid out". Only the FIRST account in a batch could ever work,
    #   and the WRONG ACCOUNT guard in _finish is the only thing that stops the first
    #   account's grant being reported under the other three names.
    # ⛔ SCOPE THE CLEAR WITH tabTarget. Without one the tool resolves to the DEFAULT
    #   profile and refuses — that would be the operator's real session (eBay, Amazon,
    #   banking). ⚠️ It cannot tell an isolated profile from his: storeId "0" just means
    #   "this browser's regular jar", which is safe here ONLY because we launched this
    #   browser ourselves. Never reach for includeDefaultProfile to get past the refusal.
    if not EXT: return "no-UB_EXT — cannot sign out, batch one account per browser"
    return ub.call("browser_clear_cookies",{"tabTarget":A,"extensionId":EXT})

def one(email):
    o={"account":email}
    if REUSE:
        o["reused_link"]=True
        t0=int(time.time())-1800
        return _finish(email,o,t0)
    o["signout"]=str(signout())[:60]
    time.sleep(2)
    nav(A,"https://platform.claude.com/login"); time.sleep(4); fg(A)
    R=lay()
    if not R or not R.get("e"): o["error"]="login card not laid out"; return o
    t0=int(time.time())-5
    click(A,R["e"]); typ(A,email)
    # ⛔ CHECK THE RESULT OF THE TYPE — it can fail silently and did go unchecked
    #   until 2026-10-24. browser_realistic_type has NO selector and types into the
    #   FOCUSED element, so if the coordinate click on the email box misses, the
    #   address lands nowhere, "Continue with email" stays disabled, and the click
    #   below is a no-op that reports as "no link-sent" — byte-identical to a
    #   throttle or a refused attestation. Three runs were scored "mint refused" on
    #   output that could not distinguish the two.
    # ⇒ val=="<the email>" and dis==false  ⇒ the submit really was refused.
    #   val==""/null                        ⇒ OUR click missed; the mint is a red herring.
    # ⚠️ NON-FATAL ON PURPOSE. ev() raises on an eval failure, and a diagnostic that
    #   aborts the attempt it exists to diagnose is worse than no diagnostic.
    try:
        o["typed"]=ev(A,"(()=>{const e=document.querySelector('input[type=email]');"
                         "const c=[...document.querySelectorAll('button')]"
                         ".find(x=>/continue with email/i.test(x.innerText||''));"
                         "return JSON.stringify({val:e?e.value:null,dis:c?!!c.disabled:null})})()")
    except Exception as _e:
        o["typed"]="probe failed: "+str(_e)[:80]
    # ⛔⛔ THE SUBMIT NEEDS AN ATTESTATION TOKEN AT CLICK TIME, AND THIS SCRIPT USED TO
    #   CLICK WITHOUT ONE. Measured 2026-10-20 on the chromium-host sidecar: all three
    #   accounts returned "no link-sent" and the page read "Couldn't verify your browser.
    #   Try again." — no mail was sent, so it looked exactly like the throttle this
    #   script warns about and was not. The sidecar mints in ~2325ms where office's
    #   ext_bb94966c mints in ~506ms, so the click simply outran the mint.
    # ⚠️ "Try again." on the Console login page is PLAIN TEXT in #email-error, not a
    #   control — there is nothing to press, unlike claude.ai's redeem page. Re-submitting
    #   with a fresh token is the only way forward.
    # ⛔ TWO ATTEMPTS, NOT MORE: a submit that DOES land sends a real magic link, and
    #   hammering one address is what deferred this job in the first place.
    bt=""; sent=False; o["mint"]=[]
    for _att in range(2):
        o["mint"].append(ev(A,MINT))
        L=lay() or R
        if not L.get("c"): break
        click(A,L["c"]); time.sleep(6)
        bt=ev(A,"document.body.innerText.replace(/\\s+/g,' ')").lower()
        if "link sent to" in bt: sent=True; break
        if "verify your browser" not in bt: break   # a different failure — do not re-click
    if not sent:
        # ⛔ NAME THE CAUSE. This used to return a bare "no link-sent", which reads as
        #   "throttled" and sent me after the wrong fault.
        o["error"]="no link-sent"; o["page"]=bt[:220]; return o
    return _finish(email,o,t0)

def _finish(email,o,t0):
    url=None
    for _ in range(22):
        p=subprocess.run(["python3","-I",SP+"/magiclink.py",email,"console",str(t0)],capture_output=True,text=True)
        if p.returncode==0 and p.stdout.strip(): url=p.stdout.strip(); break
        time.sleep(8)
    if not url: o["error"]="no magic link"; return o
    # ⛔ A magic link is /magic-link#<token>. Going from #OLD to #NEW is a SAME-DOCUMENT
    # navigation: no reload, so the page keeps rendering the PREVIOUS code. Measured --
    # three accounts all submitted pushbuild's code 369101 and failed verification.
    # Neutral URL first forces a real document load.
    # ⛔ NOT about:blank — it is a RESTRICTED URL, so navigating there detaches the
    #   debugger and every later call on B fails ("Cannot attach debugger to restricted
    #   URL"), leaving B parked and the magic link never loaded. Yesterday's fix for the
    #   same-document-navigation trap introduced exactly this. A real same-origin page
    #   forces the cross-document load without losing the attachment.
    nav(B,"https://platform.claude.com/login"); time.sleep(2)
    nav(B,url); time.sleep(6); fg(B); time.sleep(3)
    where=ev(B,"location.pathname")
    if "magic-link" not in where: o["error"]="tab B never reached the link (at "+where[:60]+")"; return o
    code=ev(B,"(()=>{const m=document.body.innerText.match(/\\b\\d{6}\\b/);return m?m[0]:'NOCODE'})()")
    if not re.fullmatch(r"\d{6}",code): o["error"]="no 6-digit code on the link page"; o["saw"]=code[:60]; return o
    o["code_flow"]= code!="NOCODE"
    fg(A); time.sleep(3)
    if code=="NOCODE":
        # maybe it signed in directly in B
        o["error"]="no code on link page"; return o
    C=None
    for _ in range(6):
        C=J(ev(A,"(()=>{const i=document.querySelector('input[name=code],input#code');const b=i?i.getBoundingClientRect():null;"
          "const v=[...document.querySelectorAll('button')].find(x=>/verify email/i.test(x.innerText||''));const r=v?v.getBoundingClientRect():null;"
          "return JSON.stringify({i:b&&b.width?[Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]:null,"
          "v:r&&r.width?[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]:null})})()"))
        if C and C.get("i"): break
        time.sleep(4)
    if not C or not C.get("i"): o["error"]="code input never rendered"; return o
    click(A,C["i"])
    # ⛔ The field may ALREADY hold text from a previous attempt, and realistic_type
    #   APPENDS rather than replacing. Select the existing content natively (no synthetic
    #   event needed for .select()) and let the real keystrokes overwrite it.
    try: ev(A,"(()=>{const i=document.querySelector('input[name=code],input#code');if(i){i.focus();i.select()}return 'sel'})()")
    except EvalFailed: pass
    typ(A,code)
    if C.get("v"): click(A,C["v"])
    r=""
    for _ in range(16):
        r=ev(A,"(async()=>{const s=await fetch('/api/organizations').then(r=>r.status).catch(()=>0);let w='-';"
            "try{const a=await fetch('/api/account').then(r=>r.ok?r.json():null);w=a?(a.email_address||a.email||'?'):'null'}catch(e){}"
            "return s+'|'+w})()")
        if r.startswith("200|"): break
        time.sleep(4)
    if not r.startswith("200|"): o["error"]="sign-in never completed ("+r+")"; return o
    who=r.split("|",1)[1]; o["signed_in_as"]=who
    if who.lower()!=email.lower(): o["error"]="WRONG ACCOUNT "+who+" -- refused to read"; return o
    o["orgs"]=ev(A,"(async()=>{const d=await fetch('/api/organizations').then(r=>r.json());const a=d.data||d;"
       "return a.map(x=>x.name+'~'+String(x.uuid||'').slice(0,8)).join(' ; ')})()")[:160]
    nav(A,"https://platform.claude.com/settings/billing"); time.sleep(6)
    # ⛔⛔ THE GRANT TABLE RENDERS "Loading" PLACEHOLDERS FIRST. Measured 2026-10-20: a flat
    #   sleep(8) returned ["Loading Loading Loading", ...] with an empty money list — a read
    #   that looked like a finished answer and contained nothing. Poll until they are gone.
    # ⭐ Return the RAW block between "Remaining balance" and "Payment details" rather than
    #   parsing it here: one grant per line, and a regex that silently matches nothing is
    #   indistinguishable from an account with no grant.
    grants="PENDING"
    for _ in range(12):
        grants=ev(A,"(()=>{const t=(document.body.innerText||'').replace(/\\s+/g,' ');"
          "if(/Loading/.test(t))return 'PENDING';"
          "const i=t.search(/Remaining balance/i);"
          "if(i<0)return /Promotional credits/i.test(t)?'NO-GRANT-TABLE':'PENDING';"
          "const j=t.search(/Payment details/i);"
          "return t.slice(i,j>i?j:i+700)})()")
        if grants!="PENDING": break
        time.sleep(4)
    o["grants"]=grants[:700]
    o["money"]=ev(A,"(()=>[...new Set([...document.body.innerText.matchAll(/\\$[0-9][0-9,]*(?:\\.[0-9]{2})?/g)].map(m=>m[0]))].slice(0,6).join(' '))()")[:120]
    return o

for em in sys.argv[1:]:
    try: _r=one(em)
    except EvalFailed as x: _r={"account":em,"error":"evaluate failed: "+str(x)}
    print(json.dumps(_r)[:1400]); sys.stdout.flush()
