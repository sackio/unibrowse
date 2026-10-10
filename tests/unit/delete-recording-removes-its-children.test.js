import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── DELETING A RECORDING MUST DELETE ITS EVENTS AND ANNOTATIONS ─────────────
 *
 * `browser_delete_recording` removed only the `recordings` row. Its
 * `recording_events` documents were left behind, and they are unreachable by
 * construction: the only index into them is a recordingId that no longer
 * resolves. Same for `recording_annotations`, which carry a base64 PNG each.
 *
 * ⛔ THE REAPER IS WHAT MADE IT COMPOUND. unibrowse-recording-reaper.py exists
 * to bound DB growth and deletes every unrequested auto-capture after 48h
 * THROUGH THIS HANDLER. So the mechanism meant to keep the collection small
 * was the one filling it with orphans — a tourniquet that leaked.
 *
 * MEASURED 2026-10-10 before the fix: 69 orphaned event documents from 57
 * deleted recordings, 294.5 MB, 12.9% of a 2,284 MB collection. Nothing
 * reported it, because nothing reads a document whose parent is gone and
 * nothing was counting. Memo `9740ad2a`.
 *
 * ⛔ Asserts on SOURCE. There is no fixture Mongo here, and the regression is
 * invisible from outside anyway: the delete still succeeds and still reports
 * success — only the orphans come back.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const src = fs.readFileSync(path.join(repoRoot, "src/tools/recordings.ts"), "utf8");

function codeOnly(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** ⛔ Brace-bounded, never a character count — a fixed window here would run
 *  into the neighbouring handler and assert against the wrong code. */
function deleteHandler() {
  const code = codeOnly(src);
  const i = code.indexOf("export const deleteRecording");
  assert.notEqual(i, -1, "deleteRecording must exist");
  const next = code.indexOf("\nexport const ", i + 10);
  return next === -1 ? code.slice(i) : code.slice(i, next);
}

const h = deleteHandler();

test("it deletes the recording's event chunks", () => {
  assert.match(
    h,
    /getRecordingEventsCollection\(\)/,
    "the handler must reach the recording_events collection",
  );
  assert.match(
    h,
    /events\.deleteMany\(\{\s*recordingId:/,
    "events must be removed by recordingId",
  );
});

/**
 * ⚠️ Events are CHUNKED — one document per chunkIndex, to stay under Mongo's
 * 16 MB document limit — so a recording routinely has several. deleteOne would
 * remove one chunk and silently leave the rest, which is the original bug with
 * a smaller number.
 */
test("it uses deleteMany for events, because they are chunked", () => {
  assert.ok(
    !/events\.deleteOne\(/.test(h),
    "deleteOne would strand every chunk after the first",
  );
});

test("it deletes the recording's annotations", () => {
  assert.match(
    h,
    /getRecordingAnnotationsCollection\(\)/,
    "annotations carry a base64 PNG each and must not be stranded",
  );
  assert.match(h, /annotations\.deleteMany\(\{\s*recordingId:/, "annotations must be removed too");
});

/**
 * ⚠️ Order matters, and not in the intuitive direction. Children are deleted
 * AFTER the parent so that a failure leaves an already-deleted recording whose
 * child deletes are idempotent on retry. Deleting children first can leave a
 * recording row whose events are gone — a row that looks playable and is not.
 */
test("the parent is deleted before the children", () => {
  const parent = h.indexOf("recordings.deleteOne(");
  const child = h.indexOf("events.deleteMany(");
  assert.ok(parent !== -1 && child !== -1, "both deletes must be present");
  assert.ok(
    parent < child,
    "recordings.deleteOne must precede the child deletes — the reverse can leave a playable-looking recording with no events",
  );
});

/**
 * ⭐ The counts are the only evidence a caller gets that the children went.
 * Without them this fix is unobservable from outside and a revert is silent.
 */
test("it reports how many children it removed", () => {
  assert.match(h, /eventChunksDeleted/, "the response must carry the event-chunk count");
  assert.match(h, /annotationsDeleted/, "and the annotation count");
});
