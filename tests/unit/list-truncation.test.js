import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── A LIST TOOL MUST NEVER HAND A LONG ARRAY TO jsonResponse ─────────────────
 *
 * `jsonResponse` truncates the SERIALISED STRING. Over the token budget that
 * returns JSON cut off mid-object: unparseable, rows silently missing, and —
 * because summary fields are serialised AFTER the array — the very fields that
 * would reveal the truncation are the first ones destroyed.
 *
 * ⛔ THIS IS A CLASS, NOT TWO COINCIDENCES. Both instances were found on the
 * SAME DAY, hours apart, and the second one bit while investigating the first:
 *
 *   · browser_list_fetched — reported by `laura-work` after 125 fetches on a
 *     healthy server: limit 2 → 2 files, limit 50 → 50, limit 200 → read as an
 *     EMPTY STORE. 274 rows serialise to 80,721 tokens against a 25,000 cap, so
 *     the breach starts near 85 rows. A seat that treated this index as more
 *     authoritative than its own manifest was told the store was empty.
 *
 *   · browser_list_attached_tabs — at max_tokens 1200 it dropped the exact
 *     reserved tab being used to decide whether to restart a LAN-shared server.
 *     Absence of a row here reads as "no one owns this", which is the most
 *     dangerous possible false negative for a coordination check.
 *
 * ⇒ Every list tool needs the same envelope: a `total` independent of how many
 * rows were returned, an explicit truncation flag, and row-dropping measured
 * with the REAL encoder rather than a per-row estimate.
 *
 * ⚠️ WHY A SHARED TEST FILE. These live in different modules and neither
 * module's own tests would catch the pattern spreading to a third. Add the next
 * list tool to GUARDED below rather than writing a third bespoke test.
 */

const repoRoot = path.join(import.meta.dirname, "../..");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const GUARDED = [
  {
    tool: "browser_list_fetched",
    file: "src/tools/downloads.ts",
    why: "an over-budget listing read as an empty store — measured 2026-09-13",
  },
  {
    tool: "browser_list_attached_tabs",
    file: "src/tools/multi-tab-management.ts",
    why: "dropped a reserved tab during a restart-safety check — measured 2026-09-13",
  },
];

for (const { tool, file, why } of GUARDED) {
  const code = codeOnly(fs.readFileSync(path.join(repoRoot, file), "utf8"));

  test(`${tool} measures its payload against the real encoder`, () => {
    assert.match(
      code,
      /estimateTokens\(JSON\.stringify\(envelope\(/,
      `${file}: ${why}. Row size varies by an order of magnitude with URL and name length, so a per-row estimate does not hold — measure the real thing.`,
    );
  });

  test(`${tool} reports a total independent of how many rows it returned`, () => {
    // ⚠️ Accept BOTH `total,` (ES6 shorthand) and `total: expr`. The two
    // guarded modules happen to use different forms, and the first version of
    // this assertion matched only the explicit one — so it failed on a file
    // that was correct. Matching surface syntax is how a guard ends up
    // measuring style instead of behaviour; this is the same trap as the
    // `offset` assertion that once matched a DIFFERENT tool's declaration.
    assert.match(
      code,
      /(^|[\s{,])total\s*[,:]/m,
      `${file}: without a total, a short page is indistinguishable from an empty result — which is exactly how this defect presents. ${why}`,
    );
    assert.match(
      code,
      /truncatedForSize/,
      `${file}: dropping rows silently is the same defect wearing a different hat. The caller must be told the page is short for SIZE, not for lack of data.`,
    );
  });

  test(`${tool} binary-searches the row count instead of truncating the string`, () => {
    assert.match(
      code,
      /while \(lo < hi\)/,
      `${file}: the fit must be found by dropping whole ROWS. Truncating the serialised string yields unparseable JSON and eats the summary fields first.`,
    );
  });
}
