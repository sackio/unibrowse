import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── `extensionId` MUST BE A DECLARED ARG, OR ZOD SILENTLY EATS IT ────────────
 *
 * ⛔ THE BUG THIS GUARDS, AND WHY IT COST SOMEONE AN HOUR: every other
 * tab-targeting tool takes `extensionId`, so callers passed it here too.
 * `ListAttachedTabsTool.arguments` never declared it, zod strips unknown keys,
 * and the call returned the union across EVERY connected browser — 16 tabs
 * across 6 extensions — with no error, no warning and no hint that the filter
 * had been dropped. `alpaca` hit it 2026-10-08 while diagnosing one tab on
 * office's desktop Chrome.
 *
 * ⭐ A DECLARED-ARG TEST IS THE ONLY KIND THAT CAN CATCH THIS. A behavioural
 * test that passes `extensionId` and asserts on the tabs returned passes
 * identically whether the arg works or is stripped, whenever only one
 * extension happens to be connected — which is the usual case in a test rig
 * and never the case in production.
 *
 * ⛔ AND AN UNKNOWN ID MUST BE AN ERROR, NOT AN EMPTY LIST. `tabs: []` for a
 * browser that is not connected is byte-identical to "that browser has nothing
 * attached", and only one of those two facts tells a caller to go look at why
 * their browser is gone. Fail toward broken, never toward healthy.
 */

const repoRoot = path.join(import.meta.dirname, "../..");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const read = (p) => codeOnly(fs.readFileSync(path.join(repoRoot, p), "utf8"));
const schemas = read("src/types/tool-schemas.ts");
const handler = read("src/tools/multi-tab-management.ts");
const context = read("src/context.ts");

test("ListAttachedTabsTool DECLARES extensionId, so zod cannot strip it", () => {
  const block = schemas.slice(
    schemas.indexOf("export const ListAttachedTabsTool"),
    schemas.indexOf("export const SetTabLabelTool"),
  );
  assert.ok(block.length > 0, "ListAttachedTabsTool must exist ahead of SetTabLabelTool");
  assert.match(
    block,
    /extensionId:\s*z\s*\.?\s*string\(\)/,
    "extensionId must be a declared argument — an undeclared one is stripped silently",
  );
});

test("the handler reads extensionId and narrows the fan-out with it", () => {
  assert.match(
    handler,
    /onlyExtension\s*=\s*\(params as any\)\?\.extensionId/,
    "the handler must read the caller's extensionId",
  );
  assert.match(
    handler,
    /only:\s*\[\s*onlyExtension\s*\]/,
    "it must reach broadcastSocketMessage as a real fan-out filter, not a post-hoc discard",
  );
});

test("an unknown extensionId is an error that names the connected ids", () => {
  const guard = handler.slice(
    handler.indexOf("onlyExtension && !context.getExtension"),
    handler.indexOf("broadcastSocketMessage"),
  );
  assert.ok(
    guard.includes("onlyExtension && !context.getExtension(onlyExtension)"),
    "an id matching no connected extension must be rejected before the broadcast",
  );
  assert.match(guard, /errorResponse\(/, "it must be an error, never an empty tab list");
  assert.match(guard, /listExtensions\(\)/, "the error must name the ids that DO exist");
});

test("broadcastSocketMessage honours `only`, and the legacy ws never answers for it", () => {
  assert.match(
    context,
    /options\.only\s*\n?\s*\?\s*this\.listExtensions\(\)\.filter/,
    "`only` must filter the extension list before any socket traffic",
  );
  assert.match(
    context,
    /extensions\.length === 0 && this\._ws && !options\.only/,
    "the legacy single-ws fallback must not answer on behalf of a NAMED extension — " +
      "it reports extensionId 'default', which is not the id the caller asked for",
  );
});

test("the default is still the union across every extension", () => {
  assert.match(
    handler,
    /onlyExtension\s*\?\s*\{\s*only:\s*\[\s*onlyExtension\s*\]\s*\}\s*:\s*\{\s*\}/,
    "omitting extensionId must broadcast to all — claude-login-auto reads this tool's " +
      "unfiltered roster and a default-narrowed response would invert its predicate",
  );
});
