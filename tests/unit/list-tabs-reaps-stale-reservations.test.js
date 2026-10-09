import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── THE TAB LISTING MUST NOT REPORT AN EXPIRED CLAIM AS LIVE ────────────────
 *
 * Reservation expiry in TabManager is LAZY. There is no periodic sweep:
 * `_reapIfStale` runs only from `claimTab`, `checkAccess` and `getReservation`.
 * So `this.reservations` holds entries long past their 30-minute idle TTL, and
 * anything that reads that map directly reports them as current.
 *
 * `listTabs()` did exactly that — `this.reservations.get(tabId)` — while
 * `getReservation()`, three hundred lines away, carried a comment saying it
 * reaps on read "so browser_list_attached_tabs never reports a phantom owner".
 * The repair existed and the listing did not call it.
 *
 * MEASURED 2026-10-09, found by the `cluster` seat: five tabs reported as
 * reserved by "login-watch", claimed 10-06/10-07 and untouched since.
 *
 * ⚠️ WHAT THIS BUG WAS AND WAS NOT. The tabs were never locked — `claimTab`
 * reaps before it reads, so any seat claiming one would have got it. The cost
 * was informational: the listing is where a human or agent goes to ask who
 * holds a tab, and it named an owner that had already expired, so seats avoided
 * tabs that were free.
 *
 * ⛔ A READ-ONLY VIEW THAT BYPASSES ITS OWN REPAIR PATH REPORTS A STATE THE
 * SYSTEM DOES NOT ENFORCE. That is the general shape, and it fails toward
 * "healthy-looking": a phantom owner reads exactly like a real one.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const bg = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");

function listTabsBody() {
  const start = bg.indexOf("  listTabs() {");
  assert.notEqual(start, -1, "listTabs must exist");
  const rest = bg.slice(start);
  const end = rest.indexOf("\n  /**", 1);
  return end === -1 ? rest.slice(0, 4000) : rest.slice(0, end);
}

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

test("the listing reads reservations through the reaping accessor", () => {
  const body = codeOnly(listTabsBody());
  assert.match(
    body,
    /this\.getReservation\(/,
    "listTabs must call getReservation() so an expired claim is reaped on read",
  );
});

test("the listing never reads the raw reservation map", () => {
  const body = codeOnly(listTabsBody());
  assert.equal(
    /this\.reservations\.get\(/.test(body),
    false,
    "reading this.reservations directly reports claims that expired days ago as live",
  );
});

test("getReservation still reaps — it is the only repair the listing now has", () => {
  const i = bg.indexOf("getReservation(tabId) {");
  assert.notEqual(i, -1, "getReservation must exist");
  const fn = codeOnly(bg.slice(i, i + 400));
  assert.match(
    fn,
    /_reapIfStale\(/,
    "if getReservation stops reaping, the listing silently goes back to lying",
  );
});

/**
 * ⚠️ Expiry keys on LAST ACTIVITY, not claim time, so a long-running task that
 * keeps working keeps its claim. Re-keying this to claimedAt would cut live
 * agents off mid-flight, which is the opposite failure and a worse one.
 */
test("staleness is measured from last activity, not from claim time", () => {
  const i = bg.indexOf("_isStale(entry) {");
  assert.notEqual(i, -1, "_isStale must exist");
  const fn = codeOnly(bg.slice(i, i + 320));
  assert.match(
    fn,
    /lastActivityAt\s*\|\|\s*entry\.claimedAt/,
    "last activity must be preferred, with claimedAt only as the fallback",
  );
});
