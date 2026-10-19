#!/usr/bin/env python3
import json,re,subprocess,sys,time,importlib.util
SP=os.path.dirname(os.path.abspath(__file__))
spec=importlib.util.spec_from_file_location("ub",SP+"/ub.py"); ub=importlib.util.module_from_spec(spec); spec.loader.exec_module(ub)
import os
# tab ids are per-launch: pass UB_TAB_A / UB_TAB_B, or edit after browser_launch_isolated_chrome
A=int(os.environ.get("UB_TAB_A","0")); B=int(os.environ.get("UB_TAB_B","0"))
if not A or not B: raise SystemExit("set UB_TAB_A and UB_TAB_B to the two attached tab ids")
def ev(t,e,to=70): return ub.ev(t,e,to).strip().strip('"')
def nav(t,u): return ub.call("browser_navigate",{"tabTarget":t,"url":u},90)
def fg(t): ub.call("browser_switch_tab",{"tabTarget":t}); time.sleep(2)
def click(t,xy): ub.call("browser_realistic_click",{"tabTarget":t,"x":xy[0],"y":xy[1],"moveFirst":False})
def typ(t,s): ub.call("browser_realistic_type",{"tabTarget":t,"text":s})
def J(s):
    try: return json.loads(s.replace('\\"','"'))
    except Exception: return None

def one(email):
    o={"account":email}
    nav(A,"https://platform.claude.com/logout"); time.sleep(4)
    nav(A,"https://platform.claude.com/login"); time.sleep(4); fg(A)
    R=J(ev(A,"(()=>{const e=document.querySelector('input[type=email]');const b=e?e.getBoundingClientRect():null;"
      "const c=[...document.querySelectorAll('button')].find(x=>/continue with email/i.test(x.innerText||''));"
      "const r=c?c.getBoundingClientRect():null;return JSON.stringify({e:b&&b.width?[Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]:null,"
      "c:r&&r.width?[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]:null})})()"))
    if not R or not R.get("e"): o["error"]="login card not laid out"; return o
    t0=int(time.time())-5
    click(A,R["e"]); typ(A,email); click(A,R["c"]); time.sleep(5)
    if "true" not in ev(A,"/link sent to/i.test(document.body.innerText)+''"): o["error"]="no link-sent"; return o
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
    nav(B,"about:blank"); time.sleep(2)
    nav(B,url); time.sleep(6); fg(B); time.sleep(3)
    code=ev(B,"(()=>{const m=document.body.innerText.match(/\\b\\d{6}\\b/);return m?m[0]:'NOCODE'})()")
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
    click(A,C["i"]); typ(A,code)
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
    nav(A,"https://platform.claude.com/settings/billing"); time.sleep(8)
    o["rows"]=ev(A,"(()=>{const r=[...document.querySelectorAll('tr,[role=row]')].map(x=>x.innerText.replace(/\\s+/g,' ').trim())"
       ".filter(t=>t.length>4);return JSON.stringify(r.slice(0,6))})()")[:600]
    o["money"]=ev(A,"(()=>[...new Set([...document.body.innerText.matchAll(/\\$[0-9][0-9,]*(?:\\.[0-9]{2})?/g)].map(m=>m[0]))].slice(0,6).join(' '))()")[:120]
    return o

for em in sys.argv[1:]:
    print(json.dumps(one(em))[:900]); sys.stdout.flush()
