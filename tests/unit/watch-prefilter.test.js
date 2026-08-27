import { test } from "node:test";
import assert from "node:assert/strict";
import "../../extension/watch-prefilter.js";

const { compilePrefilter, getPath } = globalThis;

test("getPath walks a dotted path and returns undefined for a miss", () => {
  const o = { a: { b: { c: 1 } }, arr: [{ x: 2 }] };
  assert.equal(getPath(o, "a.b.c"), 1);
  assert.equal(getPath(o, "arr.0.x"), 2);
  assert.equal(getPath(o, "a.nope.c"), undefined);
  assert.equal(getPath(o, "a.b.c.d"), undefined);
});

test("no prefilter matches everything", () => {
  assert.equal(compilePrefilter(undefined)({ anything: 1 }), true);
  assert.equal(compilePrefilter(null)({ anything: 1 }), true);
});

test("includes", () => {
  const f = compilePrefilter({ path: "url", op: "includes", value: "target" });
  assert.equal(f({ url: "https://x/target/y" }), true);
  assert.equal(f({ url: "https://x/other" }), false);
});

test("equals compares strictly after string coercion of the value side only", () => {
  const f = compilePrefilter({ path: "status", op: "equals", value: 200 });
  assert.equal(f({ status: 200 }), true);
  assert.equal(f({ status: 404 }), false);
});

test("regex", () => {
  const f = compilePrefilter({ path: "url", op: "regex", value: "^https://a\\.[a-z]+/" });
  assert.equal(f({ url: "https://a.com/x" }), true);
  assert.equal(f({ url: "https://b.com/x" }), false);
});

test("an invalid regex is rejected at COMPILE time, not silently never-matching", () => {
  assert.throws(() => compilePrefilter({ path: "u", op: "regex", value: "([" }), /regex|prefilter/i);
});

test("exists distinguishes a missing key from a falsy value", () => {
  const f = compilePrefilter({ path: "a.b", op: "exists" });
  assert.equal(f({ a: { b: 0 } }), true, "0 exists");
  assert.equal(f({ a: {} }), false);
});

test("startsWith / endsWith", () => {
  assert.equal(compilePrefilter({ path: "u", op: "startsWith", value: "ab" })({ u: "abc" }), true);
  assert.equal(compilePrefilter({ path: "u", op: "endsWith", value: "bc" })({ u: "abc" }), true);
  assert.equal(compilePrefilter({ path: "u", op: "endsWith", value: "ab" })({ u: "abc" }), false);
});

test("gt / lt on numbers", () => {
  assert.equal(compilePrefilter({ path: "n", op: "gt", value: 5 })({ n: 6 }), true);
  assert.equal(compilePrefilter({ path: "n", op: "gt", value: 5 })({ n: 5 }), false);
  assert.equal(compilePrefilter({ path: "n", op: "lt", value: 5 })({ n: 4 }), true);
});

test("a missing path never matches a comparison op", () => {
  const f = compilePrefilter({ path: "nope.deep", op: "includes", value: "x" });
  assert.equal(f({}), false);
});

test("all: every clause must match", () => {
  const f = compilePrefilter({
    all: [
      { path: "url", op: "includes", value: "chat" },
      { path: "status", op: "equals", value: 200 },
    ],
  });
  assert.equal(f({ url: "/chat", status: 200 }), true);
  assert.equal(f({ url: "/chat", status: 500 }), false);
});

test("any: one clause suffices", () => {
  const f = compilePrefilter({
    any: [
      { path: "url", op: "includes", value: "a" },
      { path: "url", op: "includes", value: "b" },
    ],
  });
  assert.equal(f({ url: "zzb" }), true);
  assert.equal(f({ url: "zzz" }), false);
});

test("not inverts", () => {
  const f = compilePrefilter({ not: { path: "url", op: "includes", value: "skip" } });
  assert.equal(f({ url: "keep" }), true);
  assert.equal(f({ url: "skip" }), false);
});

test("an unknown op is rejected at compile time and names the valid set", () => {
  let err;
  try {
    compilePrefilter({ path: "u", op: "matches", value: "x" });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "an unknown op must throw, not match nothing forever");
  assert.match(err.message, /includes/);
});

test("a prefilter that throws at runtime does not match and does not propagate", () => {
  // A value shaped unexpectedly (e.g. a number where a string was assumed)
  // must not take the whole watch down.
  const f = compilePrefilter({ path: "n", op: "includes", value: "x" });
  assert.equal(f({ n: 12345 }), false);
});

test("compilePrefilter uses NO eval — the whole point on MV3", () => {
  const src = compilePrefilter.toString();
  assert.ok(!/\bnew Function\b/.test(src), "new Function is CSP-blocked in an MV3 worker");
  assert.ok(!/\beval\(/.test(src));
});
