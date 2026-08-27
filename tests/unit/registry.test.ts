import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchRegistry } from "../../src/watch/registry.ts";
import type { WatchSpec } from "../../src/watch/types.ts";

const spec = (over: Partial<WatchSpec> = {}): WatchSpec => ({
  source: "cdp.Network.eventSourceMessageReceived",
  sink: { kind: "atc" as const },
  extensionId: "ext_a",
  tabId: 1,
  agent: "unibrowse",
  ...over,
});

test("create returns a unique id and echoes the home", () => {
  const r = new WatchRegistry();
  const a = r.create(spec(), "worker");
  const b = r.create(spec(), "worker");
  assert.notEqual(a.watchId, b.watchId);
  assert.equal(a.home, "worker");
});

test("a new watch has NO armed claim — null, not true", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  assert.equal(
    w.armedReportedByExtension,
    null,
    "the server must not assert armed before the extension has said so",
  );
});

test("recordArmed stores the extension's raw answer including false", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  r.recordArmed(w.watchId, false, 123);
  assert.equal(r.get(w.watchId)?.armedReportedByExtension, false);
  assert.equal(r.get(w.watchId)?.armedReportedAt, 123);
});

test("deleting a tab cascades only that tab's watches", () => {
  const r = new WatchRegistry();
  const keep = r.create(spec({ tabId: 2 }), "worker");
  r.create(spec({ tabId: 1 }), "worker");
  const removed = r.deleteByTab("ext_a", 1);
  assert.equal(removed.length, 1);
  assert.ok(r.get(keep.watchId));
});

test("deleting a tab leaves browser-wide watches alone", () => {
  const r = new WatchRegistry();
  const wide = r.create(spec({ tabId: null }), "worker");
  r.create(spec({ tabId: 1 }), "worker");
  r.deleteByTab("ext_a", 1);
  assert.ok(r.get(wide.watchId), "a browser-scoped watch does not die with one tab");
});

test("deleting an extension cascades browser-wide watches too", () => {
  const r = new WatchRegistry();
  r.create(spec({ tabId: null }), "worker");
  r.create(spec({ tabId: 5 }), "worker");
  const other = r.create(spec({ extensionId: "ext_b" }), "worker");
  assert.equal(r.deleteByExtension("ext_a").length, 2);
  assert.ok(r.get(other.watchId));
});

test("expire removes only watches past ttl", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ options: { ttlMs: 1000 } }), "worker");
  const born = r.get(w.watchId)!.createdAt;
  assert.equal(r.expire(born + 500).length, 0);
  assert.equal(r.expire(born + 2000).length, 1);
  assert.equal(r.get(w.watchId), undefined);
});

test("a watch with no ttl never expires", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  assert.equal(r.expire(Date.now() + 999_999_999).length, 0);
  assert.ok(r.get(w.watchId));
});

test("specsFor returns one extension's watches, for re-push on register", () => {
  const r = new WatchRegistry();
  r.create(spec(), "worker");
  r.create(spec({ extensionId: "ext_b" }), "worker");
  assert.equal(r.specsFor("ext_a").length, 1);
});

test("delete is idempotent", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  assert.equal(r.delete(w.watchId), true);
  assert.equal(r.delete(w.watchId), false);
});

test("recordFired increments and stamps", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  r.recordFired(w.watchId, 500);
  r.recordFired(w.watchId, 600);
  assert.equal(r.get(w.watchId)?.firedCount, 2);
  assert.equal(r.get(w.watchId)?.lastFiredAt, 600);
});

test("list filters by tab and by extension", () => {
  const r = new WatchRegistry();
  r.create(spec({ tabId: 1 }), "worker");
  r.create(spec({ tabId: 2 }), "worker");
  r.create(spec({ extensionId: "ext_b", tabId: 1 }), "worker");
  assert.equal(r.list().length, 3);
  assert.equal(r.list({ extensionId: "ext_a" }).length, 2);
  assert.equal(r.list({ extensionId: "ext_a", tabId: 1 }).length, 1);
});

test("deleting by tab then by extension does not double-count", () => {
  const r = new WatchRegistry();
  r.create(spec({ tabId: 1 }), "worker");
  r.deleteByTab("ext_a", 1);
  assert.equal(r.deleteByExtension("ext_a").length, 0, "indexes must stay in sync");
});
