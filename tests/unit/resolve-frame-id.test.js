import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * resolveFrameId() decides whether a frameTarget is already a CDP frameId or
 * is a CSS selector it must resolve. That decision is a regex test, and it was
 * wrong in a way nothing else could catch.
 *
 * Chrome emits frameIds as 32 uppercase hex characters with NO dot. MEASURED
 * 2026-09-11 on office against a live page: 4AB7A962479DEA95542EBC8B4ADD7BF0.
 * The original test was /^[0-9A-Fa-f]+\.[0-9]+$/ — it REQUIRED a dot, so it
 * never matched a real frameId.
 *
 * ⛔ The failure was self-contradicting, which is why it survived:
 * browser_list_frames hands out these frameIds, every frameTarget tool
 * description tells you to pass one, and resolveFrameId's own error message
 * says to fetch one from browser_list_frames — and then the input was routed
 * into the CSS-selector branch and rejected with a message about selectors.
 *
 * ⛔ NOTHING ELSE GUARDS THIS. It is a regex against a runtime string; the
 * parser, the bundler and the typecheck are all blind to it, and the extension
 * is not importable from a test, so this reads the source.
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/background.js"),
  "utf8",
);

/** Pull the frameId guard out of resolveFrameId and rebuild it as a predicate. */
function frameIdGuard() {
  const start = src.indexOf("async resolveFrameId(cdp, frameTarget) {");
  assert.ok(start > -1, "resolveFrameId must exist — this test reads it by name");
  const body = src.slice(start, start + 2000);
  const m = body.match(/if \((.+?)\) \{\s*\n\s*return frameTarget;/s);
  assert.ok(m, "could not find the early-return frameId guard in resolveFrameId");
  const condition = m[1];
  return (frameTarget) =>
    new Function("frameTarget", `return (${condition});`)(frameTarget);
}

test("⛔ a real 32-hex CDP frameId is accepted, not treated as a selector", () => {
  const accepts = frameIdGuard();
  // Measured on a live page, 2026-09-11.
  assert.equal(accepts("4AB7A962479DEA95542EBC8B4ADD7BF0"), true);
  // Lowercase is equally valid hex and must not be rejected.
  assert.equal(accepts("4ab7a962479dea95542ebc8b4add7bf0"), true);
});

test("the legacy HEX.NUMBER frameId form still works", () => {
  const accepts = frameIdGuard();
  assert.equal(accepts("4AB7A962479DEA95542EBC8B4ADD7BF0.1"), true);
  assert.equal(accepts("ABC.12"), true);
});

/**
 * ⚠️ The length anchor is the whole reason this is safe. A bare
 * /^[0-9A-Fa-f]+$/ would match real CSS type selectors: `a`, `b` and `dd` are
 * all valid HTML tags AND valid hex strings. Widening the guard to "looks like
 * hex" would silently route those selectors into the frameId branch, where
 * they would be handed to CDP as a frame that does not exist.
 */
test("⛔ short hex-looking CSS selectors are NOT mistaken for frameIds", () => {
  const accepts = frameIdGuard();
  for (const selector of ["a", "b", "dd", "abc", "deadbeef"]) {
    assert.equal(
      accepts(selector),
      false,
      `"${selector}" is a valid CSS selector and must not be read as a frameId`,
    );
  }
});

test("ordinary CSS selectors are still routed to the selector branch", () => {
  const accepts = frameIdGuard();
  for (const selector of ["#checkout-frame", 'iframe[name="payment"]', ".frame"]) {
    assert.equal(accepts(selector), false, `${selector} must not match`);
  }
});
