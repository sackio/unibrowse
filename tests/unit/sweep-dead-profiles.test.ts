import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sweepDeadProfiles } from "../../src/utils/dead-profiles.ts";

/**
 * The EBUSY rename-aside path has always said the dir is "left for an external
 * sweep to reap". Nothing ever reaped it: 130 were found on office 2026-09-03,
 * every one 83-90 days old. These tests are about the sweep being narrow enough
 * to trust running unattended, as root, over a shared NFS tree.
 */

function fixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sweep-"));
}

function mk(dir: string, name: string) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "Cookies"), "x");
}

const OLD = Date.now() - 30 * 24 * 3600 * 1000;

test("⛔ it deletes ONLY <name>.dead-<epoch>, never a live profile", async () => {
  const dir = fixture();
  mk(dir, "unibrowse-test");           // a live profile
  mk(dir, "ecobee-broker");            // a live profile holding real auth
  mk(dir, `usage-admin.dead-${OLD}`);  // ours
  mk(dir, "notes.dead-backup");        // NOT ours — no epoch
  mk(dir, "dead-letters");             // NOT ours — no <name>. prefix match

  const r = await sweepDeadProfiles(dir);
  const left = fs.readdirSync(dir).sort();
  assert.deepEqual(left, ["dead-letters", "ecobee-broker", "notes.dead-backup", "unibrowse-test"]);
  assert.equal(r.reaped, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("⛔ age comes from the NAME, not mtime", async () => {
  // mtime is writable by anything that walks the tree — a backup, an audit, a
  // du. Trusting it would let an unrelated traversal make a recently-parked
  // profile look ancient, or shield a genuinely old one forever.
  const dir = fixture();
  mk(dir, `a.dead-${OLD}`);
  // Touch it to LOOK brand new. It must still be reaped.
  fs.utimesSync(path.join(dir, `a.dead-${OLD}`), new Date(), new Date());
  assert.equal((await sweepDeadProfiles(dir)).reaped, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a freshly parked profile is left alone — EBUSY may still be resolving", async () => {
  const dir = fixture();
  mk(dir, `a.dead-${Date.now()}`);
  const r = await sweepDeadProfiles(dir);
  assert.equal(r.reaped, 0);
  assert.equal(r.skipped, 1);
  assert.equal(fs.readdirSync(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the sweep is bounded — one launch does not pay for the whole backlog", async () => {
  const dir = fixture();
  for (let i = 0; i < 10; i++) mk(dir, `p${i}.dead-${OLD + i}`);
  const r = await sweepDeadProfiles(dir, { maxPerSweep: 4 });
  assert.equal(r.reaped, 4);
  assert.equal(r.gaveUp, true, "hitting the cap must be reported, not silent");
  assert.equal(fs.readdirSync(dir).length, 6, "the rest drain on later launches");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("⛔ an unreadable profiles dir returns rather than throwing", async () => {
  // It is attached to something a caller is waiting on: a sweep that threw
  // would report "your browser did not start" for a janitor's problem.
  const r = await sweepDeadProfiles("/definitely/not/a/real/path");
  assert.deepEqual(r, { reaped: 0, skipped: 0, gaveUp: false });
});

/**
 * ⛔ THE REGRESSION THAT CAUSED AN OUTAGE. The first version was a synchronous
 * rmSync loop wired into server startup. Against 130 NFS directories that could
 * never be deleted it blocked main() before listen(), and mcp-server — shared
 * LAN-wide — came up unhealthy and stayed there until reverted.
 *
 * These two pin the properties that make that impossible to repeat.
 */
test("⛔ it returns a promise — a sync sweep is what blocked startup", () => {
  const p = sweepDeadProfiles("/definitely/not/a/real/path");
  assert.ok(typeof (p as any)?.then === "function", "must be awaitable, so callers can decline to await");
  return p;
});

test("⛔ it honours a wall-clock deadline even with work left to do", async () => {
  const dir = fixture();
  for (let i = 0; i < 40; i++) mk(dir, `p${i}.dead-${OLD + i}`);
  const t0 = Date.now();
  const r = await sweepDeadProfiles(dir, { maxPerSweep: 10_000, deadlineMs: 0 });
  assert.ok(Date.now() - t0 < 1000, "a zero deadline must stop it almost immediately");
  assert.equal(r.gaveUp, true, "giving up must be reported so it is not read as 'nothing to do'");
  assert.ok(fs.readdirSync(dir).length > 0, "it stopped early rather than finishing the batch");
  fs.rmSync(dir, { recursive: true, force: true });
});
