import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── REALISTIC MODE MUST NOT START EVERY MOVE AT (0,0) ────────────────────────
 *
 * Ben, Slack #unibrowse 2026-10-08: realistic mode must "move to where they
 * need to go, show some randomness in their movement, show some delay and
 * random hesitation like a human would".
 *
 * ⛔ THE REGRESSION THIS GUARDS IS INVISIBLE. `currentX`/`currentY` default to
 * 0 in both the tool schema and extension/utils/cdp.js, so dropping the
 * server-side cursor tracking leaves EVERY call succeeding, every response
 * well-formed, and only the behaviour reverts — to a bezier path that begins
 * at the viewport's top-left corner on every single action. That is not
 * degraded realism, it is a fixed signature, and nothing in any output says so.
 *
 * ⚠️ Same reason `aria-snapshot-live-label.test.js` exists: the failure mode is
 * "works, and lies".
 */

const repoRoot = path.join(import.meta.dirname, "../..");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const src = codeOnly(
  fs.readFileSync(path.join(repoRoot, "src/tools/realistic-input.ts"), "utf8"),
);

test("the cursor is tracked per tab, not assumed", () => {
  assert.match(src, /cursorByTab\s*=\s*new Map/, "a per-tab cursor store must exist");
  assert.match(src, /function tabKey\(/, "the store must be keyed per tab, not global");
});

test("the first-use seed is random, never a constant corner", () => {
  const fn = src.slice(src.indexOf("function getCursor"));
  assert.match(fn, /Math\.random\(\)/, "the seed must be randomised");
  assert.equal(
    /\{\s*x:\s*0\s*,\s*y:\s*0\s*\}/.test(fn),
    false,
    "seeding the cursor at (0,0) reinstates the signature this file exists to prevent",
  );
});

test("a move defaults currentX/currentY from the tracked cursor", () => {
  assert.match(
    src,
    /currentX:\s*validatedParams\.currentX\s*\?\?\s*from\.x/,
    "currentX must fall back to the tracked position, not to the schema's 0",
  );
  assert.match(
    src,
    /currentY:\s*validatedParams\.currentY\s*\?\?\s*from\.y/,
    "currentY must fall back to the tracked position, not to the schema's 0",
  );
});

test("a click walks to the target with hesitation before pressing", () => {
  assert.match(src, /async function walkCursorTo\(/, "the multi-leg walk must exist");
  assert.match(src, /await walkCursorTo\(/, "realisticClick must actually call it");
  // The pause between legs is the hesitation. Without a sleep it is one glide.
  const walk = src.slice(src.indexOf("async function walkCursorTo"));
  assert.match(walk, /await sleep\(/, "there must be a real pause between legs");
});

test("the click itself does not move again — that would double the journey", () => {
  assert.match(
    src,
    /moveFirst:\s*false/,
    "after walking there, the click must pass moveFirst:false or the extension re-moves from a stale origin",
  );
});

test("leg count stays capped — the Xvfb timeout is why movement was off by default", () => {
  const walk = src.slice(src.indexOf("async function walkCursorTo"));
  // 1 + floor(random*2) + (dist>600 ? 1 : 0) tops out at 3.
  assert.match(walk, /Math\.floor\(Math\.random\(\)\s*\*\s*2\)/, "leg count must stay bounded");
  assert.equal(
    /legs\s*=\s*\d{2,}/.test(walk),
    false,
    "a large fixed leg count would re-create the 30s WebSocket timeout on Xvfb sidecars",
  );
});

test("synthetic typos stay off", () => {
  // mistakeChance defaults to 0 in the schema. Nothing here may raise it: a
  // corrected typo in a credential or an order quantity is a real-world error.
  assert.equal(
    /mistakeChance\s*:\s*(?!0)/.test(src),
    false,
    "realistic-input must never set mistakeChance — wrong characters are not free",
  );
});
