#!/usr/bin/env python3
"""Extract the site list from the Browser Use stealth bench for panel.py.

  bu_sites.py <path/to/Stealth_Bench_V1.enc> > results/sites.json

The dataset is Fernet-encrypted with a key derived from its own name
(review_rubric_revision.py in github.com/browser-use/benchmark). Needs the
`cryptography` package, so run it in a container rather than on a host:

  docker run --rm -v $PWD:/b -w /b python:3.12-slim sh -c \
    'pip -q install cryptography && python3 drover/bench/bu_sites.py BU/Stealth_Bench_V1.enc'

⛔ Browser Use asks that the decrypted tasks not be published in plaintext.
Only {url, vendor} is emitted, and only into results/, which is gitignored.
"""
import base64, hashlib, json, os, re, sys

from cryptography.fernet import Fernet

path = sys.argv[1]
name = os.path.splitext(os.path.basename(path))[0]
key = base64.urlsafe_b64encode(hashlib.sha256(name.encode()).digest())
tasks = json.loads(Fernet(key).decrypt(base64.b64decode(open(path, "rb").read())))
out = []
for t in tasks:
    m = re.search(r"Go to (https?://\S+?)[,<\s]", t["confirmed_task"])
    if m:
        out.append({"url": m.group(1).rstrip("."), "vendor": t.get("category")})
json.dump(out, sys.stdout, indent=1)
