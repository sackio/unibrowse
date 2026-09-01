import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ⛔ THE FOURTH LIST. popup-messages.test.js guards the three lists that carry
 * message NAMES across the popup↔background boundary. This guards the other
 * boundary the popup has: the element IDS it shares with popup.html.
 *
 * `document.getElementById('send-modal-note')` returns null when the markup
 * says `send-modal-notes`, and null is not an error — it is stored in
 * this.elements, survives construction, and throws only when someone clicks
 * the button that reads `.value` off it. Nothing before that notices: the
 * parser is happy, the popup opens, the feature is dead on the first click.
 *
 * Same failure class as the message-name drift, one file over.
 */

const dir = import.meta.dirname;
const js = fs.readFileSync(path.join(dir, "../../extension/popup.js"), "utf8");
const html = fs.readFileSync(path.join(dir, "../../extension/popup.html"), "utf8");

/** Every id popup.js looks up by literal. */
function referencedIds() {
  return [
    ...new Set([...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])),
  ].sort();
}

/** Every id the markup actually defines. */
function definedIds() {
  return new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
}

test("⛔ every element popup.js looks up exists in popup.html", () => {
  const defined = definedIds();
  const missing = referencedIds().filter((id) => !defined.has(id));
  assert.deepEqual(
    missing,
    [],
    "popup.js reads these ids and the markup has none of them — getElementById " +
      `returns null and the click throws: ${missing.join(", ")}`,
  );
});

test("the lookup list is not empty — a regex that stops matching would pass silently", () => {
  // Without this, rewriting popup.js to cache elements differently would make
  // referencedIds() return [] and the test above would go green forever.
  assert.ok(referencedIds().length > 20, "expected popup.js to look up many ids");
});

/**
 * The send dialog is collected in the constructor and used in three separate
 * click paths, so a missing id here breaks Send page, Share tab and Share
 * recording at once — while the popup still opens and still looks right.
 */
test("the send dialog's elements are wired from markup to script", () => {
  const defined = definedIds();
  const referenced = referencedIds();
  for (const id of [
    "send-modal",
    "send-modal-title",
    "send-modal-summary",
    "send-modal-note",
    "send-modal-recording",
    "send-modal-recording-check",
    "send-modal-recording-text",
    "send-modal-cancel",
    "send-modal-send",
  ]) {
    assert.ok(defined.has(id), `popup.html must define #${id}`);
    assert.ok(referenced.includes(id), `popup.js must read #${id}`);
  }
});
