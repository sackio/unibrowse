import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── LIVE TAB STATE MUST STAY THE DEFAULT ─────────────────────────────────────
 *
 * `browser_list_attached_tabs` returns `url` and `title` captured when the tab
 * was ATTACHED. They are never updated on navigation, so a tab that has moved
 * still reports the page it left.
 *
 * ⛔ THE ASYMMETRY IS THE WHOLE REASON THIS TEST EXISTS. A stale url fails
 * TOWARD "nothing to fix": a caller checking "is the browser still on the login
 * page?" reads the attach-time value, sees the page it wanted, and stops
 * looking. A field that fails toward healthy costs more than one that fails
 * toward broken, because only the second one ever gets checked.
 *
 * ⚠️ MEASURED, twice, with the caveat ALREADY WRITTEN IN THE TOOL DESCRIPTION:
 *   · 2026-08-27 — a tab whose record said "/your-orders/order-details… ·
 *     Order Details" was actually on "/hz/contact-us/… · Contact Us", 15
 *     minutes stale, which silently disabled a correctness check.
 *   · 2026-09-19 — `ha` lost an hour to a broker tab reporting
 *     consumerportal/#/devices while it was on
 *     auth.ecobee.com/u/login/identifier.
 *
 * ⇒ Two seats were bitten by a hazard the documentation already named. THE DOC
 * IS NOT THE LEVER; THE DEFAULT IS. `live` therefore defaults to TRUE at the
 * tool boundary (2026-09-26, agreed with `ha` 2026-09-19) and a caller must opt
 * OUT with live:false. This test exists because the regression is invisible:
 * flipping the default back leaves every call succeeding, every field present,
 * and only the staleness returns.
 *
 * ⚠️ AND AN OLD EXTENSION MUST NOT READ AS AGREEMENT. A build predating the
 * option ignores `live` and returns no live fields; absent flags would read as
 * "unchanged", which is the same false all-clear. The response has to say the
 * data is UNAVAILABLE.
 */

const repoRoot = path.join(import.meta.dirname, "../..");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const handlerSrc = codeOnly(
  fs.readFileSync(path.join(repoRoot, "src/tools/multi-tab-management.ts"), "utf8"),
);
const schemaSrc = fs.readFileSync(
  path.join(repoRoot, "src/types/tool-schemas.ts"),
  "utf8",
);

test("live defaults to TRUE at the tool boundary — opt OUT, never opt in", () => {
  assert.match(
    handlerSrc,
    /live\s*=\s*\(params as any\)\?\.live\s*!==\s*false/,
    "browser_list_attached_tabs must derive live as `!== false` so a caller who says nothing gets live state",
  );
});

test("no `live === true` gate survives anywhere in the tool", () => {
  // An `=== true` test anywhere in this path silently restores opt-in: the
  // default becomes false again for that branch only, which is harder to see
  // than a wholesale revert.
  assert.equal(
    /live\s*===\s*true/.test(handlerSrc),
    false,
    "a `live === true` comparison re-introduces opt-in semantics for that branch",
  );
});

test("the extension is asked for live state on every call", () => {
  assert.match(
    handlerSrc,
    /broadcastSocketMessage\(\s*"browser_list_attached_tabs",\s*\{\s*live\s*\}/,
    "the broadcast must forward the computed live flag, not a re-derived one",
  );
});

test("an extension too old for live state is reported UNAVAILABLE, not unchanged", () => {
  assert.match(handlerSrc, /liveUnavailable/);
  assert.match(handlerSrc, /LIVE STATE UNAVAILABLE/);
  assert.match(
    handlerSrc,
    /tab\.liveUrl === undefined && tab\.liveError === undefined/,
    "absent live fields must be distinguished from live fields that agree",
  );
});

test("the schema tells callers the default and how to opt out", () => {
  const block = schemaSrc.slice(schemaSrc.indexOf("ListAttachedTabsTool"));
  assert.match(block, /DEFAULTS TRUE/);
  assert.match(block, /live:false/);
});
