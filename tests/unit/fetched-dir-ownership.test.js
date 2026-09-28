import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── A PRIVATE DIRECTORY IS ONLY REACHABLE IF EVERY PARENT IS ─────────────────
 *
 * The fetch store's subdirectories are created by the SERVER, which runs as
 * root, while every agent seat runs as uid 1000. So mode alone cannot express
 * "private to the agents" — the directory needs an owner too, and
 * ensurePrivateDir chowns it to whoever owns the store.
 *
 * ⛔ THE DEFECT THIS LOCKS OUT. `mkdirSync(recursive: true)` creates the WHOLE
 * chain, and the original chowned only the leaf. A nested destination —
 * "laura-work/mgb-oe-2027" — therefore left the intermediate "laura-work"
 * root-owned at mode 0700. Traversal needs execute on every parent, so the
 * correctly-chowned leaf underneath was still unreachable: uid 1000 got
 * Permission denied on the directory it had just asked the server to fill.
 *
 * ⚠️ AND THE FETCH REPORTED SUCCESS — indexed:true, with a path the caller
 * could not read. Another signal failing toward "healthy".
 *
 * ⚠️ WHY IT SURVIVED: a ONE-LEVEL destination works perfectly. Reported by
 * `thread-laura-work-2` on 2026-09-28 after two files were stranded; reproduced
 * here the same day, where a single-level probe had just passed. A test that
 * only exercises one level cannot catch it, which is the point of this file.
 *
 * ⛔ The store root itself must never be rewritten — its ownership is host-side
 * state we inherit FROM. The walk stops before it.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const src = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");

function ensurePrivateDirBody(text) {
  const start = text.indexOf("const ensurePrivateDir");
  assert.notEqual(start, -1, "ensurePrivateDir must exist in src/http-server.ts");
  const end = text.indexOf("\n};", start);
  assert.notEqual(end, -1, "could not find the end of ensurePrivateDir");
  return text.slice(start, end);
}

const body = ensurePrivateDirBody(src);

test("ownership is applied to every created segment, not just the leaf", () => {
  // The chown/chmod must run over a COLLECTION. A call that names the leaf
  // parameter directly is the regression: it leaves intermediates root-owned.
  assert.match(body, /for\s*\(const\s+\w+\s+of\s+\w+\)/,
    "ensurePrivateDir must iterate the created segments");
  assert.equal(/fs\.chownSync\(dir\b/.test(body), false,
    "chowning `dir` alone re-introduces the stranded-intermediate defect");
  assert.equal(/fs\.chmodSync\(dir\b/.test(body), false,
    "chmoding `dir` alone leaves intermediates at their creation mode");
});

test("the walk climbs from the leaf and stops before the store root", () => {
  assert.match(body, /path\.dirname\(/, "must climb the chain toward the store root");
  assert.match(body, /startsWith\(root \+ path\.sep\)/,
    "the loop bound must exclude the store root itself, not merely differ from it");
});

test("a failure on one segment cannot abort the fetch", () => {
  // The bytes are the deliverable. Ownership is best-effort and warns.
  assert.match(body, /catch\s*\(err: any\)/);
  assert.match(body, /console\.warn\(/);
});
