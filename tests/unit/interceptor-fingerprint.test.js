import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";

// Source assertions: this file runs in the page's MAIN world, so the node
// runner cannot import it. Behaviour was verified live (see the commit); these
// guard the properties that are easy to regress by editing nearby code.
const src = fs.readFileSync("extension/lib/network-interceptor.js", "utf8");

test("⛔ no ENUMERABLE global carries our product name — a page could read it by name or find it in a for-in", () => {
  // ⚠️ Line-anchored on purpose: the file QUOTES the old flag name in a comment
  // explaining why it went. A naive substring match flags that comment and the
  // test fails on its own documentation — which is exactly what happened.
  assert.ok(!/^\s*window\.__unibrowse_network_interceptor__\s*=/m.test(src),
    "the old branded flag must stay gone as an ASSIGNMENT (a comment about it is fine)");
  assert.match(src, /enumerable:\s*false/, "the re-injection guard is defined non-enumerable");
});

test("every wrapped builtin is passed through hideWrapper with its NATIVE name", () => {
  for (const [, name] of [["fetch","'fetch'"],["xhr","'XMLHttpRequest'"],["ws","'WebSocket'"]]) {
    assert.ok(src.includes(`hideWrapper(`) && src.includes(name),
      `expected a hideWrapper call naming ${name}`);
  }
  assert.equal((src.match(/hideWrapper\(/g) || []).length, 4,
    "one definition + three wrappers (fetch, XMLHttpRequest, WebSocket)");
});

test("⛔ the toString override hides ITSELF — otherwise one call exposes the whole scheme", () => {
  assert.match(src, /NATIVE_SRC\.set\(patchedToString,\s*'function toString\(\) \{ \[native code\] \}'\)/);
});

test("a function we did NOT wrap still reports its real source", () => {
  assert.match(src, /origToString\.call\(this\)/, "unknown functions fall through to the original");
});

test("⚠️ constructor statics are carried across, or page feature-detection breaks", () => {
  assert.equal((src.match(/getOwnPropertyNames\((OrigXHR|OrigWS)\)/g) || []).length, 2,
    "XHR and WebSocket both copy their constructor properties");
});

test("⛔ the file states what this does NOT achieve — nobody should read it as invisibility", () => {
  assert.match(src, /does not\s*\n?\s*\/\/ make the browser undetectable|not make the browser undetectable/i);
});
