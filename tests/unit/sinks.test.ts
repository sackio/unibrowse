import { test } from "node:test";
import assert from "node:assert/strict";
import { createSinkDispatcher } from "../../src/watch/sinks.ts";
import { WatchBuffer } from "../../src/watch/buffer.ts";
import type { SinkSpec, WatchEvent, WatchRecord } from "../../src/watch/types.ts";

const rec = (sink: SinkSpec, agent: string | undefined = "unibrowse"): WatchRecord => ({
  watchId: "w1",
  source: "cdp.Network.eventSourceMessageReceived",
  sink,
  agent,
  extensionId: "ext_a",
  tabId: 1,
  home: "worker",
  createdAt: 0,
  firedCount: 0,
  droppedCount: 0,
  lastFiredAt: null,
  armedReportedByExtension: true,
  armedReportedAt: 0,
});

const ev: WatchEvent = { watchId: "w1", source: "s", firedAt: 1, payload: { hello: "world" } };

const okFetch = async () => ({ ok: true, status: 201, text: async () => "" });

test("atc sink defaults `to` to the CALLING AGENT", async () => {
  const calls: any[] = [];
  const d = createSinkDispatcher({
    fetchImpl: async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 201, text: async () => "" };
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }), ev);
  assert.equal(calls[0].url, "http://broker:3030/messages");
  assert.equal(calls[0].body.to, "unibrowse");
});

test("an explicit `to` overrides the calling agent", async () => {
  const calls: any[] = [];
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => {
      calls.push(JSON.parse(i.body));
      return { ok: true, status: 201, text: async () => "" };
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc", to: "someone-else" }), ev);
  assert.equal(calls[0].to, "someone-else");
});

test("atc payload carries the three fields the broker requires", async () => {
  let body: any;
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => {
      body = JSON.parse(i.body);
      return { ok: true, status: 201, text: async () => "" };
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }), ev);
  for (const k of ["to", "from", "content"]) {
    assert.ok(body[k], `${k} is required or the broker 400s`);
  }
});

test("an atc sink with no agent and no `to` FAILS LOUDLY, it does not guess", async () => {
  const d = createSinkDispatcher({
    fetchImpl: okFetch,
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  // NB: `rec(sink, undefined)` would hit the default parameter and still set
  // an agent, so the record is built and then the field is removed.
  const r = await d.deliver({ ...rec({ kind: "atc" }), agent: undefined }, ev);
  assert.equal(r.ok, false);
  assert.match(r.detail ?? "", /agent/i);
});

test("the atc content names the source and the watch", async () => {
  let body: any;
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => {
      body = JSON.parse(i.body);
      return { ok: true, status: 201, text: async () => "" };
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }), ev);
  assert.match(body.content, /eventSourceMessageReceived/);
  assert.match(body.content, /w1/);
});

test("webhook sink posts to the given url with its headers", async () => {
  let seen: any;
  const d = createSinkDispatcher({
    fetchImpl: async (url: string, init: any) => {
      seen = { url, init };
      return { ok: true, status: 200, text: async () => "" };
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  await d.deliver(
    rec({ kind: "webhook", url: "https://x.test/hook", headers: { "X-Token": "t" } }),
    ev,
  );
  assert.equal(seen.url, "https://x.test/hook");
  assert.equal(seen.init.headers["X-Token"], "t");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
});

test("buffer sink never makes an outbound request", async () => {
  const buf = new WatchBuffer();
  let called = false;
  const d = createSinkDispatcher({
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, text: async () => "" };
    },
    buffer: buf,
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "buffer" }), ev);
  assert.equal(called, false);
  assert.equal((await buf.poll("w1", 10)).matched, true);
});

test("a non-2xx response is reported as failure, not swallowed", async () => {
  const d = createSinkDispatcher({
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }),
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  const r = await d.deliver(rec({ kind: "atc" }), ev);
  assert.equal(r.ok, false);
  assert.match(r.detail ?? "", /500/);
});

test("a thrown fetch is reported as failure rather than escaping", async () => {
  const d = createSinkDispatcher({
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  const r = await d.deliver(rec({ kind: "atc" }), ev);
  assert.equal(r.ok, false);
  assert.match(r.detail ?? "", /ECONNREFUSED/);
});

test("a breaker event still delivers — the watch announces its own death", async () => {
  let body: any;
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => {
      body = JSON.parse(i.body);
      return { ok: true, status: 201, text: async () => "" };
    },
    buffer: new WatchBuffer(),
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }), {
    ...ev,
    breakerTripped: { reason: "exceeded cap", firedInWindow: 300, cap: 30 },
  });
  assert.match(body.content, /disarm/i);
  assert.equal(body.priority, "warning", "a breaker trip is not routine info");
});

test("a breaker event reaches the buffer sink too", async () => {
  const buf = new WatchBuffer();
  const d = createSinkDispatcher({
    fetchImpl: okFetch,
    buffer: buf,
    atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "buffer" }), {
    ...ev,
    breakerTripped: { reason: "exceeded cap", firedInWindow: 300, cap: 30 },
  });
  const r = await buf.poll("w1", 10);
  assert.ok(r.events?.[0].breakerTripped, "a poller must also learn the watch died");
});
