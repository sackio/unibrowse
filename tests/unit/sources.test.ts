import { test } from "node:test";
import assert from "node:assert/strict";
import { getSource, validateSourceId, SOURCES } from "../../src/watch/sources.ts";

test("every source declares a home and a predicate arg shape", () => {
  assert.ok(SOURCES.length > 0);
  for (const s of SOURCES) {
    assert.ok(["worker", "page", "server"].includes(s.home), `${s.id} home`);
    assert.ok(s.predicateArg, `${s.id} must document its predicate arg`);
    assert.ok(s.description, `${s.id} description`);
  }
});

test("SSE source is present and worker-home — the chat use case", () => {
  const s = getSource("cdp.Network.eventSourceMessageReceived");
  assert.equal(s?.home, "worker");
});

test("no Phase 1 source needs a manifest permission change", () => {
  for (const s of SOURCES) assert.notEqual(s.permission as string, "NEEDS_PERM");
});

test("excluded sources are absent, not merely undocumented", () => {
  assert.equal(getSource("cdp.Fetch.requestPaused"), undefined);
  assert.equal(getSource("chrome.idle.onStateChanged"), undefined);
});

test("validateSourceId names the near miss instead of a bare failure", () => {
  const r = validateSourceId("cdp.Network.eventSourceMessage");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /eventSourceMessageReceived/);
});

test("validateSourceId accepts a real id", () => {
  const r = validateSourceId("chrome.webNavigation.onCommitted");
  assert.equal(r.ok, true);
});

test("source ids are unique", () => {
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
});

test("tier 4 unibrowse sources exist — the multi-agent tier", () => {
  const takeover = getSource("unibrowse.tab.takeover");
  assert.ok(takeover, "an agent must be able to learn another agent took its tab");
  assert.equal(takeover?.scope, "browser");
});
