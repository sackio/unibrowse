import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── ATTACH STARTS A RECORDING, SO DETACH MUST STOP IT ────────────────────────
 *
 * `_maybeAutoCapture()` starts a session recording whenever a tab is attached.
 * Nothing ever stopped one. `detachTab()` released the reservation, announced
 * TAB_DETACHED and detached CDP — and never touched `sessionRecordings`.
 *
 * ⛔ REPORTED BY BEN, MEASURED 2026-09-14 on :9010: office's desktop Chrome held
 * **13 live recordings against 0 attached tabs**. Every one was an orphan whose
 * tab had been attached and detached hours earlier. Stopping them uploaded
 * 231 MB of buffered events — 152 MB in a single 7-hour session. The sidecar
 * chromium held two more, the oldest running 4.4 days.
 *
 * ⚠️ WHY IT SURVIVED SO LONG: nothing reports it. A leaked recorder produces no
 * error, no failed call and no wrong answer — only a tab overlay saying
 * "Recording" that nobody is looking at, and a number in
 * browser_get_session_recording_state that nobody had reason to read. It was
 * found by a human noticing the count, which is not a mechanism we can rely on.
 *
 * ⭐ THE CLASS, worth more than the instance: the start half and the stop half
 * lived in DIFFERENT OBJECTS. `_maybeAutoCapture` is on BackgroundController
 * (it owns the recordings); `detachTab` is on TabManager (it owns the tabs),
 * and TabManager had no way to reach a recording. An asymmetry that spans two
 * objects has no single file where its absence looks wrong.
 *
 * ⇒ So these tests check BOTH halves: that the stop logic is correct (executed,
 * below), and that detach actually REACHES it (source, at the end). Either one
 * alone passes happily while the leak continues.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const bgSrc = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * Extract the real `_maybeAutoStopCapture` body and run it against a fake
 * controller. ⛔ Do NOT reimplement the logic here — a copy drifts from the
 * original and then guards the copy.
 */
function loadAutoStop() {
  const m = /async _maybeAutoStopCapture\(tabId\) \{([\s\S]*?)\n  \}/.exec(bgSrc);
  assert.ok(m, "_maybeAutoStopCapture not found in extension/background.js — renamed, or deleted?");
  const fn = new Function("tabId", "console", `return (async () => {${m[1]}})();`);
  return (ctx, id, cons) => fn.call(ctx, id, cons);
}

/** A controller with one live recording and a recording-aware stop. */
function fakeController(recording) {
  const stopCalls = [];
  return {
    stopCalls,
    stopResult: { success: true },
    recordingForTab(tabId) {
      return recording && recording.tabIds.includes(tabId) ? recording : null;
    },
    handleStopSessionRecording(sendResponse, params) {
      stopCalls.push(params);
      sendResponse(this.stopResult);
    },
  };
}

const quietConsole = { log() {}, warn() {}, error() {} };

test("detaching a tab stops the recording its attach started", async () => {
  const rec = { sessionId: "sr-1", tabId: 7, tabIds: [7], autoStarted: true };
  const ctx = fakeController(rec);
  await loadAutoStop()(ctx, 7, quietConsole);

  assert.equal(
    ctx.stopCalls.length,
    1,
    "the auto-started recording was left running after its tab detached — this is the leak itself",
  );
  assert.equal(ctx.stopCalls[0].sessionId, "sr-1", "must name the session, never stop 'the' recording");
  assert.equal(
    ctx.stopCalls[0].openReview,
    false,
    "a review tab opening by itself on a person's desktop every time an agent finishes with a tab is a worse bug than the leak",
  );
});

test("an explicitly started recording survives a detach", async () => {
  // ⛔ Detaching is not a request to stop recording. Someone asked for this
  // one; ending it here destroys evidence silently, in a function they did
  // not call.
  const rec = { sessionId: "sr-2", tabId: 7, tabIds: [7], autoStarted: false };
  const ctx = fakeController(rec);
  await loadAutoStop()(ctx, 7, quietConsole);
  assert.equal(ctx.stopCalls.length, 0, "an explicit recording must outlive the debugger attachment");
});

test("a child tab leaving does not end its opener's session", async () => {
  // A popup or oauth hop joins the flow that spawned it. Its detach must not
  // stop the flow — only the PRIMARY tab's does.
  const rec = { sessionId: "sr-3", tabId: 7, tabIds: [7, 9], autoStarted: true };
  const ctx = fakeController(rec);
  await loadAutoStop()(ctx, 9, quietConsole);
  assert.equal(ctx.stopCalls.length, 0, "the child tab's detach ended the whole recording");
});

test("detaching a tab with no recording is a no-op", async () => {
  const ctx = fakeController(null);
  await loadAutoStop()(ctx, 7, quietConsole);
  assert.equal(ctx.stopCalls.length, 0);
});

test("a failing stop cannot break the detach", async () => {
  // ⚠️ TWO failure shapes, and only one of them is a throw.
  const rec = { sessionId: "sr-4", tabId: 7, tabIds: [7], autoStarted: true };

  const thrower = fakeController(rec);
  thrower.handleStopSessionRecording = () => {
    throw new Error("upload exploded");
  };
  await loadAutoStop()(thrower, 7, quietConsole);

  // handleStopSessionRecording reports failure by CALLING BACK with
  // {success:false}, never by throwing — so a try/catch alone would log a
  // silent failure as a success.
  const warnings = [];
  const refuser = fakeController(rec);
  refuser.stopResult = { success: false, error: "no live recording" };
  await loadAutoStop()(refuser, 7, { log() {}, warn: (m) => warnings.push(String(m)), error() {} });
  assert.equal(warnings.length, 1, "a stop that failed by returning must still be reported");
  assert.match(warnings[0], /did not save/);
});

/* ── The other half: detach must actually REACH the stop ─────────────────────
 *
 * Every test above passes with the hook unwired, because they call the function
 * directly. That is precisely the gap the bug lived in.
 */

test("detachTab invokes the detach hook", () => {
  const m = /async detachTab\(tabId\) \{([\s\S]*?)\n  \}/.exec(bgSrc);
  assert.ok(m, "detachTab not found in extension/background.js");
  const body = codeOnly(m[1]);
  assert.match(
    body,
    /this\.onTabDetached\(tabId\)/,
    "detachTab tears down the debugger without telling anyone the tab is going — which is how a recorder outlives its tab",
  );
  assert.match(
    body,
    /await this\.onTabDetached/,
    "the hook must be awaited: the stop pipeline reaches the tab for overlay teardown and reads its per-tab server binding, both of which need the tab still attached",
  );
});

test("the controller wires the detach hook to the auto-stop", () => {
  const code = codeOnly(bgSrc);
  assert.match(
    code,
    /this\.tabManager\.onTabDetached\s*=/,
    "TabManager cannot reach the recordings by itself — without this line the hook is never set and detachTab's call is a no-op",
  );
  assert.match(code, /_maybeAutoStopCapture\(tabId\)/);
});

/* ── Stopping a large recording must not report a false failure ──────────────
 *
 * ⛔ MEASURED 2026-09-14: stopping a 4.4-day recording (12,547 rrweb events,
 * 4,364 network entries, 2,515 pages) raised "Handler timeout" at the dispatcher's
 * default 30s — and saved successfully anyway, status `complete`, every event
 * landed. The guard is a bare Promise.race, and a JS promise cannot be cancelled,
 * so it stops WAITING without stopping the work.
 *
 * ⚠️ The damage is in the retry, not the wait. handleStopSessionRecording deletes
 * the recording from sessionRecordings BEFORE uploading, so a caller acting on
 * the false failure retries and gets "No live recording with sessionId …" —
 * indistinguishable from data loss, for data that is already saved.
 *
 * ⚠️ This now matters MORE, not less: after the auto-stop above, detaching a tab
 * is what triggers the stop, so the slowest stops happen on a path nobody is
 * watching the return value of.
 */

test("browser_stop_session_recording gets a window matched to its buffer", () => {
  const m = /const HANDLER_TIMEOUTS_MS = \{([\s\S]*?)\n      \};/.exec(bgSrc);
  assert.ok(m, "HANDLER_TIMEOUTS_MS not found in extension/background.js");
  const map = codeOnly(m[1]);
  assert.match(
    map,
    /browser_stop_session_recording:\s*180000/,
    "a recording's stop time scales with its buffer and has no 30s bound — on the default it reports a false failure for an upload that succeeded, and the retry that follows looks like data loss",
  );
});
