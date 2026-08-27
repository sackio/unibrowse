import { test } from "node:test";
import assert from "node:assert/strict";
import "../../extension/watch-flood.js";
import "../../extension/watch-engine.js";

// Classic scripts — loaded for side-effect, published on globalThis.
const { createWatchEngine, compilePredicate } = globalThis;

/** Minimal chrome stub: records listeners so a test can fire them by hand. */
function chromeStub() {
  const store = {};
  const listeners = {};
  const evt = (name) => ({
    addListener: (fn) => {
      (listeners[name] ||= []).push(fn);
    },
    removeListener: (fn) => {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
    },
  });
  return {
    _store: store,
    _listeners: listeners,
    _fire: (name, ...args) => (listeners[name] || []).forEach((fn) => fn(...args)),
    storage: {
      session: {
        set: async (o) => Object.assign(store, o),
        get: async (k) => (k ? { [k]: store[k] } : store),
      },
    },
    webNavigation: { onCommitted: evt("webNavigation.onCommitted") },
    tabs: { onRemoved: evt("tabs.onRemoved"), onUpdated: evt("tabs.onUpdated") },
    downloads: { onChanged: evt("downloads.onChanged") },
  };
}

const engine = (over = {}) => {
  const chrome = over.chrome || chromeStub();
  const sent = [];
  const e = createWatchEngine({
    chrome,
    sendToServer: (m) => sent.push(m),
    now: () => 0,
    ...over,
  });
  return { e, chrome, sent };
};

const navSpec = (over = {}) => ({
  watchId: "w1",
  source: "chrome.webNavigation.onCommitted",
  extensionId: "ext_a",
  ...over,
});

test("a predicate compiles and filters", () => {
  const p = compilePredicate("(e) => e.data.includes('DONE')");
  assert.equal(p({ data: "xx DONE" }), true);
  assert.equal(p({ data: "nope" }), false);
});

test("a syntactically invalid predicate is rejected at ARM time, not fire time", () => {
  assert.throws(() => compilePredicate("(e) => {{{"), /predicate/i);
});

test("a predicate that throws at runtime does NOT fire and does not kill the watch", () => {
  const p = compilePredicate("(e) => e.missing.deep");
  assert.equal(p({}), false);
});

test("a predicate returning a truthy non-boolean still fires", () => {
  const p = compilePredicate("(e) => e.url");
  assert.equal(p({ url: "https://x" }), true);
});

test("an omitted predicate fires on every event", () => {
  assert.equal(compilePredicate(undefined)({ anything: 1 }), true);
});

test("arm rejects an unknown source rather than silently doing nothing", async () => {
  const { e } = engine();
  await assert.rejects(
    () => e.arm(navSpec({ source: "chrome.nope.onNope" })),
    /source/i,
  );
});

test("arm persists the spec so a worker restart can re-arm", async () => {
  const { e, chrome } = engine();
  await e.arm(navSpec());
  assert.ok(
    JSON.stringify(chrome._store).includes("w1"),
    "spec must be persisted to chrome.storage.session",
  );
});

test("disarm removes the spec from persistence too", async () => {
  const { e, chrome } = engine();
  await e.arm(navSpec());
  await e.disarm("w1");
  assert.ok(!JSON.stringify(chrome._store).includes("w1"));
});

test("list reports armed as ACTUAL binding state", async () => {
  const { e } = engine();
  await e.arm(navSpec());
  assert.equal(e.list().find((w) => w.watchId === "w1").armed, true);
  await e.disarm("w1");
  assert.equal(e.list().find((w) => w.watchId === "w1"), undefined);
});

test("a matching event sends WATCH_FIRED to the server", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ predicate: "(ev) => ev.url.includes('target')" }));
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x/target", frameId: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "WATCH_FIRED");
  assert.equal(sent[0].payload.watchId, "w1");
});

test("a NON-matching event sends nothing — layer 1 of flood control", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ predicate: "(ev) => ev.url.includes('target')" }));
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x/other", frameId: 0 });
  assert.equal(sent.length, 0, "non-matches must never cross the WebSocket");
});

test("a tab-scoped watch ignores other tabs' events", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ tabId: 7 }));
  chrome._fire("webNavigation.onCommitted", { tabId: 9, url: "https://x", frameId: 0 });
  assert.equal(sent.length, 0);
  chrome._fire("webNavigation.onCommitted", { tabId: 7, url: "https://x", frameId: 0 });
  assert.equal(sent.length, 1);
});

test("two watches on one source both receive the event", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ watchId: "a" }));
  await e.arm(navSpec({ watchId: "b" }));
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x", frameId: 0 });
  assert.equal(sent.length, 2);
});

test("disarming one watch leaves the other bound to the shared listener", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ watchId: "a" }));
  await e.arm(navSpec({ watchId: "b" }));
  await e.disarm("a");
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x", frameId: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.watchId, "b");
});

test("once:true disarms after the first fire", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ options: { once: true } }));
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x", frameId: 0 });
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x", frameId: 0 });
  assert.equal(sent.length, 1);
  assert.equal(e.list().length, 0);
});

test("rearmAll restores every spec the server re-pushes", async () => {
  const { e } = engine();
  await e.rearmAll([navSpec({ watchId: "a" }), navSpec({ watchId: "b" })]);
  assert.equal(e.list().length, 2);
});

test("rearmAll is idempotent — re-pushing the same specs does not double-bind", async () => {
  const { e, chrome, sent } = engine();
  await e.rearmAll([navSpec({ watchId: "a" })]);
  await e.rearmAll([navSpec({ watchId: "a" })]);
  chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x", frameId: 0 });
  assert.equal(sent.length, 1, "a re-push must not produce duplicate deliveries");
});

test("rearmAll drops watches the server no longer knows about", async () => {
  const { e } = engine();
  await e.rearmAll([navSpec({ watchId: "a" }), navSpec({ watchId: "b" })]);
  await e.rearmAll([navSpec({ watchId: "a" })]);
  assert.equal(e.list().length, 1, "the server registry is authoritative");
});

test("persistedSpecs round-trips through storage for a worker restart", async () => {
  const { e, chrome } = engine();
  await e.arm(navSpec({ predicate: "(ev) => true" }));
  const revived = engine({ chrome });
  const specs = await revived.e.persistedSpecs();
  assert.equal(specs.length, 1);
  assert.equal(specs[0].watchId, "w1");
});

test("the breaker notice is SENT, not just logged", async () => {
  const { e, chrome, sent } = engine();
  await e.arm(navSpec({ options: { maxPerMin: 1 } }));
  for (let i = 0; i < 40; i++) {
    chrome._fire("webNavigation.onCommitted", { tabId: 1, url: "https://x", frameId: 0 });
  }
  const breaker = sent.find((m) => m.payload?.breakerTripped);
  assert.ok(breaker, "the watch must announce its own death");
  assert.equal(e.list().length, 0, "and actually be disarmed");
});
