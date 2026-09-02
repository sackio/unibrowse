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

/**
 * ⛔ THE SEND SELECTOR IS A FIFTH LIST. Its <option> values are string
 * literals in popup.html that popup.js branches on by literal — the same
 * runtime-only boundary as the message names, one file over. Rename the
 * option value to "tab" and the markup still parses, the popup still opens,
 * the option still appears, and choosing it silently falls through to the
 * CONTENT path: the user asks to hand over a session and the agent is mailed
 * a copy of the page text instead. No error anywhere.
 */
function formatOptionValues() {
  const sel = html.match(/<select id="send-agent-format">([\s\S]*?)<\/select>/);
  assert.ok(sel, "popup.html must define #send-agent-format");
  return [...sel[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
}

test("the send selector offers session alongside the three content formats", () => {
  assert.deepEqual(formatOptionValues(), ["markdown", "html", "text", "session"]);
});

test("⛔ 'session' is branched on in popup.js — not silently treated as a format", () => {
  // Both halves matter: the branch that routes it away from the content path,
  // and the handler it routes to. A branch pointing at a method that no longer
  // exists throws on click; the content path would not be reached either way.
  assert.match(
    js,
    /format === 'session'/,
    "popup.js must branch on the 'session' option value",
  );
  assert.match(
    js,
    /async sendSessionToAgent\(\)/,
    "the branch's target must exist",
  );
});

test("a session send goes through attach THEN share_tab, never send_to_agent", () => {
  // ⛔ The whole point of `session` is that it hands over a live handle. If it
  // ever reached send_to_agent it would mail page text under a name promising
  // a drivable tab — the exact confusion the tab envelope exists to prevent.
  const body = js.slice(
    js.indexOf("async sendSessionToAgent()"),
    js.indexOf("async sendToAgent(scope)"),
  );
  assert.ok(body.length > 0, "sendSessionToAgent must be defined before sendToAgent");
  assert.match(body, /type: 'ensure_attached'/, "it must attach the tab first");
  assert.match(body, /type: 'share_tab'/, "it must send the tab handle");
  assert.doesNotMatch(body, /type: 'send_to_agent'/, "it must NOT use the content path");
});
