import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── AN ARIA SNAPSHOT MUST BE LABELLED WITH WHERE THE TAB ACTUALLY IS ─────────
 *
 * `getUrl` and `getTitle` answer from the extension's registry: `tabInfo.url` /
 * `tabInfo.title`, captured when the tab was ATTACHED and never updated on
 * navigation (extension/background.js `handleGetUrl`, `handleGetTitle`; the
 * no-tabTarget path returns `this.state.tabUrl`, attach-time as well).
 *
 * ⛔ SO THE HEADER AND THE BODY DISAGREED, AND NOTHING SAID WHICH ONE LIED. The
 * snapshot body described the page the tab is on; the `Page URL:` line named the
 * page it LEFT. Same fail-toward-"nothing is wrong" class as the stale tab
 * listing that cost `ha` an hour before `504209c` — and that fix gave
 * `browser_list_attached_tabs` its `liveUrl` while leaving these two handlers
 * alone, so this call site KEPT the bug after its sibling was repaired.
 *
 * ⚠️ FOUND 2026-10-04 by reading `handleGetUrl`, fixed 2026-10-05. The reason it
 * survived: `504209c` fixed one of two readers of the same stale field, and
 * nothing surfaces the sibling. A fix creates debt in the paths it did not touch.
 *
 * ⇒ This test exists because the regression is INVISIBLE. Reverting to `getUrl`
 * leaves every call succeeding, every field present and the output
 * well-formed — only the staleness returns, and only for tabs that happened to
 * navigate. There is no error to notice.
 *
 * ⚠️ IT ALSO LOCKS THE FALLBACK. `browser_evaluate` is refused on `chrome://`
 * and other privileged pages, where `getUrl` still answers. Dropping the
 * fallback to "do it properly" would make snapshots that used to work start
 * failing: a stale label beats no snapshot, so both halves are required.
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
  fs.readFileSync(path.join(repoRoot, "src/utils/aria-snapshot.ts"), "utf8"),
);

test("the snapshot label is read with location.href, not getUrl", () => {
  assert.match(
    src,
    /liveOrRegistry\(\s*context,\s*"location\.href",\s*"getUrl"/,
    "captureAriaSnapshot must ask the page where it is, with getUrl only as fallback",
  );
});

test("the snapshot title is read with document.title, not getTitle", () => {
  // getTitle has the identical defect. Fixing only the URL would read as fixed
  // while half the header stayed stale — the exact half-fix this file guards.
  assert.match(
    src,
    /liveOrRegistry\(\s*context,\s*"document\.title",\s*"getTitle"/,
    "the title is registry-stale too and must come from the page",
  );
});

test("getUrl/getTitle are never sent as the PRIMARY source", () => {
  // A direct sendSocketMessage("getUrl", …) anywhere in this file means some
  // path went back to trusting the registry first.
  assert.equal(
    /sendSocketMessage\(\s*"getUrl"/.test(src),
    false,
    'getUrl must only be reached through liveOrRegistry\'s fallback, never called directly',
  );
  assert.equal(
    /sendSocketMessage\(\s*"getTitle"/.test(src),
    false,
    'getTitle must only be reached through liveOrRegistry\'s fallback, never called directly',
  );
});

test("the registry fallback survives — a privileged page must still snapshot", () => {
  // Without this, chrome:// pages lose snapshots entirely in exchange for a
  // fresher label on pages that were already fine.
  assert.match(src, /catch\s*\{/, "the live read must be wrapped so a refusal falls through");
  assert.match(
    src,
    /return await context\.sendSocketMessage\(\s*fallback/,
    "the fallback branch must actually send the registry request",
  );
});

test("the live read is attempted even when no tabTarget was passed", () => {
  // The no-arg path is the common one. Gating the live read on `tabTarget`
  // would leave the default case stale while the tests above still passed.
  const fn = src.slice(src.indexOf("async function liveOrRegistry"));
  const guard = /if\s*\(\s*tabTarget\s*===?\s*undefined\s*\)\s*return/.test(fn);
  assert.equal(
    guard,
    false,
    "an early return for a missing tabTarget would leave the most common call path stale",
  );
});
