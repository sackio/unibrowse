import { test } from "node:test";
import assert from "node:assert/strict";
import { createFloodGate } from "../../extension/watch-flood.js";

const clock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
};

test("with no limits configured every event delivers immediately", () => {
  const c = clock();
  const gate = createFloodGate({ now: c.now });
  assert.equal(gate.offer({ n: 1 }).action, "deliver");
  assert.equal(gate.offer({ n: 2 }).action, "deliver");
});

test("coalesce mode last holds events and flush yields only the newest", () => {
  const c = clock();
  const gate = createFloodGate({ coalesce: { windowMs: 1000, mode: "last" }, now: c.now });
  assert.equal(gate.offer({ n: 1 }).action, "hold");
  assert.equal(gate.offer({ n: 2 }).action, "hold");
  c.advance(1001);
  assert.deepEqual(gate.flush(), [{ n: 2 }]);
});

test("coalesce mode batch yields every held event in arrival order", () => {
  const c = clock();
  const gate = createFloodGate({ coalesce: { windowMs: 1000, mode: "batch" }, now: c.now });
  gate.offer({ n: 1 });
  gate.offer({ n: 2 });
  c.advance(1001);
  assert.deepEqual(gate.flush(), [{ n: 1 }, { n: 2 }]);
});

test("coalesce mode count summarises rather than forwarding payloads", () => {
  const c = clock();
  const gate = createFloodGate({ coalesce: { windowMs: 1000, mode: "count" }, now: c.now });
  gate.offer({ n: 1 });
  gate.offer({ n: 2 });
  gate.offer({ n: 3 });
  c.advance(1001);
  const out = gate.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 3);
});

test("flush before the window elapses yields nothing", () => {
  const c = clock();
  const gate = createFloodGate({ coalesce: { windowMs: 1000, mode: "batch" }, now: c.now });
  gate.offer({ n: 1 });
  c.advance(500);
  assert.deepEqual(gate.flush(), []);
});

test("rate cap drops beyond maxPerMin inside the window", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 2, now: c.now });
  assert.equal(gate.offer({}).action, "deliver");
  assert.equal(gate.offer({}).action, "deliver");
  assert.equal(gate.offer({}).action, "drop");
});

test("the rate window slides — a later minute delivers again", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 2, now: c.now });
  gate.offer({});
  gate.offer({});
  gate.offer({});
  c.advance(60_001);
  assert.equal(gate.offer({}).action, "deliver");
});

test("the breaker trips at 10x the cap and ANNOUNCES ITSELF", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 2, now: c.now });
  let tripped = null;
  for (let i = 0; i < 25; i++) {
    const r = gate.offer({});
    if (r.breaker) tripped = r.breaker;
  }
  assert.ok(tripped, "breaker must surface a payload, not just stop delivering");
  assert.equal(tripped.cap, 2);
  assert.match(tripped.reason, /cap/i);
});

test("a tripped breaker reports itself exactly once", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 1, now: c.now });
  let count = 0;
  for (let i = 0; i < 50; i++) if (gate.offer({}).breaker) count++;
  assert.equal(count, 1);
});

test("after the breaker trips nothing further is delivered", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 1, now: c.now });
  for (let i = 0; i < 50; i++) gate.offer({});
  c.advance(120_000);
  assert.equal(gate.offer({}).action, "drop", "a broken gate stays broken");
  assert.equal(gate.state().broken, true);
});

test("droppedCount is observable, so silence is explainable after the fact", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 1, now: c.now });
  gate.offer({});
  gate.offer({});
  gate.offer({});
  assert.ok(gate.state().dropped >= 2);
});

test("coalesce and rate cap compose — held events still count against the cap", () => {
  const c = clock();
  const gate = createFloodGate({
    maxPerMin: 2,
    coalesce: { windowMs: 100, mode: "batch" },
    now: c.now,
  });
  assert.equal(gate.offer({ n: 1 }).action, "hold");
  assert.equal(gate.offer({ n: 2 }).action, "hold");
  assert.equal(gate.offer({ n: 3 }).action, "drop", "cap applies before coalescing");
});
