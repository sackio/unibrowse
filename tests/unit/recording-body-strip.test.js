import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── NETWORK BODIES MUST NOT REACH THE RECORDING STORE ────────────────────────
 *
 * MEASURED 2026-10-06: the saved store held 693 unrequested auto-captures across
 * 61 hosts, among them `secure.bankofamerica.com`, `www.fidelity.com` and five
 * captures of a family member's MGB benefits portal — the rendered pages WITH
 * request and response bodies, in a store readable by every seat on every host.
 *
 * ⛔ THIS GUARD IS SERVER-SIDE ON PURPOSE AND MUST STAY THERE. The interceptor
 * that captures bodies is extension code, and extension code reaches no running
 * browser without the manual ↻ the operator has declined. A fix that lives only
 * in the extension protects the browsers that reload and no others. Stripping at
 * ingest covers every connected browser on the next :9010 restart.
 * ⇒ When the extension-side change ships, this stays. Defence in depth costs one
 * map(); the failure it prevents is unrecoverable once the bytes are written and
 * copied into 62 nightly archives.
 *
 * ⚠️ AND THE DROP MUST ANNOUNCE ITSELF. A silently absent body is
 * indistinguishable from a request that never had one, so someone debugging an
 * empty response would chase the wrong thing. The marker is the fix for that.
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../src/http-server.ts"),
  "utf8",
);

// Scope every assertion to the events-ingest handler, so an unrelated match
// elsewhere in a 1000-line file cannot make this test pass vacuously.
const handler = (() => {
  const start = src.indexOf('app.post("/api/v1/recordings/:id/events"');
  assert.notEqual(start, -1, "events ingest handler not found — did the route move?");
  return src.slice(start, start + 4000);
})();

test("both bodies are nulled at ingest", () => {
  assert.match(handler, /requestBody:\s*null/);
  assert.match(handler, /responseBody:\s*null/);
});

test("the stripped array is what gets inserted, not the raw one", () => {
  // The whole fix is defeated by stripping into a variable and then inserting
  // `networkEntries` anyway — which still typechecks and still passes any test
  // that only looks for `responseBody: null`.
  assert.match(
    handler,
    /networkEntries:\s*strippedEntries/,
    "insertOne must receive the stripped array",
  );
});

test("a dropped body is marked, not silently absent", () => {
  assert.match(handler, /bodiesStrippedAtIngest/);
});

test("URL, status and timing survive — a network log is still useful", () => {
  // Stripping is a spread-and-override, so the other fields are kept by
  // construction. Assert the shape rather than the absence of a deletion.
  assert.match(handler, /\.\.\.e,/, "entries must be spread, not rebuilt field by field");
});
