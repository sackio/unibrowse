import { test } from "node:test";
import assert from "node:assert/strict";
import "../../extension/error-detail.js";

const { describeError } = globalThis;

test("a normal Error keeps its message", () => {
  assert.equal(describeError(new Error("boom")), "boom");
});

test("an Error with an EMPTY message still says something", () => {
  const d = describeError(new Error(""));
  assert.notEqual(d, "");
  assert.match(d, /Error/, "the name is the last useful thing left");
});

test("a thrown string survives", () => {
  assert.equal(describeError("just a string"), "just a string");
});

test("a thrown object with a code is described by its code", () => {
  assert.match(describeError({ code: "UNATTACHABLE_URL" }), /UNATTACHABLE_URL/);
});

test("a thrown plain object is serialised rather than becoming [object Object]", () => {
  const d = describeError({ reason: "tab gone", tabId: 7 });
  assert.match(d, /tab gone/);
  assert.ok(!d.includes("[object Object]"));
});

test("undefined and null never produce an empty string", () => {
  for (const v of [undefined, null]) {
    const d = describeError(v);
    assert.notEqual(d, "");
    assert.match(d, /no error detail|undefined|null/i);
  }
});

test("a DOMException-shaped throw keeps its name when the message is empty", () => {
  const d = describeError({ name: "NotAllowedError", message: "" });
  assert.match(d, /NotAllowedError/);
});

test("chrome.runtime.lastError shape is understood", () => {
  assert.match(describeError({ message: "No tab with id: 41931315" }), /No tab with id/);
});

test("an error carrying a code AND a message reports both", () => {
  const d = describeError(Object.assign(new Error("attach failed"), { code: "ETAB" }));
  assert.match(d, /attach failed/);
  assert.match(d, /ETAB/);
});

test("the result is always a non-empty string", () => {
  const inputs = [undefined, null, "", 0, false, {}, [], new Error(""), { message: "" }, NaN];
  for (const v of inputs) {
    const d = describeError(v);
    assert.equal(typeof d, "string");
    assert.ok(d.length > 0, `empty for ${JSON.stringify(v)}`);
  }
});

test("a huge payload is truncated rather than shipped whole", () => {
  const d = describeError({ blob: "x".repeat(10000) });
  assert.ok(d.length < 1200);
});
