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

/**
 * ── Handle shares ────────────────────────────────────────────────────────
 *
 * A tab share is not a copy. Everything below guards one of the two ways a
 * recipient can be given a handle that looks usable and is not:
 *
 *   · they address the tab by a binding (tabId / extensionId) that goes stale
 *     without announcement, and drive the wrong tab or nothing at all; or
 *   · they treat a shared tab as handed over, and reserve, detach or close a
 *     tab the sender is still working in.
 *
 * Neither produces an error at the time. Both produce a message the recipient
 * read and acted on correctly given what it said — so the envelope's WORDING
 * is the mechanism, and that is what these assert.
 */

const TAB = {
  kind: "tab" as const,
  to: "shopping",
  label: "amazon.com-2",
  url: "https://www.amazon.com/gp/cart",
  title: "Cart",
  tabId: 1980049709,
  extensionId: "ext_6dfaf2e9",
  extensionLabel: "container chromium (sidecar) · Linux",
};

test("a tab share tells the recipient to address the tab by its LABEL", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send(TAB);
  assert.equal(r.ok, true);
  const posted = calls.find((c) => c.url.endsWith("/messages"))!.body;
  assert.match(posted.content, /tabTarget: "amazon\.com-2"/);
  assert.match(posted.subject, /shared tab "amazon\.com-2"/);
});

test("⛔ a tab share warns OFF tabId and extensionId by name", async () => {
  // Printing them without the warning is worse than omitting them: they work
  // on the first call, so the recipient learns the wrong habit and the failure
  // lands later, on someone else's page.
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  await send(TAB);
  const c = calls.find((x) => x.url.endsWith("/messages"))!.body.content;
  assert.match(c, /Not by tabId \(1980049709\)/);
  assert.match(c, /extensionId \(ext_6dfaf2e9\)/);
  assert.match(c, /bindings, not identity/);
});

test("⛔ a tab share says SHARED, not handed over — no reserve, no close", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  await send(TAB);
  const c = calls.find((x) => x.url.endsWith("/messages"))!.body.content;
  assert.match(c, /SHARED, NOT HANDED OVER/);
  assert.match(c, /do not call browser_reserve_tab/);
  assert.match(c, /do not close it/);
});

test("a tab with no label is refused before it reaches the broker", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...TAB, label: "   " });
  assert.equal(r.ok, false);
  assert.match(r.detail!, /no label/);
  assert.equal(
    calls.some((c) => c.url.endsWith("/messages")),
    false,
    "a handle with no handle must not be delivered",
  );
});

test("a handle share is never parked, however the sender is configured", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl, selfBaseUrl: "http://mcp-server:9010" });
  const r = await send(TAB);
  assert.equal(r.parkedUrl, undefined);
  const c = calls.find((x) => x.url.endsWith("/messages"))!.body.content;
  assert.doesNotMatch(c, /too large to send inline/);
});

test("a tab share still validates the recipient", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ ...TAB, to: "shoppng" });
  assert.equal(r.ok, false);
  assert.match(r.detail!, /not a registered ATC subscriber/);
  assert.equal(calls.some((c) => c.url.endsWith("/messages")), false);
});

test("a recording share carries the id and the call that fetches it", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({
    kind: "recording",
    to: "ha",
    recordingId: "rec-68b5",
    title: "Session: tektory.com @ 10:14",
    startUrl: "https://tektory.com/",
    durationMs: 221_000,
    reviewUrl: "http://mcp-server:9010/review/rec-68b5",
  });
  assert.equal(r.ok, true);
  const c = calls.find((x) => x.url.endsWith("/messages"))!.body.content;
  assert.match(c, /browser_get_recording\(\{ recordingId: "rec-68b5" \}\)/);
  assert.match(c, /review\/rec-68b5/);
  assert.match(c, /3m 41s/, "duration must be readable, not a millisecond count");
});

test("a recording share with no id is refused before the network", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl });
  const r = await send({ kind: "recording", to: "ha", recordingId: "" });
  assert.equal(r.ok, false);
  assert.equal(calls.some((c) => c.url.endsWith("/messages")), false);
});

test("⛔ a handle share still fails on sent:0 — same silent drop as content", async () => {
  const { impl } = stubFetch({
    messages: { ok: true, json: async () => ({ sent: 0, drop_reason: "no_resolution" }) },
  });
  const send = createSender({ fetchImpl: impl });
  const r = await send(TAB);
  assert.equal(r.ok, false);
  assert.match(r.detail!, /delivered it to nobody/);
});

test("⛔ the replay link is built from selfBaseUrl, not from whatever the caller had", async () => {
  // The extension only knows the URL IT uses to reach the server — localhost
  // on the host browser, the compose service name in a sidecar. Both deliver
  // a message containing a link no recipient can open, with no error.
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl, selfBaseUrl: "http://192.168.1.199:9010" });
  await send({ kind: "recording", to: "ha", recordingId: "rec-1", title: "T" });
  const c = calls.find((x) => x.url.endsWith("/messages"))!.body.content;
  assert.match(c, /http:\/\/192\.168\.1\.199:9010\/review\/rec-1/);
  assert.doesNotMatch(c, /localhost/);
  assert.doesNotMatch(c, /mcp-server:9010/);
});

test("an explicit reviewUrl is respected — the derivation is a fallback", async () => {
  const { impl, calls } = stubFetch({ messages: { ok: true, json: async () => ({ sent: 1 }) } });
  const send = createSender({ fetchImpl: impl, selfBaseUrl: "http://192.168.1.199:9010" });
  await send({
    kind: "recording", to: "ha", recordingId: "rec-1",
    reviewUrl: "https://unibrowse.example.com/review/rec-1",
  });
  const c = calls.find((x) => x.url.endsWith("/messages"))!.body.content;
  assert.match(c, /unibrowse\.example\.com/);
});
