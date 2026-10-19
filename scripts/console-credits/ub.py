#!/usr/bin/env python3
"""ub.py -- drive unibrowse via POST /mcp from the shell. Keeps secrets out of LLM context."""
import json,urllib.request,sys
EP="http://192.168.1.168:9010/mcp"
def call(tool,args,timeout=120):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
                     "params":{"name":tool,"arguments":args}}).encode()
    req=urllib.request.Request(EP,data=body,headers={"Content-Type":"application/json",
        "Accept":"application/json, text/event-stream"})
    raw=urllib.request.urlopen(req,timeout=timeout).read().decode()
    # unwrap: SSE frames or plain json-rpc
    for line in raw.splitlines():
        if line.startswith("data: "): raw=line[6:]; break
    try:
        d=json.loads(raw)
        c=d.get("result",{}).get("content",[])
        return c[0].get("text","") if c else json.dumps(d)[:300]
    except Exception:
        return raw[:300]
def ev(tab,expr,timeout=120):
    return call("browser_evaluate",{"tabTarget":tab,"expression":expr},timeout)
if __name__=="__main__":
    print(call(sys.argv[1],json.loads(sys.argv[2])))
