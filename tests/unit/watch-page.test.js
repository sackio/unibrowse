import { test } from "node:test";
import assert from "node:assert/strict";
import "../../extension/watch-flood.js";
import "../../extension/watch-prefilter.js";
import "../../extension/watch-engine.js";
import "../../extension/watch-page.js";

const { createWatchEngine, buildPageWatchSource, PAGE_BINDINGS } = globalThis;

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
    _fire: (name, ...args) => (listeners[name] || []).forEach((fn) => fn(...args)),
    storage: { session: { set: async (o) => Object.assign(store, o), get: async () => store } },
    webNavigation: { onCommitted: evt("webNavigation.onCommitted") },
    tabs: { onRemoved: evt("tabs.onRemoved"), onUpdated: evt("tabs.onUpdated") },
  };
}

const engine = (over = {}) => {
  const chrome = over.chrome || chromeStub();
  const sent = [];
  const injected = [];
  const e = createWatchEngine({
    chrome,
    sendToServer: (m) => sent.push(m),
    now: () => 0,
    injectPageWatch: async (spec) => {
      injected.push(spec);
      return true;
    },
    ...over,
  });
  return { e, chrome, sent, injected };
};

const pageSpec = (over = {}) => ({
  watchId: "p1",
  source: "dom.mutation",
  extensionId: "ext_a",
  tabId: 5,
  predicate: "(e) => true",
  ...over,
});

test("page-home sources are declared with their own bindings", () => {
  assert.ok(PAGE_BINDINGS["dom.mutation"]);
  assert.ok(PAGE_BINDINGS["dom.elementText"]);
  assert.ok(PAGE_BINDINGS["page.event"]);
});

test("arming a page-home watch injects into the page rather than binding a chrome listener", async () => {
  const { e, injected } = engine();
  await e.arm(pageSpec());
  assert.equal(injected.length, 1);
  assert.equal(injected[0].watchId, "p1");
  assert.equal(injected[0].tabId, 5);
});

test("a page-home watch requires a tabId — there is no browser-wide DOM", async () => {
  const { e } = engine();
  await assert.rejects(() => e.arm(pageSpec({ tabId: null })), /tab/i);
});

test("feedMatch delivers WITHOUT re-running the predicate", async () => {
  // The page already evaluated it; re-running in the worker is impossible
  // anyway — MV3's CSP forbids evaluating a string as JS there.
  const { e, sent } = engine();
  await e.arm(pageSpec({ predicate: "(e) => e.definitely.not.here" }));
  e.feedMatch("p1", { text: "hello" });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload.payload, { text: "hello" });
});

test("feedMatch on an unknown watch is a no-op, not a throw", () => {
  const { e, sent } = engine();
  e.feedMatch("nope", {});
  assert.equal(sent.length, 0);
});

test("feedMatch still honours once", async () => {
  const { e, sent } = engine();
  await e.arm(pageSpec({ options: { once: true } }));
  e.feedMatch("p1", { n: 1 });
  e.feedMatch("p1", { n: 2 });
  assert.equal(sent.length, 1);
  assert.equal(e.list().length, 0);
});

test("feedMatch still honours the rate cap and the breaker", async () => {
  const { e, sent } = engine();
  await e.arm(pageSpec({ options: { maxPerMin: 1 } }));
  for (let i = 0; i < 40; i++) e.feedMatch("p1", { i });
  assert.ok(sent.find((m) => m.payload?.breakerTripped), "breaker must announce itself here too");
  assert.equal(e.list().length, 0);
});

test("a page watch is re-injected when its tab navigates", async () => {
  const { e, chrome, injected } = engine();
  await e.arm(pageSpec());
  assert.equal(injected.length, 1);
  chrome._fire("webNavigation.onCommitted", { tabId: 5, frameId: 0, url: "https://x/next" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(injected.length, 2, "the content script died with the old document");
});

test("a navigation in a DIFFERENT tab does not re-inject", async () => {
  const { e, chrome, injected } = engine();
  await e.arm(pageSpec());
  chrome._fire("webNavigation.onCommitted", { tabId: 99, frameId: 0, url: "https://x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(injected.length, 1);
});

test("a sub-frame navigation does not re-inject the top-frame watch", async () => {
  const { e, chrome, injected } = engine();
  await e.arm(pageSpec());
  chrome._fire("webNavigation.onCommitted", { tabId: 5, frameId: 3, url: "https://ad" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(injected.length, 1);
});

test("disarming a page watch stops re-injection", async () => {
  const { e, chrome, injected } = engine();
  await e.arm(pageSpec());
  await e.disarm("p1");
  chrome._fire("webNavigation.onCommitted", { tabId: 5, frameId: 0, url: "https://x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(injected.length, 1);
});

test("buildPageWatchSource produces a self-contained injectable string", () => {
  const src = buildPageWatchSource({
    watchId: "p1",
    source: "dom.mutation",
    predicate: "(e) => true",
    config: { selector: "#chat" },
  });
  assert.equal(typeof src, "string");
  assert.ok(src.includes("p1"));
  assert.ok(src.includes("MutationObserver"), "dom.mutation must actually observe");
  assert.ok(!src.includes("import "), "must not need module resolution in the page");
});

test("the injected source carries the predicate so it runs IN the page", () => {
  const src = buildPageWatchSource({
    watchId: "p1",
    source: "dom.elementText",
    predicate: "(e) => e.text.includes('done')",
    config: { selector: "#status" },
  });
  assert.ok(src.includes("done"), "the predicate travels with the injection");
});

test("an injection that fails leaves the watch un-armed rather than silently dead", async () => {
  const { e } = engine({ injectPageWatch: async () => false });
  await assert.rejects(() => e.arm(pageSpec()), /inject/i);
});
