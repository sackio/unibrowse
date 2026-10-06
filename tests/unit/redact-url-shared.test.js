import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── ONE REDACTION, TWO CALLERS, AND THE PATH CASE ────────────────────────────
 *
 * `redactUrl` lived privately in src/tools/multi-tab-management.ts with one
 * caller. On 2026-10-06 it gained a second (the recording store) and was
 * extracted to src/utils/redact-url.ts. ⛔ It must NOT be copied back: that is
 * precisely the defect behind the frame-evaluate bug, where `c781885` fixed one
 * copy of a wrapper and left its sibling, with nothing to surface the sibling.
 *
 * ⛔ AND QUERY-ONLY REDACTION IS NOT ENOUGH. `atc` 2026-10-06: ATC file and
 * artifact links carry the secret in the PATH —
 * `atc.sack.io/f/up-<32 hex>/<name>`, `:3031/artifact/<id>/data`, the last of
 * which returns every response ever submitted against that artifact. 128
 * unguessable bits, no login, no ACL. A capture holding one is a working
 * credential for whoever reads the capture.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const util = fs.readFileSync(path.join(repoRoot, "src/utils/redact-url.ts"), "utf8");
const tabs = fs.readFileSync(path.join(repoRoot, "src/tools/multi-tab-management.ts"), "utf8");
const http = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");

test("there is exactly one definition, and it is the shared util", () => {
  assert.match(util, /export function redactUrl\(/);
  // A re-introduced local copy in either consumer is the regression.
  assert.equal(
    /^function redactUrl\(/m.test(tabs), false,
    "multi-tab-management must import redactUrl, not define its own",
  );
  assert.equal(
    /^function redactUrl\(/m.test(http), false,
    "http-server must import redactUrl, not define its own",
  );
});

test("both consumers import it", () => {
  assert.match(tabs, /import \{ redactUrl \} from "@\/utils\/redact-url"/);
  assert.match(http, /import \{ redactUrl \} from "@\/utils\/redact-url"/);
});

test("path secrets are redacted, not just query values", () => {
  assert.match(util, /up-\[0-9a-f\]\{32\}/i, "ATC upload ids must be matched in the path");
  assert.match(util, /f\|files\|artifact/, "the /f/ /files/ /artifact/ id forms must be matched");
});

test("a URL with NO query or fragment still goes through path redaction", () => {
  // The original early-returned `raw` when there was no '?' or '#', which would
  // have let every ATC link through untouched — they have neither.
  assert.match(
    util,
    /if \(q === -1 && h === -1\) return redactPathSecrets\(raw\)/,
    "the no-query early return must still redact the path",
  );
});

test("the recording store redacts URLs on the body-less branch too", () => {
  // A GET with no body is exactly the request that carries its token in the
  // query string. An early `return e` there would defeat the whole fix.
  const start = http.indexOf('app.post("/api/v1/recordings/:id/events"');
  const next = http.indexOf("app.post(", start + 10);
  const handler = http.slice(start, next === -1 ? http.length : next);
  assert.match(
    handler,
    /if \(!hadReq && !hadRes\) return \{ \.\.\.e, url: redactUrl\(e\.url\) \}/,
    "the no-bodies branch must redact the URL rather than returning the entry untouched",
  );
});

test("typed input values are stripped at ingest, payload emptied not dropped", () => {
  assert.match(http, /valueRedacted: true/);
  assert.match(http, /textRedacted: true/);
  // Emptied, never removed: rrweb incremental events are diffs and a dropped
  // one replays blank.
  assert.match(http, /text: ""/, "rrweb input text must be emptied, not deleted");
});
