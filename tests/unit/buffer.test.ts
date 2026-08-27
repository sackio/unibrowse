import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchBuffer } from "../../src/watch/buffer.ts";
import type { WatchEvent } from "../../src/watch/types.ts";

const ev = (n: number): WatchEvent => ({
  watchId: "w1",
  source: "s",
  firedAt: n,
  payload: { n },
});

test("an event already buffered returns immediately", async () => {
  const b = new WatchBuffer();
  b.push("w1", ev(1));
  const r = await b.poll("w1", 50);
  assert.equal(r.matched, true);
  assert.equal(r.events?.length, 1);
});

test("a waiter is woken by a later push", async () => {
  const b = new WatchBuffer();
  const p = b.poll("w1", 1000);
  setTimeout(() => b.push("w1", ev(2)), 10);
  assert.equal((await p).matched, true);
});

test("poll times out cleanly with matched false", async () => {
  const b = new WatchBuffer();
  assert.equal((await b.poll("w1", 30)).matched, false);
});

test("a late event stays buffered for the NEXT poll rather than vanishing", async () => {
  const b = new WatchBuffer();
  const r = await b.poll("w1", 20);
  assert.equal(r.matched, false);
  b.push("w1", ev(3));
  assert.equal((await b.poll("w1", 20)).matched, true);
});

test("poll drains the whole queue, not one event at a time", async () => {
  const b = new WatchBuffer();
  b.push("w1", ev(1));
  b.push("w1", ev(2));
  const r = await b.poll("w1", 10);
  assert.equal(r.events?.length, 2);
  assert.equal((await b.poll("w1", 10)).matched, false, "the queue is now empty");
});

test("the buffer is bounded and drops OLDEST first", async () => {
  const b = new WatchBuffer(2);
  b.push("w1", ev(1));
  b.push("w1", ev(2));
  b.push("w1", ev(3));
  const r = await b.poll("w1", 10);
  assert.deepEqual(r.events?.map((e) => e.firedAt), [2, 3]);
});

test("drop clears the queue and fails pending waiters as unmatched", async () => {
  const b = new WatchBuffer();
  const p = b.poll("w1", 1000);
  b.drop("w1");
  assert.equal((await p).matched, false);
});

test("watches do not see each other's events", async () => {
  const b = new WatchBuffer();
  b.push("w1", ev(1));
  assert.equal((await b.poll("w2", 10)).matched, false);
});

test("a timed-out waiter is removed and cannot be resolved later", async () => {
  const b = new WatchBuffer();
  await b.poll("w1", 20);
  b.push("w1", ev(9));
  // If the dead waiter were still queued, this push would resolve it and the
  // event would be consumed by nobody — a silently swallowed notification.
  assert.equal((await b.poll("w1", 10)).events?.length, 1);
});

test("a per-watch capacity overrides the default", async () => {
  const b = new WatchBuffer(100);
  b.setCapacity("w1", 2);
  b.push("w1", ev(1));
  b.push("w1", ev(2));
  b.push("w1", ev(3));
  const r = await b.poll("w1", 10);
  assert.deepEqual(r.events?.map((e) => e.firedAt), [2, 3], "oldest dropped at the per-watch cap");
});

test("a watch without its own capacity still uses the default", async () => {
  const b = new WatchBuffer(2);
  b.setCapacity("w1", 5);
  b.push("w2", ev(1));
  b.push("w2", ev(2));
  b.push("w2", ev(3));
  const r = await b.poll("w2", 10);
  assert.equal(r.events?.length, 2, "w2 is unaffected by w1's capacity");
});

test("dropping a watch forgets its capacity", async () => {
  const b = new WatchBuffer(100);
  b.setCapacity("w1", 1);
  b.drop("w1");
  b.push("w1", ev(1));
  b.push("w1", ev(2));
  const r = await b.poll("w1", 10);
  assert.equal(r.events?.length, 2, "capacity must not outlive the watch it belonged to");
});
