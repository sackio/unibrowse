import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── A NEW TAB MUST BELONG TO THE SEAT THAT CREATED IT ───────────────────────
 *
 * `handleMCPMessage` stashes each request's `agent` on ONE mutable field of the
 * shared TabManager (`_currentAgent`) and nothing clears it — the comment
 * promising a `finally` describes code that does not exist. Handlers are async
 * and interleave, so that field holds whoever sent the MOST RECENT message.
 *
 * `handleCreateTab` read it AFTER its load-wait, which resolves on 'complete'
 * or a 15s timeout — so any call landing in that window became the owner of a
 * tab it had never asked for, and the actual creator was locked out of its own
 * tab with `tab-reserved`.
 *
 * MEASURED 2026-10-10, reported by `agents`: create by `claude-login-auto`,
 * TAB_ATTACHED tab=41943061 at 09:39:53.355Z, reserved to `freelance` (claimed
 * 09:39:53.090Z) whose only call was a browser_evaluate at 09:39:50.6Z.
 * Reproduced on server3 at 09:35:38Z.
 *
 * ⛔ TWO FIXES, BECAUSE ONE OF THEM REACHES NOBODY. The extension fix is the
 * correct one and takes effect on a browser only after the ↻ on
 * chrome://extensions; every browser connected today still has the bug. The
 * server-side correction is what actually reaches them.
 *
 * ⛔ Asserts on SOURCE: there is no fixture browser here, and the regression is
 * invisible from outside — the create still succeeds and still reports success.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const bg = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");
const tabs = fs.readFileSync(path.join(repoRoot, "src/tools/tabs.ts"), "utf8");

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

const bgCode = codeOnly(bg);
const tabsCode = codeOnly(tabs);

/** ⛔ Brace-bounded, never a character count — see the note in
 *  create-tab-reports-attachment-honestly.test.js, where two fixed-width
 *  windows ran past the branch and gave two false failures. */
function fnBody(code, signatureStart) {
  const i = code.indexOf(signatureStart);
  assert.notEqual(i, -1, `expected to find ${signatureStart}`);
  // \u26d4 SKIP THE PARAMETER LIST. Every handler here destructures its payload,
  // so the first `{` after the name is the DESTRUCTURE, not the body — brace
  // matching from there returns the parameter list and every landmark inside
  // the function reads as absent. Four false failures before this line existed.
  const parenEnd = code.indexOf(") {", i);
  assert.notEqual(parenEnd, -1, `expected a body for ${signatureStart}`);
  const open = parenEnd + 2;
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, j + 1);
    }
  }
  throw new Error(`unbalanced body for ${signatureStart}`);
}

test("handleCreateTab takes the agent from its OWN payload", () => {
  assert.match(
    bgCode,
    /async handleCreateTab\(\{[^}]*\bagent\b[^}]*\}\)/,
    "the handler must receive `agent` as a parameter — reading a shared field is what mis-attributed the tab",
  );
  const body = fnBody(bgCode, "async handleCreateTab(");
  assert.match(
    body,
    /const callerAgent = agent !== undefined \? agent : this\.tabManager\._currentAgent/,
    "the payload's own agent must win over the shared field",
  );
});

/**
 * ⭐ THE LOAD-WAIT IS THE WHOLE BUG. Snapshotting is only a fix if it happens
 * before the awaits — a snapshot taken next to the attach is the original code
 * with extra steps.
 */
test("the snapshot is taken before the first await, not next to the attach", () => {
  const body = fnBody(bgCode, "async handleCreateTab(");
  const snapshot = body.indexOf("const callerAgent =");
  const firstAwait = body.indexOf("await ");
  const attach = body.indexOf("this.tabManager.attachTab(");
  assert.ok(snapshot !== -1 && firstAwait !== -1 && attach !== -1, "all three landmarks must exist");
  assert.ok(
    snapshot < firstAwait,
    "the caller must be captured before any await — otherwise another message can overwrite the field first",
  );
  assert.ok(snapshot < attach, "and well before the attach that decides ownership");
});

test("no attach inside handleCreateTab still reads the shared field", () => {
  const body = fnBody(bgCode, "async handleCreateTab(");
  const attachCalls = body.match(/attachTab\([\s\S]{0,220}?\}\)/g) || [];
  assert.ok(attachCalls.length >= 2, "both the normal and the TOCTOU-retry attach must be present");
  for (const call of attachCalls) {
    assert.ok(
      !/_currentAgent/.test(call),
      "an attach that reads `_currentAgent` at attach time reserves the tab to the last caller, not the creator",
    );
  }
});

/**
 * ⚠️ handleEnsureAttached has the same shape — several awaits before the attach
 * that claims the tab — and `browser_attach_tab` carries `agent` too.
 */
test("handleEnsureAttached snapshots its caller as well", () => {
  assert.match(
    bgCode,
    /async handleEnsureAttached\(\{[^}]*\bagent\b[^}]*\}\)/,
    "attach_tab's handler must take `agent` from its payload too",
  );
  const body = fnBody(bgCode, "async handleEnsureAttached(");
  assert.match(body, /const callerAgent = agent !== undefined \? agent : /, "same snapshot");
});

/**
 * ⛔ The comment that claimed a `finally` cleared the field is what made this
 * look safe. A reader who believes the stash is scoped to one message has no
 * reason to suspect a later one.
 */
test("the shared stash documents that it is never cleared", () => {
  const raw = fnBody(bg, "async handleMCPMessage(");
  const stripped = fnBody(bgCode, "async handleMCPMessage(");
  assert.ok(
    !/\bfinally\b/.test(stripped),
    "there is no finally in handleMCPMessage — if one is added, re-check what it clears and who is mid-flight",
  );
  assert.match(
    raw,
    /never cleared/,
    "the stash must say out loud that it is never cleared; the comment claiming a `finally` is what made it look scoped to one message",
  );
});

/**
 * ⭐ THE SERVER HALF IS THE ONE THAT REACHES A BROWSER TODAY. An extension fix
 * ships nowhere without the ↻ the operator declined, so every connected browser
 * still mis-reserves; the server has to notice and correct it.
 */
test("the server checks who the extension actually reserved the tab to", () => {
  assert.match(
    tabsCode,
    /result\.reservedTo/,
    "createTab must read the extension's reported owner, not assume its own request was honoured",
  );
  assert.match(
    tabsCode,
    /if \(reservedBy && claimedTo !== reservedBy\)/,
    "a mismatch between who asked and who owns it must be detected",
  );
});

test("a mismatch is corrected with a takeover reserve", () => {
  assert.match(
    tabsCode,
    /sendSocketMessage\(\s*"browser_reserve_tab"[\s\S]{0,260}?takeover: true/,
    "the correction must claim the tab for the creator — takeover is safe here because the tab was created a moment ago",
  );
});

/**
 * ⛔ The reported field must stop asserting the request. Saying "Reserved for X"
 * while the tab belongs to Y is why the first evidence anyone got was an
 * unrelated tool failing minutes later.
 */
test("the response reports the extension's answer, not our request", () => {
  assert.match(
    tabsCode,
    /reservedByExtension: claimedTo/,
    "the caller must be able to see what the extension said, separately from what we asked for",
  );
});

/**
 * ⭐ THE FLAVOUR THAT ACTUALLY FIRED. MEASURED 2026-10-10 09:55:07Z on a
 * container sidecar: a create carrying agent:"unibrowse-probe-A" returned
 * `reservedTo: null` because an interleaving call with NO agent had set the
 * shared field to null, and claimTab(tabId, null) claims nothing. The response
 * still said "Reserved for …" — strictly worse than the wrong owner, because
 * the creator believes the tab is held and the next agent claims it
 * legitimately. "nobody" must therefore be a correctable state, not a skip.
 */
test("reserved-to-nobody is corrected, and named as nobody", () => {
  assert.match(
    tabsCode,
    /\(claimedTo \? `"\$\{claimedTo\}"` : "nobody"\)/,
    "the message must distinguish the wrong owner from no owner at all — they fail differently",
  );
  const i = tabsCode.indexOf("if (reservedBy && claimedTo !== reservedBy)");
  assert.notEqual(i, -1, "the correction branch must exist");
  assert.ok(
    !/claimedTo &&/.test(tabsCode.slice(i, i + 60)),
    "the branch must not require a non-null claimedTo — that would skip the measured case",
  );
});

test("a failed correction is reported, not swallowed", () => {
  assert.match(
    tabsCode,
    /THIS TAB IS RESERVED TO/,
    "if the corrective reserve fails the caller must be told the tab is not theirs",
  );
  assert.match(
    tabsCode,
    /browser_reserve_tab\(\{tabTarget: \$\{result\.tabId\}/,
    "and given the exact call that fixes it",
  );
});
