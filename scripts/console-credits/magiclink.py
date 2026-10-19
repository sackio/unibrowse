#!/usr/bin/env python3
"""magiclink.py <email> <ai|console> <min_epoch> -- prints ONLY the URL."""
import json,re,subprocess,sys,email.utils
GM="/home/ben/scripts/gmail"  # host-local on office
email_addr,kind=sys.argv[1],sys.argv[2]
min_epoch=float(sys.argv[3]) if len(sys.argv)>3 else 0
pat=re.compile(r'https://platform\.claude\.com/magic-link#[^\s"\'<>)]+' if kind=="console"
               else r'https://claude\.ai/magic-link#[^\s"\'<>)]+')
q=f'(to:{email_addr} OR deliveredto:{email_addr}) subject:(secure link)'
out=subprocess.run([GM,"search",q,"-n","10"],capture_output=True,text=True).stdout
try: msgs=json.loads(out)
except Exception: print("ERR: search did not return JSON",file=sys.stderr); sys.exit(1)
cands=[]
SUBJ_WANT = "Claude Console" if kind=="console" else "to Claude is here"
for m in msgs:
    subj=m.get("subject","") or ""
    frm=m.get("from","") or ""
    # sack.io is a CATCH-ALL into ben's mailbox, so a query on deliveredto: matches
    # OTHER accounts' links. Three exclusions, each measured as a real false match:
    if "anthropic.com" not in frm: continue             # atc-notifier forwards from ben@sack.io
    if SUBJ_WANT not in subj: continue                  # console vs claude.ai product
    try: ts=email.utils.parsedate_to_datetime(m.get("date","")).timestamp()
    except Exception: ts=0
    if ts>=min_epoch: cands.append((ts,m["id"],m.get("subject","")))
cands.sort(reverse=True)
if not cands:
    print(f"ERR: no message for {email_addr} newer than {min_epoch} (searched {len(msgs)})",file=sys.stderr); sys.exit(1)
for ts,mid,subj in cands:
    body=subprocess.run([GM,"read",mid,"--format","html"],capture_output=True,text=True).stdout
    u=pat.search(body)
    if u: print(u.group(0)); sys.exit(0)
print(f"ERR: {len(cands)} fresh msg(s), none containing a {kind} link",file=sys.stderr); sys.exit(1)
