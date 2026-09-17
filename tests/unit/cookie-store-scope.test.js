import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ── A COOKIE CALL MUST ACT ON THE STORE THE CALLER NAMED ─────────────────────
 *
 * Chrome keeps a SEPARATE cookie store per incognito session. `chrome.cookies`
 * exposes them through `storeId` / `getAllCookieStores()`. With no `storeId`,
 * every call reads the store the CALLING CONTEXT is in — for the service worker,
 * always the default profile.
 *
 * ⛔ ALL FOUR cookie handlers accepted `tabTarget` and NONE read it. Reported by
 * `agents` 2026-09-17, measured three times: `browser_get_cookies` with
 * `tabTarget` set to an incognito tab signed in as agents2@sack.io returned
 * BEN'S default-profile `sessionKey`. The sign-in was correct; only the read was
 * wrong. `browser_clear_cookies` had the same gap, where it is destructive —
 * "clear this tab's cookies" cleared Ben's real session.
 *
 * ⚠️ THE CLASS IS "DECLARED BUT IGNORED", not "cookies". A parameter in the
 * schema that the handler never reads is worse than a missing one: callers pass
 * it, believe it took effect, and get a confidently wrong answer. Same defect as
 * the documented-and-unenforced `timeout_ms` (30e895f).
 *
 * ⛔ AND IT MUST THROW, never fall back to the default store. On 2026-08-11 this
 * read wrote Ben's session under the `agents` account and the usage sweep
 * reported his quota as theirs. A silent fallback is how that happens.
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

/** Extract the real resolver and run it — do NOT reimplement it here. */
function loadResolver() {
  const m = /async resolveCookieStoreId\(data\) \{([\s\S]*?)\n  \}/.exec(bgSrc);
  assert.ok(m, "resolveCookieStoreId not found in extension/background.js — renamed, or deleted?");
  const fn = new Function("data", "chrome", `return (async () => {${m[1]}})();`);
  return (ctx, data, chromeStub) => fn.call(ctx, data, chromeStub);
}

const ctxWith = (tabId) => ({
  tabManager: { resolveTab: (t) => (t === "incognito-tab" ? { tabId } : null) },
});

const chromeWith = (stores) => ({ cookies: { getAllCookieStores: async () => stores } });

test("no tabTarget keeps the historical default-store behaviour", async () => {
  const id = await loadResolver()(ctxWith(42), {}, chromeWith([]));
  assert.equal(id, null, "omitting tabTarget must stay a plain default-store call, not become an error");
});

test("a named tab resolves to ITS store, not the default", async () => {
  const stores = [
    { id: "0", tabIds: [1, 2, 3] },
    { id: "1", tabIds: [42] },
  ];
  const id = await loadResolver()(ctxWith(42), { tabTarget: "incognito-tab" }, chromeWith(stores));
  assert.equal(id, "1", "returned the wrong store — this is the defect itself: the incognito tab's cookies read from the default profile");
});

test("an unresolvable tabTarget throws instead of using the default store", async () => {
  await assert.rejects(
    () => loadResolver()(ctxWith(42), { tabTarget: "no-such-tab" }, chromeWith([{ id: "0", tabIds: [42] }])),
    /does not resolve/,
    "a silent fallback here returns a DIFFERENT account's credential to a caller who asked for a specific tab",
  );
});

test("a tab in no known store throws and names the incognito permission", async () => {
  // The realistic cause: the extension is not allowed in incognito, so the
  // incognito store is invisible to getAllCookieStores(). Falling back would
  // hand back the default profile's session.
  await assert.rejects(
    () => loadResolver()(ctxWith(99), { tabTarget: "incognito-tab" }, chromeWith([{ id: "0", tabIds: [1] }])),
    /Allow in incognito/,
    "must say what to enable; an unexplained failure here gets 'fixed' by removing the check",
  );
});

/* ── Every handler must consult the resolver ────────────────────────────────
 *
 * The tests above pass even if no handler calls it — which is exactly the shape
 * of the original bug: the capability existed in the schema and nothing used it.
 */

const HANDLERS = [
  { name: "handleGetCookies", why: "returned another account's sessionKey — the reported defect" },
  { name: "handleSetCookie", why: "wrote the cookie into the wrong profile" },
  { name: "handleDeleteCookie", why: "deleted from the wrong profile" },
  { name: "handleClearCookies", why: "DESTRUCTIVE: cleared Ben's real browsing session" },
];

for (const { name, why } of HANDLERS) {
  test(`${name} scopes to the caller's cookie store`, () => {
    const m = new RegExp(`async ${name}\\(data\\) \\{([\\s\\S]*?)\\n  \\}`).exec(bgSrc);
    assert.ok(m, `${name} not found in extension/background.js`);
    const body = codeOnly(m[1]);
    assert.match(
      body,
      /resolveCookieStoreId\(data\)/,
      `${name} ignores tabTarget and acts on the default store: ${why}`,
    );
    assert.match(
      body,
      /storeId/,
      `${name} resolved a store and then did not pass it to the chrome.cookies call`,
    );
  });
}
