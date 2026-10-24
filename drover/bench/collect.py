#!/usr/bin/env python3
"""Serve the bench probe and collect what it reports.

  collect.py [--port 8765] [--dir results/]

GET  /probe.html  the probe (any driver, v1 or Drover, points a browser here)
POST /result      appends one probe result to <dir>/probe.jsonl, stamped with
                  the client address and time

Stdlib only. The probe POSTs to its own origin, so the browser under test must
reach this host directly.
"""
import argparse, http.server, json, os, time

HERE = os.path.dirname(os.path.abspath(__file__))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def do_POST(self):
        if self.path != "/result":
            return self.send_error(404)
        body = self.rfile.read(int(self.headers.get("content-length", 0)) or 0)
        try:
            rec = json.loads(body)
        except ValueError:
            return self.send_error(400)
        rec["_from"], rec["_at"] = self.client_address[0], time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with open(os.path.join(self.server.outdir, "probe.jsonl"), "a") as f:
            f.write(json.dumps(rec) + "\n")
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--dir", default=os.path.join(HERE, "results"))
    a = ap.parse_args()
    os.makedirs(a.dir, exist_ok=True)
    s = http.server.ThreadingHTTPServer(("0.0.0.0", a.port), H)
    s.outdir = a.dir
    s.serve_forever()
