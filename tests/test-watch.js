#!/usr/bin/env node
/**
 * Watch — live integration test.
 *
 * Runs against a RUNNING mcp-server with at least one extension connected and
 * at least one attached tab. Calls the real MCP endpoint, so it exercises the
 * whole path: tool → registry → WS → extension engine → predicate → WATCH_FIRED
 * → sink.
 *
 *   node tests/test-watch.js
 *
 * ⛔ The most important case here is the NEGATIVE one (test 4): a predicate
 * that can never match must produce zero deliveries. Layer 1 of flood control
 * is the claim that non-matches never cross the WebSocket, and a suite that
 * only ever asserts "the thing fired" would pass just as happily if the
 * predicate were ignored entirely.
 */

const SERVER = process.env.UNIBROWSE_SERVER || "http://localhost:9010";
const AGENT = process.env.WATCH_TEST_AGENT || "unibrowse";

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Call an MCP tool and return its text content. */
async function call(name, args = {}) {
  const res = await fetch(`${SERVER}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const raw = await res.text();
  // The endpoint answers as SSE; pull the single data: line out.
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  if (!line) throw new Error(`No data line in response: ${raw.slice(0, 300)}`);
  const parsed = JSON.parse(line.slice(6));
  if (parsed.error) throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
  const content = parsed.result?.content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull a watchId out of a browser_watch_create response. */
function watchIdOf(text) {
  const m = text.match(/\*\*watchId\*\*:\s*`([^`]+)`/);
  return m ? m[1] : null;
}

async function main() {
  console.log(`Watch integration test against ${SERVER}\n`);

  // ── Preconditions ────────────────────────────────────────────────────────
  console.log("Preconditions:");
  const exts = await (await fetch(`${SERVER}/extensions`)).json();
  const connected = exts.connected ?? [];
  ok("at least one extension is connected", connected.length > 0);
  const withTabs = connected.find((e) => (e.tabCount ?? 0) > 0);
  ok("at least one extension has an attached tab", !!withTabs);
  if (!withTabs) {
    console.log("\nCannot continue without an attached tab.");
    process.exit(1);
  }
  const extensionId = withTabs.extensionId;
  const tabsText = await call("browser_list_attached_tabs", {});
  const tabId = JSON.parse(tabsText).tabs.find((t) => t.tabId)?.tabId;
  ok("resolved a tabId to watch", !!tabId, String(tabId));
  console.log(`  using extension ${extensionId.slice(0, 16)}…, tab ${tabId}\n`);

  const created = [];

  try {
    // ── 1. The catalogue ──────────────────────────────────────────────────
    console.log("1. browser_watch_sources:");
    const sources = await call("browser_watch_sources", {});
    ok("returns sources", sources.includes("Watch sources"));
    ok("documents a predicate shape for each", (sources.match(/predicate: `/g) ?? []).length > 20);
    ok("includes the SSE source (the chat case)", sources.includes("eventSourceMessageReceived"));
    ok("excludes Fetch.requestPaused", !sources.includes("Fetch.requestPaused"));
    const filtered = await call("browser_watch_sources", { filter: "downloads" });
    ok("filter narrows the list", filtered.includes("downloads") && !filtered.includes("eventSourceMessage"));

    // ── 2. A typo names its near miss ─────────────────────────────────────
    console.log("\n2. Unknown source handling:");
    const typo = await call("browser_watch_create", {
      source: "cdp.Network.eventSourceMessage",
      agent: AGENT,
    });
    ok("a mistyped source is rejected", typo.toLowerCase().includes("unknown watch source"));
    ok("and the near miss is named", typo.includes("eventSourceMessageReceived"));

    // ── 3. Arm, match, deliver to a buffer ────────────────────────────────
    console.log("\n3. Arm → navigate → deliver (buffer sink):");
    const marker = `watchtest${Date.now()}`;
    const armed = await call("browser_watch_create", {
      source: "chrome.webNavigation.onCommitted",
      predicate: `(e) => e.url.includes('${marker}')`,
      sink: { kind: "buffer" },
      tabTarget: tabId,
      extensionId,
      agent: AGENT,
    });
    const wid = watchIdOf(armed);
    ok("watch armed", !!wid, armed.slice(0, 200));
    if (wid) created.push(wid);

    if (wid) {
      // Navigate to a URL containing the marker so the predicate matches.
      void call("browser_navigate", {
        url: `https://example.com/?${marker}`,
        tabTarget: tabId,
        extensionId,
      }).catch(() => {});

      const polled = await call("browser_watch_poll", { watchId: wid, timeoutMs: 20000 });
      ok("the matching navigation was delivered", polled.includes("event(s) from"), polled.slice(0, 200));
      ok("the payload carries the marker", polled.includes(marker));
    }

    // ── 4. THE NEGATIVE: a non-matching predicate delivers nothing ─────────
    console.log("\n4. Non-matching predicate stays silent (flood-control layer 1):");
    const quiet = await call("browser_watch_create", {
      source: "chrome.webNavigation.onCommitted",
      predicate: `(e) => e.url.includes('this-string-will-never-appear-${Date.now()}')`,
      sink: { kind: "buffer" },
      tabTarget: tabId,
      extensionId,
      agent: AGENT,
    });
    const quietId = watchIdOf(quiet);
    ok("quiet watch armed", !!quietId);
    if (quietId) {
      created.push(quietId);
      void call("browser_navigate", {
        url: `https://example.com/?noise${Date.now()}`,
        tabTarget: tabId,
        extensionId,
      }).catch(() => {});
      await sleep(4000);
      const quietPoll = await call("browser_watch_poll", { watchId: quietId, timeoutMs: 2000 });
      ok("nothing was delivered", quietPoll.includes("No events"), quietPoll.slice(0, 160));
      const listed = await call("browser_watch_list", { agent: AGENT });
      const block = listed.split("**`").find((b) => b.startsWith(quietId));
      ok("and firedCount stayed 0", !!block && /fired: 0/.test(block), block?.slice(0, 140));
    }

    // ── 5. armed is the extension's answer, not the server's belief ────────
    console.log("\n5. browser_watch_list reports the extension's raw answer:");
    const list = await call("browser_watch_list", { agent: AGENT, refresh: true });
    ok("lists the watches", list.includes("# Watches"));
    ok("states whose answer `armed` is", list.includes("extension's own last answer"));
    ok("armed is true after a refresh", /armed \(per extension\): true/.test(list));

    // ── 6. ATC sink defaults to the calling agent ─────────────────────────
    console.log("\n6. ATC sink → the calling agent's own session:");
    const atcMarker = `atcwatch${Date.now()}`;
    const atcArmed = await call("browser_watch_create", {
      source: "chrome.webNavigation.onCommitted",
      predicate: `(e) => e.url.includes('${atcMarker}')`,
      sink: { kind: "atc", subject: "watch integration test" },
      tabTarget: tabId,
      extensionId,
      agent: AGENT,
      options: { once: true },
    });
    const atcId = watchIdOf(atcArmed);
    ok("atc watch armed", !!atcId, atcArmed.slice(0, 200));
    ok("and it names the calling agent as the recipient", atcArmed.includes(`→ ${AGENT}`));
    if (atcId) {
      created.push(atcId);
      void call("browser_navigate", {
        url: `https://example.com/?${atcMarker}`,
        tabTarget: tabId,
        extensionId,
      }).catch(() => {});
      await sleep(6000);
      console.log(`     (a DM to \`${AGENT}\` should have arrived — verify in your inbox)`);
    }

    // ── 7. An atc sink with nowhere to go is refused at CREATE time ───────
    console.log("\n7. A sink with no recipient fails at create, not at fire:");
    const nowhere = await call("browser_watch_create", {
      source: "chrome.webNavigation.onCommitted",
      sink: { kind: "atc" },
      tabTarget: tabId,
      extensionId,
    });
    ok("refused", nowhere.toLowerCase().includes("nowhere to deliver"), nowhere.slice(0, 160));

    // ── 8. Delete ─────────────────────────────────────────────────────────
    console.log("\n8. Delete:");
    if (wid) {
      const del = await call("browser_watch_delete", { watchId: wid });
      ok("deleted", del.includes("Deleted watch"));
      const after = await call("browser_watch_list", { agent: AGENT });
      ok("no longer listed", !after.includes(wid));
      created.splice(created.indexOf(wid), 1);
    }
    const ghost = await call("browser_watch_delete", { watchId: "w-does-not-exist" });
    ok("deleting an unknown watch says so", ghost.includes("No watch with id"));

    // ── 9. Poll rejects a non-buffer sink ─────────────────────────────────
    console.log("\n9. Polling a push sink is refused with an explanation:");
    if (atcId) {
      const bad = await call("browser_watch_poll", { watchId: atcId, timeoutMs: 1000 });
      ok(
        "explains that only buffer sinks are pollable",
        bad.includes("buffer") || bad.includes("No watch with id"),
        bad.slice(0, 160),
      );
    }
  } finally {
    // Clean up anything still armed, so a failed run does not leave watches
    // firing against a shared server.
    for (const id of created) {
      try {
        await call("browser_watch_delete", { watchId: id });
      } catch {
        /* best-effort */
      }
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log(
    "\n⚠️ NOT covered here: true MV3 service-worker eviction. Chrome gives no\n" +
      "reliable way to force it, and chrome.runtime.reload() is a stronger event\n" +
      "(it also drops the socket), so it would not prove the re-arm path. The\n" +
      "rearmAll and persistedSpecs logic is covered by tests/unit/watch-engine.test.js\n" +
      "instead. Do not read a green run here as evidence that eviction recovery works.",
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\n✗ Fatal:", e.message);
  process.exit(1);
});
