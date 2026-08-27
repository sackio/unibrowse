# Watch Implementation Plan — Phase 1 (worker-home spine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent arm a watch on a browser event source with an arbitrary JS predicate, and have matching events pushed to ATC (into the calling agent's own session), an arbitrary webhook, or a server-side buffer — instead of polling.

**Architecture:** The predicate runs in the extension service worker where the event already is, so non-matching events never cross the WebSocket. Matches travel to mcp-server as an unsolicited `WATCH_FIRED` message on the existing socket. The server owns the authoritative registry and every sink, so the extension never holds a credential or makes an outbound call.

**Tech Stack:** TypeScript (server, bundled by tsup), plain JS (MV3 extension), `node --test --experimental-strip-types` for unit tests (built into Node 22.19 — **no new dependencies**), MongoDB only if a later phase needs persistence (Phase 1 does not).

**Spec:** `docs/WATCH_DESIGN.md`

## Scope of this plan

The spec covers two separable subsystems. This plan is **Phase 1: worker-home watching** — Tiers 1, 2 and 4 (CDP events, `chrome.*` events, unibrowse's own events), the registry, all three sinks, flood control, and the fail-quiet fix. It delivers Ben's stated requirement in full: a chat tab watched via SSE, pushed into the calling agent's ATC session.

**Phase 2 (`docs/WATCH_PLAN_PAGE.md`, written after Phase 1 lands)** is Tier 3: content-script infrastructure, `MutationObserver`, in-page events, and re-injection on navigation. It is a different execution home with a different predicate sandbox, and it is not required for the approved use case.

## Global Constraints

- ⛔ **`mcp-server` on `:9010` is shared LAN-wide.** Heads-up to ATC zone `sessions` and **wait for acknowledgement** before `docker compose restart mcp-server`.
- ⛔ **Ben: COMMIT, do not push.**
- ⛔ **No new npm dependencies.** Unit tests use `node --test --experimental-strip-types`, built into Node 22.19.0.
- ⛔ **No `manifest.json` permission changes in Phase 1.** A permission change forces a pool-wide extension *re-install*, not a reload. Every Phase 1 source is already granted.
- ⛔ **Nothing may weaken the `203.0.113.1` / `UNIBROWSE_TRUSTED_PROXIES` classification** (memo `33ff3f8b`). Both fail toward OPEN, silently.
- ⛔ **`browser_watch_list` must report `armed` as the extension's raw answer**, never the server's belief, and must never repair on read. This is the `isActive` rule from memo `9fb367c0`.
- **`tsup` does not typecheck.** Baseline `npm run typecheck` error count is **375** (measured 2026-08-27). It must not rise.
- **Unit tests must not import via the `@/` alias at runtime.** Node's type-stripping does not resolve tsconfig paths. `import type` is fine — it is erased.
- ATC broker is the **literal** `http://192.168.1.168:3030`. `$ATC_URL` is unset in several execution contexts and its failure reads exactly like "nothing armed".

---

## File Structure

**Server (TypeScript):**

| file | responsibility |
|---|---|
| `src/watch/types.ts` | Shared types: `WatchSpec`, `WatchRecord`, `SinkSpec`, `SourceDescriptor`, `WatchEvent`. Types only, no logic. |
| `src/watch/sources.ts` | The source catalogue — id → home, permission, predicate-arg shape, cost, description. Pure data + lookup/validation. |
| `src/watch/registry.ts` | Authoritative registry. Create/get/list/delete, cascade delete by tab and by extension, TTL expiry. Pure logic, no I/O. |
| `src/watch/buffer.ts` | The `buffer` sink: bounded queue plus long-poll waiters. Generalises `observeNavigations.first()`. |
| `src/watch/sinks.ts` | Sink dispatch — `atc` \| `webhook` \| `buffer`. The only place that makes outbound HTTP. Takes an injected `fetch` so it is testable. |
| `src/tools/watch.ts` | The five MCP tools. |

**Extension (plain JS):**

| file | responsibility |
|---|---|
| `extension/watch-flood.js` | Pure flood control: coalescer, rate cap, circuit breaker. No Chrome APIs, so directly unit-testable. |
| `extension/watch-engine.js` | Worker-home engine: arm/disarm, source binding, predicate compilation, persistence to `chrome.storage.session`, re-arm on wake. |

**Modified:**

| file | change |
|---|---|
| `src/types/messaging.ts` | Add `browser_watch_arm` / `_disarm` / `_list` to `SocketMessageMap`. |
| `src/server.ts` | Handle unsolicited `WATCH_FIRED`; re-push watches on `EXTENSION_REGISTER`. |
| `src/http-server.ts` | Register the watch tools. |
| `extension/background.js` | Register watch handlers; instantiate the engine; re-announce watches on socket connect. |
| `package.json` | Add `"test:unit": "node --test --experimental-strip-types tests/unit/"`. |

---

## Task 1: Source catalogue

**Files:**
- Create: `src/watch/types.ts`, `src/watch/sources.ts`
- Test: `tests/unit/sources.test.ts`

**Interfaces:**
- Produces: `SOURCES: SourceDescriptor[]`, `getSource(id: string): SourceDescriptor | undefined`, `validateSourceId(id: string): {ok: true, source: SourceDescriptor} | {ok: false, error: string}`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sources.test.ts
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
  for (const s of SOURCES) assert.notEqual(s.permission, "NEEDS_PERM");
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

test("source ids are unique", () => {
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test --experimental-strip-types tests/unit/sources.test.ts`
Expected: FAIL — cannot find module `../../src/watch/sources.ts`.

- [ ] **Step 3: Write `src/watch/types.ts`**

```ts
export type WatchHome = "worker" | "page" | "server";

export interface SourceDescriptor {
  id: string;                    // "cdp.Network.eventSourceMessageReceived"
  home: WatchHome;
  permission: "FREE" | "GRANTED";  // NEEDS_PERM is excluded from Phase 1
  /** The exact shape the predicate is handed. Callers read this, not the docs. */
  predicateArg: string;
  /** Rough event volume, so a caller can see a firehose before arming one. */
  cost: "low" | "medium" | "high";
  description: string;
  /** Whether this source is scoped to a tab or is browser-wide. */
  scope: "tab" | "browser";
}

export type SinkSpec =
  | { kind: "atc"; to?: string; subject?: string; priority?: "info" | "warning" | "critical" }
  | { kind: "webhook"; url: string; headers?: Record<string, string> }
  | { kind: "buffer"; maxBuffered?: number };

export interface CoalesceSpec {
  windowMs: number;
  mode: "last" | "batch" | "count";
}

export interface WatchOptions {
  once?: boolean;
  ttlMs?: number;
  coalesce?: CoalesceSpec;
  maxPerMin?: number;
}

export interface WatchSpec {
  source: string;
  predicate?: string;
  sink: SinkSpec;
  options?: WatchOptions;
  tabId?: number | null;
  extensionId: string;
  agent?: string;
}

export interface WatchRecord extends WatchSpec {
  watchId: string;
  home: WatchHome;
  createdAt: number;
  firedCount: number;
  droppedCount: number;
  lastFiredAt: number | null;
  /** Last raw answer from the extension. NEVER inferred from server state. */
  armedReportedByExtension: boolean | null;
  armedReportedAt: number | null;
}

export interface WatchEvent {
  watchId: string;
  source: string;
  firedAt: number;
  payload: unknown;
  /** Set when the circuit breaker killed the watch. Always delivered. */
  breakerTripped?: { reason: string; firedInWindow: number; cap: number };
}
```

- [ ] **Step 4: Write `src/watch/sources.ts`**

Full catalogue from the spec's Tier 1, 2 and 4 tables. Every entry sets `predicateArg` to the real shape — e.g. `"(e: {data: string, eventName: string, eventId: string}) => boolean"` for the SSE source, `"(e: {tabId: number, url: string, transitionType: string}) => boolean"` for `webNavigation.onCommitted`. `validateSourceId` computes a Levenshtein-ish nearest match over `SOURCES.map(s => s.id)` and names it in the error, because a mistyped source that returns a bare "unknown source" is a silent no-op waiting to happen.

Exclude `cdp.Fetch.requestPaused` and `chrome.idle.onStateChanged` entirely — absent, not disabled.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test --experimental-strip-types tests/unit/sources.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 6: Add the test script and commit**

```bash
# package.json: "test:unit": "node --test --experimental-strip-types tests/unit/"
git add src/watch/types.ts src/watch/sources.ts tests/unit/sources.test.ts package.json
git commit -m "feat(watch): source catalogue that documents its own predicate shapes"
```

---

## Task 2: Flood control (pure, extension-side)

**Files:**
- Create: `extension/watch-flood.js`
- Test: `tests/unit/watch-flood.test.js`

**Interfaces:**
- Produces: `createFloodGate({maxPerMin, coalesce, now})` returning `{ offer(event) -> {action: "deliver"|"hold"|"drop", events?, breaker?}, flush() -> events[], state() }`
- Consumes: nothing. No Chrome APIs — that is what makes it testable.

**Why this is its own task:** it is the layer that stops a chatty source from hurting ATC, and it is pure arithmetic over a clock. Testing it against a live browser would be slow and flaky; testing it with an injected `now` is exact.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/watch-flood.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFloodGate } from "../../extension/watch-flood.js";

const clock = (start = 0) => { let t = start; return { now: () => t, advance: (ms) => (t += ms) }; };

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
  gate.offer({ n: 1 }); gate.offer({ n: 2 });
  c.advance(1001);
  assert.deepEqual(gate.flush(), [{ n: 1 }, { n: 2 }]);
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
  gate.offer({}); gate.offer({}); gate.offer({});
  c.advance(60_001);
  assert.equal(gate.offer({}).action, "deliver");
});

test("the breaker trips at 10x the cap and ANNOUNCES ITSELF", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 2, now: c.now });
  let tripped = null;
  for (let i = 0; i < 25; i++) { const r = gate.offer({}); if (r.breaker) tripped = r.breaker; }
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

test("droppedCount is observable, so silence is explainable after the fact", () => {
  const c = clock();
  const gate = createFloodGate({ maxPerMin: 1, now: c.now });
  gate.offer({}); gate.offer({}); gate.offer({});
  assert.ok(gate.state().dropped >= 2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/unit/watch-flood.test.js`
Expected: FAIL — cannot find `../../extension/watch-flood.js`.

- [ ] **Step 3: Implement `extension/watch-flood.js`**

A sliding-window counter over `now()`, a coalesce buffer keyed by mode, and a breaker at `10 × maxPerMin` within one window that latches (`brokenReported` flag) so it announces exactly once. `offer()` returns `{action, breaker?}`; `flush()` drains per mode; `state()` exposes `{delivered, dropped, broken}`.

- [ ] **Step 4: Run and confirm all 8 pass**

Run: `node --test tests/unit/watch-flood.test.js`

- [ ] **Step 5: Commit**

```bash
git add extension/watch-flood.js tests/unit/watch-flood.test.js
git commit -m "feat(watch): flood control with a breaker that announces its own death"
```

---

## Task 3: Registry

**Files:**
- Create: `src/watch/registry.ts`
- Test: `tests/unit/registry.test.ts`

**Interfaces:**
- Produces: `class WatchRegistry` with `create(spec, home): WatchRecord`, `get(id)`, `list(filter?)`, `delete(id): boolean`, `deleteByTab(extensionId, tabId): string[]`, `deleteByExtension(extensionId): string[]`, `expire(now): string[]`, `recordFired(id, at)`, `recordArmed(id, armed, at)`, `specsFor(extensionId): WatchRecord[]`
- Consumes: `WatchSpec`, `WatchRecord` from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchRegistry } from "../../src/watch/registry.ts";

const spec = (over = {}) => ({
  source: "cdp.Network.eventSourceMessageReceived",
  sink: { kind: "atc" as const },
  extensionId: "ext_a",
  tabId: 1,
  agent: "unibrowse",
  ...over,
});

test("create returns a stable unique id and echoes the home", () => {
  const r = new WatchRegistry();
  const a = r.create(spec(), "worker");
  const b = r.create(spec(), "worker");
  assert.notEqual(a.watchId, b.watchId);
  assert.equal(a.home, "worker");
});

test("a new watch has NO armed claim — null, not true", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  assert.equal(w.armedReportedByExtension, null,
    "the server must not assert armed before the extension has said so");
});

test("recordArmed stores the extension's raw answer including false", () => {
  const r = new WatchRegistry();
  const w = r.create(spec(), "worker");
  r.recordArmed(w.watchId, false, 123);
  assert.equal(r.get(w.watchId)?.armedReportedByExtension, false);
});

test("deleting a tab cascades only that tab's watches", () => {
  const r = new WatchRegistry();
  const keep = r.create(spec({ tabId: 2 }), "worker");
  r.create(spec({ tabId: 1 }), "worker");
  const removed = r.deleteByTab("ext_a", 1);
  assert.equal(removed.length, 1);
  assert.ok(r.get(keep.watchId));
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
  assert.equal(r.expire(Date.now() + 500).length, 0);
  assert.equal(r.expire(Date.now() + 2000).length, 1);
  assert.equal(r.get(w.watchId), undefined);
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
```

- [ ] **Step 2: Run and confirm failure.** Run: `node --test --experimental-strip-types tests/unit/registry.test.ts`

- [ ] **Step 3: Implement.** A `Map<string, WatchRecord>` plus two secondary indexes (`byExtension`, `byExtensionTab`) kept in sync on create/delete. `create` sets `armedReportedByExtension: null`. Ids are `w-${Date.now().toString(36)}-${counter}` — no `Math.random`, so tests are deterministic.

- [ ] **Step 4: Run and confirm 8/8 pass.**

- [ ] **Step 5: Commit**

```bash
git add src/watch/registry.ts tests/unit/registry.test.ts
git commit -m "feat(watch): registry that never asserts armed on the extension's behalf"
```

---

## Task 4: Buffer sink and long-poll

**Files:**
- Create: `src/watch/buffer.ts`
- Test: `tests/unit/buffer.test.ts`

**Interfaces:**
- Produces: `class WatchBuffer` with `push(watchId, event)`, `poll(watchId, timeoutMs): Promise<{matched: boolean, events?: WatchEvent[]}>`, `drop(watchId)`
- Consumes: `WatchEvent` from Task 1.

**Why:** this is `observeNavigations.first()` generalised. It stays because "block until X happens" is the right shape when an agent is actively waiting. It must behave identically to the primitive it replaces: a match already buffered returns immediately.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/buffer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchBuffer } from "../../src/watch/buffer.ts";

const ev = (n: number) => ({ watchId: "w1", source: "s", firedAt: n, payload: { n } });

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

test("a timed-out waiter cannot be resolved afterwards", async () => {
  const b = new WatchBuffer();
  const r = await b.poll("w1", 20);
  assert.equal(r.matched, false);
  b.push("w1", ev(3));
  assert.equal((await b.poll("w1", 20)).matched, true,
    "the late event stays buffered for the NEXT poll rather than vanishing");
});

test("the buffer is bounded and drops OLDEST first", async () => {
  const b = new WatchBuffer(2);
  b.push("w1", ev(1)); b.push("w1", ev(2)); b.push("w1", ev(3));
  const r = await b.poll("w1", 10);
  assert.deepEqual(r.events?.map((e) => e.firedAt), [2, 3]);
});

test("drop clears the queue and fails pending waiters as unmatched", async () => {
  const b = new WatchBuffer();
  const p = b.poll("w1", 1000);
  b.drop("w1");
  assert.equal((await p).matched, false);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** `Map<watchId, {queue, waiters}>`. `poll` drains the whole queue when non-empty; otherwise registers a waiter with a timer that splices itself out on fire — the same shape as `handleObserveNavFirst` in `background.js:4832`, which already gets this right.

- [ ] **Step 4: Run and confirm 6/6 pass.**

- [ ] **Step 5: Commit**

```bash
git add src/watch/buffer.ts tests/unit/buffer.test.ts
git commit -m "feat(watch): bounded buffer sink with long-poll, generalising observeNavigations.first"
```

---

## Task 5: Sink dispatch

**Files:**
- Create: `src/watch/sinks.ts`
- Test: `tests/unit/sinks.test.ts`

**Interfaces:**
- Produces: `createSinkDispatcher({fetchImpl, buffer, atcUrl})` returning `{ deliver(record: WatchRecord, event: WatchEvent): Promise<{ok: boolean, sink: string, detail?: string}> }`
- Consumes: `WatchBuffer` (Task 4), `WatchRecord`/`WatchEvent` (Task 1).

**Why `fetchImpl` is injected:** so the ATC contract is tested without messaging the live broker.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sinks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSinkDispatcher } from "../../src/watch/sinks.ts";
import { WatchBuffer } from "../../src/watch/buffer.ts";

const rec = (sink: any, agent = "unibrowse") => ({
  watchId: "w1", source: "cdp.Network.eventSourceMessageReceived", sink, agent,
  extensionId: "ext_a", tabId: 1, home: "worker" as const, createdAt: 0,
  firedCount: 0, droppedCount: 0, lastFiredAt: null,
  armedReportedByExtension: true, armedReportedAt: 0,
});
const ev = { watchId: "w1", source: "s", firedAt: 1, payload: { hello: "world" } };

test("atc sink defaults `to` to the CALLING AGENT", async () => {
  const calls: any[] = [];
  const d = createSinkDispatcher({
    fetchImpl: async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 201 }; },
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }) as any, ev);
  assert.equal(calls[0].url, "http://broker:3030/messages");
  assert.equal(calls[0].body.to, "unibrowse");
});

test("an explicit `to` overrides the calling agent", async () => {
  const calls: any[] = [];
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => { calls.push(JSON.parse(i.body)); return { ok: true, status: 201 }; },
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc", to: "someone-else" }) as any, ev);
  assert.equal(calls[0].to, "someone-else");
});

test("atc payload carries the three fields the broker requires", async () => {
  let body: any;
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => { body = JSON.parse(i.body); return { ok: true, status: 201 }; },
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }) as any, ev);
  for (const k of ["to", "from", "content"]) assert.ok(body[k], `${k} is required or the broker 400s`);
});

test("an atc sink with no agent and no `to` FAILS LOUDLY, it does not guess", async () => {
  const d = createSinkDispatcher({
    fetchImpl: async () => ({ ok: true, status: 201 }),
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  const r = await d.deliver({ ...rec({ kind: "atc" }), agent: undefined } as any, ev);
  assert.equal(r.ok, false);
  assert.match(r.detail ?? "", /agent/i);
});

test("webhook sink posts to the given url with its headers", async () => {
  let seen: any;
  const d = createSinkDispatcher({
    fetchImpl: async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 200 }; },
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "webhook", url: "https://x.test/hook", headers: { "X-Token": "t" } }) as any, ev);
  assert.equal(seen.url, "https://x.test/hook");
  assert.equal(seen.init.headers["X-Token"], "t");
});

test("buffer sink never makes an outbound request", async () => {
  const buf = new WatchBuffer();
  let called = false;
  const d = createSinkDispatcher({
    fetchImpl: async () => { called = true; return { ok: true, status: 200 }; },
    buffer: buf, atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "buffer" }) as any, ev);
  assert.equal(called, false);
  assert.equal((await buf.poll("w1", 10)).matched, true);
});

test("a non-2xx response is reported as failure, not swallowed", async () => {
  const d = createSinkDispatcher({
    fetchImpl: async () => ({ ok: false, status: 500 }),
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  assert.equal((await d.deliver(rec({ kind: "atc" }) as any, ev)).ok, false);
});

test("a breaker event still delivers — the watch announces its own death", async () => {
  let body: any;
  const d = createSinkDispatcher({
    fetchImpl: async (_u: string, i: any) => { body = JSON.parse(i.body); return { ok: true, status: 201 }; },
    buffer: new WatchBuffer(), atcUrl: "http://broker:3030",
  });
  await d.deliver(rec({ kind: "atc" }) as any,
    { ...ev, breakerTripped: { reason: "exceeded cap", firedInWindow: 300, cap: 30 } });
  assert.match(body.content, /breaker|disarm/i);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** `deliver()` switches on `sink.kind`. The `atc` branch resolves `to = sink.to ?? record.agent` and **returns `{ok:false}` naming the missing field rather than inventing a recipient** — a watch delivered to the wrong seat is worse than one that fails visibly. `content` is a compact human-readable summary plus the JSON payload; `subject` defaults to `` `watch ${source}` ``. A `breakerTripped` event prepends a clear "watch disarmed" line.

- [ ] **Step 4: Run and confirm 8/8 pass.**

- [ ] **Step 5: Commit**

```bash
git add src/watch/sinks.ts tests/unit/sinks.test.ts
git commit -m "feat(watch): sink dispatch — atc defaults to the calling agent, never guesses"
```

---

## Task 6: Extension watch engine

**Files:**
- Create: `extension/watch-engine.js`
- Modify: `extension/background.js` (handler registration near `background.js:2232`, where the nav-observer handlers already register)
- Test: `tests/unit/watch-engine.test.js` (pure parts, with Chrome APIs stubbed)

**Interfaces:**
- Consumes: `createFloodGate` (Task 2).
- Produces: `createWatchEngine({chrome, sendToServer, now})` returning `{ arm(spec), disarm(watchId), list(), rearmAll(specs), persistedSpecs() }`; and handlers `browser_watch_arm` / `browser_watch_disarm` / `browser_watch_list`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/watch-engine.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWatchEngine, compilePredicate } from "../../extension/watch-engine.js";

test("a predicate compiles and filters", () => {
  const p = compilePredicate("(e) => e.data.includes('DONE')");
  assert.equal(p({ data: "xx DONE" }), true);
  assert.equal(p({ data: "nope" }), false);
});

test("a syntactically invalid predicate is rejected at ARM time, not at fire time", () => {
  assert.throws(() => compilePredicate("(e) => {{{"), /predicate/i);
});

test("a predicate that throws at runtime does NOT fire and does not kill the watch", () => {
  const p = compilePredicate("(e) => e.missing.deep");
  assert.equal(p({}), false);
});

test("an omitted predicate fires on every event", () => {
  assert.equal(compilePredicate(undefined)({ anything: 1 }), true);
});

test("arm persists the spec so a worker restart can re-arm", async () => {
  const store = {};
  const chromeStub = {
    storage: { session: { set: async (o) => Object.assign(store, o), get: async () => store } },
    webNavigation: { onCommitted: { addListener() {} } },
  };
  const e = createWatchEngine({ chrome: chromeStub, sendToServer: () => {}, now: () => 0 });
  await e.arm({ watchId: "w1", source: "chrome.webNavigation.onCommitted", extensionId: "ext_a" });
  assert.ok(JSON.stringify(store).includes("w1"), "spec must be persisted to chrome.storage.session");
});

test("list reports armed as ACTUAL binding state", async () => {
  const chromeStub = {
    storage: { session: { set: async () => {}, get: async () => ({}) } },
    webNavigation: { onCommitted: { addListener() {} } },
  };
  const e = createWatchEngine({ chrome: chromeStub, sendToServer: () => {}, now: () => 0 });
  await e.arm({ watchId: "w1", source: "chrome.webNavigation.onCommitted", extensionId: "ext_a" });
  assert.equal(e.list().find((w) => w.watchId === "w1").armed, true);
  await e.disarm("w1");
  assert.equal(e.list().find((w) => w.watchId === "w1"), undefined);
});

test("rearmAll restores every spec the server re-pushes", async () => {
  const chromeStub = {
    storage: { session: { set: async () => {}, get: async () => ({}) } },
    webNavigation: { onCommitted: { addListener() {} } },
  };
  const e = createWatchEngine({ chrome: chromeStub, sendToServer: () => {}, now: () => 0 });
  await e.rearmAll([
    { watchId: "a", source: "chrome.webNavigation.onCommitted", extensionId: "ext_a" },
    { watchId: "b", source: "chrome.webNavigation.onCommitted", extensionId: "ext_a" },
  ]);
  assert.equal(e.list().length, 2);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement `extension/watch-engine.js`**

- `compilePredicate(src)` — `new Function("e", "return (" + src + ")(e)")` wrapped so a **throw at runtime returns `false`** (a broken predicate must not fire and must not kill the watch), while a **syntax error throws at arm time** so the caller learns immediately.
- Source binding: one shared listener per underlying source, fanned out to that source's subscribers — the same shape as `_navObserverListener` at `background.js:2219`, which already proves the pattern.
- Each watch owns a `createFloodGate` instance; on a match, `offer()` decides deliver / hold / drop; a `hold` schedules a `flush` via `setTimeout(windowMs)`.
- Delivery calls `sendToServer({type: "WATCH_FIRED", payload: {...}})`.
- Every `arm`/`disarm` writes the spec set to `chrome.storage.session`.

- [ ] **Step 4: Run and confirm 7/7 pass.**

- [ ] **Step 5: Wire into `background.js`** — instantiate the engine beside `navObservers`, register the three handlers, and call `rearmAll(persistedSpecs())` on service-worker init.

- [ ] **Step 6: Commit**

```bash
git add extension/watch-engine.js extension/background.js tests/unit/watch-engine.test.js
git commit -m "feat(watch): extension engine — predicate at the source, re-armable after eviction"
```

---

## Task 7: Server WS wiring

**Files:**
- Modify: `src/types/messaging.ts`, `src/server.ts` (near the `EXTENSION_REGISTER` handler at `server.ts:78` and `TAB_ATTACHED` at `server.ts:126`)

**Interfaces:**
- Consumes: `WatchRegistry` (Task 3), sink dispatcher (Task 5).
- Produces: handling for the unsolicited `WATCH_FIRED` message; watch re-push on `EXTENSION_REGISTER`; cascade delete on `TAB_DETACHED` and on socket close.

- [ ] **Step 1: Add the three message types to `SocketMessageMap`**

```ts
  // Watch — arm/disarm/list a push subscription in the extension.
  browser_watch_arm: { watchId: string; source: string; predicate?: string;
                       options?: Record<string, unknown>; tabTarget?: number | string };
  browser_watch_disarm: { watchId: string };
  browser_watch_list_armed: Record<string, never>;
```

- [ ] **Step 2: Handle `WATCH_FIRED` in `server.ts`**

Beside the existing `TAB_ATTACHED` branch. Look the watch up in the registry; if absent, **disarm it in the extension** (a watch firing that the server does not know about is drift, and the extension is the one holding the leak). Otherwise `recordFired` and hand to the sink dispatcher. Honour `options.once` by deleting after the first successful delivery.

- [ ] **Step 3: Re-push watches on `EXTENSION_REGISTER`**

In the same handler that already re-pulls tab ownership (`6e8a186`). For each `registry.specsFor(extensionId)`, send `browser_watch_arm`. Record the extension's answer with `recordArmed`. **This is the repair that fixes drift predating its own deploy** — the same property the tab-ownership re-pull has.

- [ ] **Step 4: Cascade deletes**

`TAB_DETACHED` → `deleteByTab`. Socket close → `deleteByExtension`. Both per the spec's lifetime rules.

- [ ] **Step 5: Verify the typecheck count has not risen**

Run: `npm run typecheck 2>&1 | grep -cE "error TS"`
Expected: **375 or fewer.** A rise means this task introduced a type error.

- [ ] **Step 6: Commit**

```bash
git add src/types/messaging.ts src/server.ts
git commit -m "feat(watch): WATCH_FIRED ingress and re-push on register"
```

---

## Task 8: MCP tools

**Files:**
- Create: `src/tools/watch.ts`
- Modify: `src/http-server.ts` (tool registration)

**Interfaces:**
- Produces: `browser_watch_create`, `browser_watch_list`, `browser_watch_delete`, `browser_watch_sources`, `browser_watch_poll`.
- Consumes: everything above.

- [ ] **Step 1: Implement the five tools** following the existing `Tool` shape in `src/tools/tool.ts` and the zod schema pattern used across `src/tools/*.ts`.

`browser_watch_create` validates the source via `validateSourceId` (so a typo names its near miss), compiles nothing server-side, creates the registry record, sends `browser_watch_arm` to the extension, records the raw armed answer, and returns `{watchId, source, home, armed}`.

⛔ `browser_watch_list` returns `armedReportedByExtension` **as stored**, plus `armedReportedAt`, and does **not** re-query or repair. A `null` renders as `"unknown — never reported"`, not as `true`.

- [ ] **Step 2: Register the tools in `src/http-server.ts`** alongside the existing tool arrays.

- [ ] **Step 3: Typecheck count unchanged**

Run: `npm run typecheck 2>&1 | grep -cE "error TS"` → **375 or fewer.**

- [ ] **Step 4: Build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/tools/watch.ts src/http-server.ts
git commit -m "feat(watch): the five browser_watch_* MCP tools"
```

---

## Task 9: Live integration test

**Files:**
- Create: `tests/test-watch.js` (following the existing `tests/test-*.js` style — a script against a live server)

- [ ] **Step 1: Deploy** — ⛔ **heads-up to ATC zone `sessions` and WAIT for acknowledgement**, then `docker compose restart mcp-server`. Reload the extension in the target browser.

- [ ] **Step 2: Write the integration script** covering, against a real attached tab:

1. `browser_watch_sources()` returns the catalogue and every entry has a `predicateArg`.
2. Arm `chrome.webNavigation.onCommitted` with a predicate matching a specific URL, sink `buffer`; navigate; `browser_watch_poll` returns the match.
3. **The negative:** arm a predicate that can never match, navigate, and assert `firedCount` stays 0 — proving non-matches do not cross the WS.
4. Arm with sink `atc` and no `to`; assert the message arrives addressed to the calling agent.
5. `browser_watch_delete`, then confirm `browser_watch_list` no longer lists it.
6. Detach the tab; confirm its watches are gone (cascade).
7. **Fail-quiet regression:** force the service worker to restart, confirm the watch re-arms, and confirm `browser_watch_list` reports `armed` from the extension rather than the server's row.

- [ ] **Step 3: Run it**

Run: `node tests/test-watch.js`

- [ ] **Step 4: Commit**

```bash
git add tests/test-watch.js
git commit -m "test(watch): live integration incl. the no-match negative and the eviction re-arm"
```

---

## Self-Review

**Spec coverage.** Registry, lifetime, three sinks, ATC-to-calling-agent, flood control's four layers, the fail-quiet's three parts, the source catalogue for Tiers 1/2/4, the security note, and the deployment constraint each map to a task. Tier 3 (page home) is deferred to Phase 2 by the scope decision at the top — it is the one spec section this plan does not implement, and it is named rather than dropped.

**Placeholders.** None. Every test step carries runnable code; every implementation step names the file, the shape, and the existing code it mirrors.

**Type consistency.** `WatchRecord.armedReportedByExtension` is the single name for the extension's raw answer across Tasks 1, 3, 7 and 8. `createFloodGate` returns `{action, breaker?}` in Tasks 2 and 6 alike. `WatchEvent.breakerTripped` is used identically in Tasks 1, 2, 5 and 6.

**One gap worth naming:** Task 9 step 7 needs a way to force MV3 service-worker eviction. `chrome.runtime.reload()` restarts the whole extension, which is a stronger event than eviction and would also drop the socket. If no reliable eviction trigger exists, the honest fallback is to test `rearmAll` directly (Task 6 already does) and record in the test file that true eviction was **not** exercised — rather than let a passing test imply coverage it does not have.
