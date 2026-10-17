import { test } from "node:test";
import assert from "node:assert/strict";
import { WaitTool } from "../../src/types/tool-schemas.ts";

// ⭐ WHY THIS TEST EXISTS. zod strips unknown keys, so before the alias a caller
// writing `seconds: 8` had it dropped, silently received the `time` default of
// 1, and read back "Waited for 1 seconds" — a TRUTHFUL response that is
// byte-indistinguishable from a broken tool. Measured 2026-10-16: five wasted
// calls and a filed bug before anyone read the schema. The guard is the alias,
// and these tests are what keep the alias from being tidied away again.
const args = (o) => WaitTool.shape.arguments.parse(o);

test("`seconds` is accepted and is not stripped", () => {
  const v = args({ seconds: 8 });
  assert.equal(v.seconds, 8);
});

test("`time` is still the documented name", () => {
  assert.equal(args({ time: 3 }).time, 3);
});

test("⛔ neither key is a parse error — the handler supplies the 1s default", () => {
  const v = args({});
  assert.equal(v.time, undefined, "no .default() here; resolution lives in the handler");
  assert.equal(v.seconds, undefined);
});

test("the resolution rule: time wins, then seconds, then 1", () => {
  const resolve = (o) => { const { time, seconds } = args(o); return time ?? seconds ?? 1; };
  assert.equal(resolve({ time: 5, seconds: 9 }), 5);
  assert.equal(resolve({ seconds: 9 }), 9);
  assert.equal(resolve({ time: 5 }), 5);
  assert.equal(resolve({}), 1);
  assert.equal(resolve({ seconds: 0 }), 0, "0 is a real value, not a missing one");
});

test("the description tells a caller both names work", () => {
  assert.match(WaitTool.shape.description.value, /seconds/);
  assert.match(WaitTool.shape.description.value, /alias/i);
});
