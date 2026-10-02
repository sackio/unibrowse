import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";

// src/utils/proxy-spec.ts is MIRRORED by hand into chromium-host/server.js,
// because that container has no build step and cannot import this tree. The
// duplication is deliberate; the DRIFT is what costs — a spec accepted on one
// launch path and rejected on the other presents as an intermittent exit IP,
// which is close to undebuggable from the caller's side.
const ts = fs.readFileSync("src/utils/proxy-spec.ts", "utf8");
const js = fs.readFileSync("chromium-host/server.js", "utf8");

test("⛔ both copies accept the SAME proxy schemes", () => {
  const pick = (s, re) => {
    const m = s.match(re);
    assert.ok(m, `scheme list not found with ${re}`);
    return m[1].match(/"[a-z0-9]+"/g).map((x) => x.replace(/"/g, "")).sort();
  };
  assert.deepEqual(
    pick(ts, /const SCHEMES = \[([^\]]+)\]/),
    pick(js, /const PROXY_SCHEMES = \[([^\]]+)\]/),
  );
});

test("⛔ both copies carry the SAME default bypass entries", () => {
  const pick = (s, re) => {
    const m = s.match(re);
    assert.ok(m, `bypass list not found with ${re}`);
    return m[1].match(/"[^"]+"/g).map((x) => x.replace(/"/g, "")).sort();
  };
  assert.deepEqual(
    pick(ts, /const DEFAULT_BYPASS = \[([\s\S]*?)\]/),
    pick(js, /const DEFAULT_PROXY_BYPASS = \[([\s\S]*?)\]/),
  );
});

test("⛔ the sidecar still ECHOES the applied proxy — mcp-server's skew check depends on it", () => {
  assert.match(js, /return \{ pid: proc\.pid, display, profileDir, proxy: appliedProxy/);
});

test("⛔ the sidecar still REFUSES credentials and bare flags", () => {
  assert.match(js, /may not carry credentials/);
  assert.match(js, /may not start with '-'/);
});
