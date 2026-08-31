import { test } from "node:test";
import assert from "node:assert/strict";
import { createSender, getParked, INLINE_CONTENT_LIMIT } from "../../src/tools/send-to-agent.ts";

/**
 * The failure this module exists to prevent is a send that LOOKS fine.
 * `ha` (scanfile, 2026-08-31): the broker ACCEPTS a message addressed to a
 * name that is not a subscriber and never delivers it, with no error — so a
 * typo is indistinguishable from an agent ignoring you. Every test below is
 * about making one of those silent outcomes loud.
 */

const DESTS = {
  ok: true,
  json: async () => ({ destinations: [{ id: "shopping" }, { id: "unibrowse" }, { id: "ha" }] }),
};

function stubFetch(handlers: Record<string, any>) {
  const calls: Array<{ url: string; body?: any }> = [];
  const impl = (async (url: string, init?: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith("/destinations")) return handlers.destinations ?? DESTS;
    if (url.endsWith("/messages")) return handlers.messages;
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const base = {
  url: "https://example.com/x",
  title: "X",
  content: "hello",
  format: "markdown" as const,
  scope: "page",
};

test("a recipient that is not a registered subscriber is REFUSED, not sent", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shoppng" }); // typo
  assert.equal(r.ok, false);
  assert.equal(r.sent, 0);
  assert.match(r.detail!, /not a registered ATC subscriber/);
  assert.equal(
    calls.some((c) => c.url.endsWith("/messages")),
    false,
    "it must not post a message it knows cannot be delivered",
  );
});

test("a near-miss recipient gets a suggestion — the typo is the likely cause", async () => {
  const { impl } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shoxxx" });
  assert.match(r.detail!, /Did you mean: shopping/);
});

test("a valid recipient is sent, and the envelope names unibrowse as the source", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shopping" });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 1);
  const posted = calls.find((c) => c.url.endsWith("/messages"))!.body;
  assert.equal(posted.to, "shopping");
  assert.match(posted.content, /This is from unibrowse/);
  assert.match(posted.content, /https:\/\/example\.com\/x/, "the url must travel with the content");
  assert.match(posted.content, /hello/);
});

test("⛔ sent:0 is a FAILURE — routing is not delivery", async () => {
  const { impl } = stubFetch({
    messages: { ok: true, json: async () => ({ sent: 0, drop_reason: "no_resolution" }) },
  });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shopping" });
  assert.equal(r.ok, false, "HTTP 201 with sent:0 must not read as success");
  assert.match(r.detail!, /delivered it to nobody/);
  assert.match(r.detail!, /no_resolution/);
});

test("content over the inline limit is parked and sent as a URL, not inlined", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl, selfBaseUrl: "http://mcp-server:9010" });
  const big = "x".repeat(INLINE_CONTENT_LIMIT + 1);
  const r = await send({ ...base, to: "shopping", content: big });
  assert.equal(r.ok, true);
  assert.ok(r.parkedUrl, "an oversized body must be parked");
  const posted = calls.find((c) => c.url.endsWith("/messages"))!.body;
  assert.ok(
    posted.content.length < 4000,
    `the message itself must stay small, got ${posted.content.length}`,
  );
  assert.match(posted.content, /too large to send inline/);
  const id = r.parkedUrl!.split("/").pop()!;
  assert.equal(getParked(id)?.body, big, "the parked body must be retrievable intact");
});

test("content at exactly the inline limit still goes inline", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl, selfBaseUrl: "http://mcp-server:9010" });
  const r = await send({ ...base, to: "shopping", content: "y".repeat(INLINE_CONTENT_LIMIT) });
  assert.equal(r.parkedUrl, undefined);
  assert.match(calls.find((c) => c.url.endsWith("/messages"))!.body.content, /yyy/);
});

test("⚠️ the inline limit leaves real headroom under the measured 1 MB cap", () => {
  // Measured 2026-08-31: broker accepted 512 KB, returned HTTP 413
  // "request body too large (limit 1mb)" at 1024 KB. JSON-escaping
  // quote-heavy HTML can nearly double the byte count, so the inline limit
  // must survive doubling and still clear the cap with room for the envelope.
  assert.ok(
    INLINE_CONTENT_LIMIT * 2 < 1024 * 1024 * 0.75,
    "inline limit must survive worst-case escaping well inside the 1MB cap",
  );
});

test("an empty recipient fails without touching the network", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "   " });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test("a broker HTTP error is reported with its status, not swallowed", async () => {
  const { impl } = stubFetch({
    messages: { ok: false, status: 413, text: async () => "request body too large (limit 1mb)" },
  });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shopping" });
  assert.equal(r.ok, false);
  assert.match(r.detail!, /413/);
  assert.match(r.detail!, /too large/);
});

test("if the destination check itself fails, the send still proceeds", async () => {
  // A validation outage must not block a send to a name that is probably fine.
  const { impl } = stubFetch({
    destinations: { ok: false, status: 502 },
    messages: { ok: true, json: async () => ({ sent: 1 }) },
  });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shopping" });
  assert.equal(r.ok, true, "a broker listing outage must not become a send outage");
});

test("an empty destinations list does not block every send", async () => {
  const { impl } = stubFetch({
    destinations: { ok: true, json: async () => ({ destinations: [] }) },
    messages: { ok: true, json: async () => ({ sent: 1 }) },
  });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...base, to: "shopping" });
  assert.equal(r.ok, true, "an empty list means 'unknown', not 'nobody exists'");
});
