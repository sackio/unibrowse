import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";

// extension/utils/cdp.js is a browser module (no exports the node runner can
// import), so these are source assertions. They exist because the DEFECT was
// duplication: the value-wrapping decision lived in `evaluate` only, and the
// frame path wrapped the raw expression with no `return` — so every
// frame-targeted evaluate returned undefined, reaching callers as null.
const src = fs.readFileSync("extension/utils/cdp.js", "utf8");

test("the value-wrapping decision exists exactly ONCE", () => {
  assert.equal((src.match(/_bodyForValue\s*\(expression\)\s*\{/g) || []).length, 1,
    "one definition only — a second copy is how the frame path drifted");
});

test("⛔ BOTH evaluate paths use it — the frame path silently dropped values without this", () => {
  const uses = src.match(/this\._bodyForValue\(expression\)/g) || [];
  assert.equal(uses.length, 2, "main-frame evaluate AND evaluateInFrame");
});

test("⛔ neither path wraps the RAW expression — that is the bug, verbatim", () => {
  assert.ok(
    !/\(async function\(\) \{\\n\$\{expression\}\\n\}\)\(\)/.test(src),
    "a raw ${expression} body has no return, so Runtime.evaluate yields undefined",
  );
});

test("the four documented cases are all still handled", () => {
  const fn = src.slice(src.indexOf("_bodyForValue(expression)"), src.indexOf("async evaluate("));
  assert.match(fn, /hasExplicitReturn/, "A: caller wrote return");
  assert.match(fn, /isSingleStatement/, "B: single statement");
  assert.match(fn, /looksLikeWrappedExpression/, "C: IIFE in outer parens — the null-on-IIFE bug");
  assert.match(fn, /return expression;/, "D: raw multi-statement passes through");
});

test("⚠️ querySelectorInFrame depends on C, so frame click/type/query ride on it", () => {
  assert.match(src, /async querySelectorInFrame\(frameId, selector\)/);
  const q = src.slice(src.indexOf("async querySelectorInFrame"));
  assert.match(q.slice(0, 900), /evaluateInFrame\(frameId, `/,
    "it passes an IIFE through evaluateInFrame and treats falsy as not-found");
});
