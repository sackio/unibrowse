import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchRegistry } from "../../src/watch/registry.ts";
import { planRehydration, toPersisted, fromPersisted } from "../../src/watch/persistence.ts";
import type { WatchSpec } from "../../src/watch/types.ts";

const spec = (over: Partial<WatchSpec> = {}): WatchSpec => ({
  source: "chrome.webNavigation.onCommitted",
  sink: { kind: "atc" as const },
  extensionId: "ext_a",
  tabId: 1,
  agent: "unibrowse",
  ...over,
});

test("a persisted record round-trips its spec", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ predicate: "(e) => true", options: { maxPerMin: 5 } }), "worker");
  const back = fromPersisted(toPersisted(w));
  assert.equal(back.watchId, w.watchId);
  assert.equal(back.source, w.source);
  assert.equal(back.predicate, w.predicate);
  assert.equal(back.options?.maxPerMin, 5);
  assert.equal(back.extensionId, "ext_a");
});

test("⛔ a rehydrated watch is NEVER armed — the server has not spoken to the browser", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  r.recordArmed(w.watchId, true, Date.now());
  const back = fromPersisted(toPersisted(w));
  assert.equal(
    back.armedReportedByExtension,
    null,
    "armed must mean the extension confirmed it, never that the server intends it",
  );
  assert.equal(back.armedReportedAt, null);
});

test("counters do not survive — they described a process that is gone", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  r.recordFired(w.watchId, 123);
  r.recordFired(w.watchId, 456);
  const back = fromPersisted(toPersisted(w));
  assert.equal(back.firedCount, 0);
  assert.equal(back.lastFiredAt, null);
});

test("a buffer-sink watch survives, but its queue does not — and it is flagged", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ sink: { kind: "buffer" } }), "worker");
  const plan = planRehydration([toPersisted(w)], Date.now());
  const kept = plan.rehydrate.find((x) => x.watchId === w.watchId);
  assert.ok(kept);
  assert.equal(
    plan.lostBuffers.includes(w.watchId),
    true,
    "a caller must be told the queue is empty rather than infer it",
  );
});

test("a watch whose ttl elapsed while the server was down is DROPPED, with a reason", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ options: { ttlMs: 1000 } }), "worker");
  const p = toPersisted(w);
  const plan = planRehydration([p], p.createdAt + 5000);
  assert.equal(plan.rehydrate.length, 0);
  assert.equal(plan.drop[0]?.reason, "ttl");
});

test("a watch still inside its ttl is kept", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ options: { ttlMs: 60_000 } }), "worker");
  const p = toPersisted(w);
  const plan = planRehydration([p], p.createdAt + 1000);
  assert.equal(plan.rehydrate.length, 1);
});

test("⛔ a page-home watch records the URL it was armed against", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ source: "dom.mutation", config: { selector: "#x" } }), "page");
  const p = toPersisted({ ...w, armedAgainstUrl: "https://example.com/a" } as any);
  assert.equal(p.armedAgainstUrl, "https://example.com/a");
});

test("⛔ a page-home watch is NOT rehydrated blind — it needs its URL verified", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ source: "dom.mutation" }), "page");
  const p = { ...toPersisted(w), armedAgainstUrl: "https://example.com/a" };
  const plan = planRehydration([p], Date.now());
  const item = plan.rehydrate.find((x) => x.watchId === w.watchId);
  assert.ok(item, "it is a candidate…");
  assert.equal(item?.requiresUrl, "https://example.com/a", "…but conditional on the document");
});

test("a worker-home watch needs no URL check — it is bound to a tab, not a document", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  const plan = planRehydration([toPersisted(w)], Date.now());
  assert.equal(plan.rehydrate[0].requiresUrl, undefined);
});

test("a once-watch that already fired is not resurrected", () => {
  const r = new WatchRegistry();
  const w = r.create(spec({ options: { once: true } }), "worker");
  const p = { ...toPersisted(w), firedBeforeShutdown: true };
  const plan = planRehydration([p], Date.now());
  assert.equal(plan.rehydrate.length, 0);
  assert.equal(plan.drop[0]?.reason, "once");
});

test("malformed persisted rows are dropped, not thrown on", () => {
  const plan = planRehydration(
    [{ watchId: "ok", source: "chrome.tabs.onCreated", extensionId: "e", home: "worker", createdAt: Date.now(), sink: { kind: "buffer" } } as any,
     { nonsense: true } as any,
     null as any],
    Date.now(),
  );
  assert.equal(plan.rehydrate.length, 1, "one good row survives");
  assert.equal(plan.malformed, 2, "and the bad ones are COUNTED, not silently skipped");
});
