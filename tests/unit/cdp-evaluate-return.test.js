import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ⛔ THE DISCARDED-VALUE TRAP.
 *
 * `cdp.evaluate()` wraps the script it is given in an async IIFE, and injects
 * an implicit `return` for only two shapes:
 *
 *   A) the script already starts with `return`
 *   B) it is a SINGLE-LINE, single-statement expression
 *   C) it is a parenthesised IIFE  — `(async () => { ... })()`
 *
 * Anything else — most importantly a multi-line template literal building an
 * expression across several lines — is used AS-IS. Its value is evaluated and
 * thrown away, the IIFE returns undefined, and the caller receives `null`.
 *
 * ⛔ NOTHING ELSE CATCHES THIS. There is no error, no exception, no warning.
 * A `null` from a query reads exactly like "nothing matched", which is a
 * perfectly ordinary answer — so the bug survives code review, survives the
 * typecheck (this is a string), and survives manual testing by anyone who
 * happens to try it on a page where zero matches is plausible.
 *
 * It has already shipped twice:
 *   · `ha` reported null-on-IIFE; case C above was added for that shape ONLY,
 *     and the general problem was left in place.
 *   · 2026-09-07: browser_query_dom returned null on every page, and
 *     browser_list_frames reported iframeSelector:null for EVERY frame.
 *     Measured on a live tab: the identical script returned 4 elements written
 *     on one line and `null` written across lines.
 *
 * This test is the guard that was missing. It only flags calls whose result is
 * actually CONSUMED — assigned or returned — because a script run purely for
 * its side effects (setting document.title, say) legitimately needs no value.
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "../../extension/background.js"),
  "utf8",
);

/** Read the template literal starting at `start` (index of its backtick). */
function readTemplate(text, start) {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === "`") return text.slice(start + 1, i);
    i++;
  }
  return null;
}

/** Would cdp.evaluate() hand this script's value back to the caller? */
function valueSurvives(script) {
  const body = script.trim();
  if (/^return\b/.test(body)) return true;              // case A
  if (!body.includes("\n") && !body.includes(";")) return true; // case B
  if (body.startsWith("(")) return true;                 // case C
  return false;                                          // case D — discarded
}

/**
 * Calls whose value is consumed: `= await cdp.evaluate(` / `return cdp.evaluate(`
 * and the evaluateInFrame variants.
 */
function consumingEvaluateCalls() {
  const out = [];
  const re = /(=\s*await\s+|return\s+(?:await\s+)?)[\w.]*\.(evaluate|evaluateInFrame)\(/g;
  let m;
  while ((m = re.exec(src))) {
    // Find the first template literal argument, if this call uses one inline.
    const after = src.slice(m.index, m.index + 400);
    const tickRel = after.indexOf("`");
    if (tickRel === -1) continue; // variable-passed; handled below
    const openParen = after.indexOf("(", after.indexOf(m[2]));
    if (tickRel < openParen) continue;
    const abs = m.index + tickRel;
    const body = readTemplate(src, abs);
    if (body === null) continue;
    out.push({ line: src.slice(0, m.index).split("\n").length, body });
  }
  return out;
}

/** `const x = \`...\`` templates that are later passed to evaluate by name. */
function variablePassedScripts() {
  const out = [];
  const assigns = new Map();
  const ar = /const\s+(\w+)\s*=\s*`/g;
  let a;
  while ((a = ar.exec(src))) {
    const body = readTemplate(src, ar.lastIndex - 1);
    if (body !== null) assigns.set(a[1], { body, line: src.slice(0, a.index).split("\n").length });
  }
  const cr = /\.(evaluate|evaluateInFrame)\(\s*(?:await [^,]+,\s*)?(\w+)\s*[,)]/g;
  let c;
  while ((c = cr.exec(src))) {
    const hit = assigns.get(c[2]);
    if (hit) out.push({ line: hit.line, body: hit.body, via: c[2] });
  }
  return out;
}

test("⛔ no evaluate() script has its value silently discarded", () => {
  const offenders = [...consumingEvaluateCalls(), ...variablePassedScripts()]
    .filter((c) => !valueSurvives(c.body))
    .map((c) => `background.js:${c.line}${c.via ? ` (via ${c.via})` : ""} — ${c.body.trim().slice(0, 70).replace(/\s+/g, " ")}…`);

  assert.deepEqual(
    offenders,
    [],
    "these scripts are multi-line, do not start with `return`, and are not " +
      "parenthesised IIFEs — cdp.evaluate() will discard their value and the " +
      "caller will silently receive null:\n  " + offenders.join("\n  "),
  );
});

test("the two sites that shipped this bug still carry their explicit return", () => {
  // Pinned individually: the scanner above could be defeated by a refactor that
  // changes the call shape, and these two are the ones users actually hit.
  assert.match(
    src,
    /const queryScript = `\s*\n\s*return Array\.from\(document\.querySelectorAll\(/,
    "handleQueryDOM's script must start with `return` — without it browser_query_dom returns null for every selector",
  );
  assert.match(
    src,
    /const iframeData = await cdp\.evaluate\(`\s*\n\s*return Array\.from\(document\.querySelectorAll\('iframe, frame'\)\)/,
    "the iframeSelector lookup must start with `return` — without it browser_list_frames reports iframeSelector:null for every frame",
  );
});

test("cdp.evaluate still only auto-returns the three shapes this test assumes", () => {
  // If someone teaches the wrapper to handle multi-line expressions, this test's
  // premise changes and `valueSurvives` above becomes wrong (too strict).
  const cdp = fs.readFileSync(
    path.join(import.meta.dirname, "../../extension/utils/cdp.js"),
    "utf8",
  );
  assert.match(cdp, /const hasExplicitReturn = \/\^\\s\*return\\b\/\.test\(expression\)/);
  assert.match(cdp, /const isSingleStatement = !expression\.includes\('\\n'\) && !expression\.includes\(';'\)/);
});
