import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * browser_fetch_to_server pulls a file using the browser's own session and
 * pushes the bytes to the server out of band. Two of its decisions are silent
 * failures if wrong, and neither is reachable from a normal test — the handler
 * lives in an MV3 service worker that cannot be imported, and the server route
 * builds a filesystem path from a header. So both are read out of the source
 * and exercised directly.
 *
 * ⛔ WHY A TEST AT ALL, given the feature is new: every failure mode here
 * returns SUCCESS to the caller. A login page stored as a PDF is a 200 with
 * bytes on disk. A traversing filename is a written file. Nothing upstream
 * notices, which is exactly the shape of bug that survives.
 */

const repoRoot = path.join(import.meta.dirname, "../..");
const serverSrc = fs.readFileSync(path.join(repoRoot, "src/http-server.ts"), "utf8");
const bgSrc = fs.readFileSync(path.join(repoRoot, "extension/background.js"), "utf8");
const schemaSrc = fs.readFileSync(path.join(repoRoot, "src/types/tool-schemas.ts"), "utf8");

/**
 * ⛔ STRIP COMMENTS BEFORE ASSERTING ON SOURCE TEXT.
 *
 * These tests read source and match patterns in it, so a COMMENT that mentions
 * the thing satisfies the assertion just as well as the code does. That is not
 * hypothetical: the first version of the credentials test passed with
 * `credentials: 'include'` deleted from the fetch call, because the comment
 * directly above it — written to explain why the option matters — still said
 * the words. The better the comment, the blinder the test.
 *
 * Verified by deletion on 2026-09-12: with this stripping in place, removing
 * the option takes the test red; without it, the test stayed green.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

function handlerBody() {
  const m = /async handleFetchToServer\(data\) \{([\s\S]*?)\n  \}/.exec(bgSrc);
  assert.ok(m, "handleFetchToServer not found in extension/background.js");
  return codeOnly(m[1]);
}

/* ── 1. The filename sanitiser ──────────────────────────────────────────────
 *
 * The filename arrives in an HTTP header, sourced from a remote page's
 * Content-Disposition or its URL path — i.e. from outside our trust boundary —
 * and is concatenated into a path on our server. Extract the real function and
 * run it, rather than reimplementing it here where it could drift.
 */
function loadSafeStoredName() {
  const m = /function safeStoredName\(raw: unknown, id: string\): string \{([\s\S]*?)\n  \}/.exec(
    serverSrc,
  );
  assert.ok(m, "safeStoredName not found in src/http-server.ts — did it get renamed?");
  // Strip the TS annotations; the body itself is plain JS.
  const body = m[1];
  return new Function("raw", "id", "path", body);
}

test("safeStoredName strips any path component", () => {
  const safe = loadSafeStoredName();
  const id = "abc123";
  for (const attack of [
    "../../../etc/cron.d/evil",
    "/etc/passwd",
    "..\\..\\windows\\system32\\x",
    "foo/../../bar.pdf",
  ]) {
    const out = safe(attack, id, path);
    assert.ok(!out.includes("/"), `slash survived sanitising: ${out}`);
    assert.ok(!out.includes("\\"), `backslash survived sanitising: ${out}`);
    assert.ok(out.startsWith(id + "-"), `id prefix missing: ${out}`);
  }
});

test("safeStoredName never yields a dot-leading or empty name", () => {
  const safe = loadSafeStoredName();
  // A bare ".." or "." basenames to itself; an empty string basenames to "".
  // Either would write to the directory itself rather than a file in it.
  for (const raw of ["..", ".", "", "...", "....", undefined, null, 42, {}]) {
    const out = safe(raw, "id1", path);
    const bare = out.slice("id1-".length);
    assert.ok(bare.length > 0, `empty name for input ${JSON.stringify(raw)}`);
    assert.ok(!bare.startsWith("."), `dot-leading name ${out} for ${JSON.stringify(raw)}`);
  }
});

test("safeStoredName keeps ordinary filenames legible", () => {
  const safe = loadSafeStoredName();
  assert.equal(safe("benefits-2026.pdf", "xyz", path), "xyz-benefits-2026.pdf");
  // Spaces and unicode get folded to underscores rather than dropped, so the
  // name stays recognisable instead of collapsing to "download".
  assert.equal(safe("Leave Policy v2.pdf", "xyz", path), "xyz-Leave_Policy_v2.pdf");
});

test("safeStoredName bounds the length", () => {
  const safe = loadSafeStoredName();
  const out = safe("a".repeat(5000) + ".pdf", "idx", path);
  assert.ok(out.length <= 130, `unbounded filename length: ${out.length}`);
});

/* ── 2. The server route must not trust the sanitiser alone ──────────────── */

test("the write path re-checks containment after sanitising", () => {
  assert.match(
    serverSrc,
    /refusing to write outside the fetched directory/,
    "the containment guard on /api/v1/fetched is gone — safeStoredName is then the only thing between a header and an arbitrary write",
  );
  assert.match(
    serverSrc,
    /path\.resolve\(absPath\)/,
    "containment must be checked on the RESOLVED path, not the joined string",
  );
});

/* ── 3. The extension must not store a login page as the file ────────────── */

test("the fetch sends credentials, or SSO-gated URLs silently return a login page", () => {
  assert.match(
    handlerBody(),
    /credentials:\s*['"]include['"]/,
    "credentials:'include' is the whole reason this runs in the browser — without it every gated fetch returns a sign-in page with status 200",
  );
});

test("an HTML response for a non-HTML URL is rejected, not stored", () => {
  const body = handlerBody();
  // Must be a live conditional that throws, not merely a mention of text/html.
  assert.match(
    body,
    /if\s*\(\s*\/\^text\\\/html\/i\.test\(contentType\)/,
    "the HTML guard is gone or disabled — a login wall answers 200 with HTML and would be stored as if it were the PDF",
  );
});

test("zero-length and non-ok responses throw rather than storing nothing", () => {
  const body = handlerBody();
  assert.match(body, /!resp\.ok/, "missing status check");
  assert.match(body, /byteLength === 0/, "missing empty-body check");
});

/* ── 4. Server routing ───────────────────────────────────────────────────────
 *
 * getServerForTab() takes a NUMERIC chrome tabId. tabTarget may instead be a
 * label string, and passing one finds no binding, falls through to the default
 * server, and ships the bytes to the wrong host for a remote-bound tab —
 * returning success either way.
 */
test("the tab binding is only consulted for a numeric tabTarget", () => {
  assert.match(
    handlerBody(),
    /typeof data\.tabTarget === ['"]number['"]/,
    "a label-string tabTarget must not be handed to getServerForTab — it resolves to the default server and uploads to the wrong host, silently",
  );
});

/* ── 5. The bytes must never come back through a tool response ───────────── */

test("the handler returns metadata, never the payload", () => {
  const ret = /return \{([^}]*)\};\s*$/.exec(handlerBody().trim());
  assert.ok(ret, "no return statement found");
  // base64 of binary costs ~0.955 tokens per source byte (measured
  // 2026-09-12), so returning the buffer would blow the response cap at ~26KB
  // and defeat the entire point of the out-of-band upload.
  //
  // ⚠️ `buf.byteLength` is a NUMBER and is fine to return — it is the useful
  // half of the receipt. Only the buffer ITSELF is the problem, so strip the
  // legitimate property reads before looking for a bare `buf`. The first
  // version of this assertion did not, and failed on correct code.
  const withoutLengths = ret[1].replace(/\bbuf\.byteLength\b/g, "");
  assert.ok(
    !/\bbuf\b/.test(withoutLengths),
    `the fetched buffer is being returned to the caller: ${ret[1]}`,
  );
});

/* ── 6. Header values must survive a non-ASCII document title ────────────────
 *
 * HTTP headers are ISO-8859-1. A header value holding an en-dash or an accent
 * makes the BROWSER throw while building the RequestInit — before the fetch —
 * so the transfer dies with a TypeError and nothing reaches the server.
 * Measured 2026-09-13 on real HR documents.
 *
 * ⛔ The encode/decode split across the two files is load-bearing and easy to
 * "tidy" into a bug: `label` is encoded SERVER-side so browsers already in the
 * field are fixed without a redeploy, and therefore must NOT be encoded again
 * in the extension. These tests pin both halves.
 */

const toolsSrc = fs.readFileSync(path.join(repoRoot, "src/tools/downloads.ts"), "utf8");

test("the extension percent-encodes the header values it sources itself", () => {
  const body = handlerBody();
  assert.match(
    body,
    /'X-Unibrowse-Filename':\s*encodeURIComponent\(filename\)/,
    "filename is usually taken from Content-Disposition, not the caller — an accented document name throws and kills the whole transfer",
  );
  assert.match(
    body,
    /'X-Unibrowse-Source-Url':\s*encodeURIComponent\(data\.url\)/,
    "a URL with non-Latin-1 characters throws the same way",
  );
});

test("the extension does NOT encode label — the server already did", () => {
  const body = handlerBody();
  assert.ok(
    !/'X-Unibrowse-Label':\s*encodeURIComponent/.test(body),
    "double-encoding: the server encodes label on the way out, so encoding it here too stores a literal %E2%80%93 as the label text",
  );
});

test("the extension announces that it encoded, so old extensions still work", () => {
  assert.match(
    handlerBody(),
    /'X-Unibrowse-Encoding':\s*'percent'/,
    "without this marker the server cannot tell an encoded filename from one containing a literal % and would mangle the latter",
  );
});

test("the server encodes label before it ever reaches the browser", () => {
  assert.match(
    codeOnly(toolsSrc),
    /label:\s*encodeURIComponent\(validatedParams\.label\)/,
    "this is the half that fixes browsers that cannot be redeployed — losing it silently re-breaks every non-ASCII label",
  );
});

/* ── 7. A closed response window is not a failed transfer ───────────────────
 *
 * The bytes travel browser → /api/v1/fetched, outside the WebSocket. So the
 * WS timeout is a RESPONSE deadline, and "no response" and "did not happen"
 * are different claims. Measured 2026-09-13: two 79 MB files were reported
 * failed, retried, reported failed again — and all four transfers had landed.
 * The caller nearly dropped two good files, and the retries left 76 MB of
 * byte-identical duplicates.
 *
 * ⛔ The recovery is the only thing standing between a slow transfer and a
 * false negative, and it is invisible in normal operation — nothing fails
 * loudly if someone removes it.
 */
test("a timed-out fetch consults the index before reporting failure", () => {
  const code = codeOnly(toolsSrc);
  assert.match(
    code,
    /getFetchedFilesCollection\(\)\.findOne\(\s*\{\s*sourceUrl:/,
    "without this lookup a transfer that succeeded past the response window is reported as failed, and the caller's retry duplicates a large file",
  );
  assert.match(
    code,
    /recoveredAfterTimeout:\s*true/,
    "the caller must be able to tell a recovered success from an ordinary one",
  );
  assert.match(
    code,
    /createdAt:\s*\{\s*\$gte:\s*startedAt\s*\}/,
    "the lookup MUST be bounded to this call — an unbounded sourceUrl match would resurrect an older fetch of the same URL and report it as this one's result",
  );
});

/**
 * ── destination ─────────────────────────────────────────────────────────────
 *
 * `destination` lands a fetched file in a private subdirectory on the FIRST
 * write, instead of the caller writing to the shared store and moving it
 * afterwards — a window in which the bytes are readable by anything that can
 * read the store.
 *
 * ⛔ IT IS ALSO THE ONLY CALLER-CONTROLLED PATH COMPONENT ON THIS ROUTE, on a
 * server that exposes /mcp. An unconstrained destination is an arbitrary-write
 * primitive. These tests exist because every one of these failures is SILENT:
 * a traversing destination writes a file and returns 200.
 *
 * ⚠️ What this feature does NOT do, so nobody re-derives it from the name:
 * it does not isolate one agent seat from another, because every seat on every
 * host runs as the same uid (measured 2026-09-13). No mode can.
 */
const { validateDestination, setFetchDestination, takeFetchDestination } =
  await import("../../src/utils/fetch-destinations.ts");

test("destination refuses every escape from the fetched store", () => {
  for (const bad of [
    "../etc",
    "a/../../etc",
    "..",
    ".",
    "/etc/passwd",
    "/tmp/x",
    "C:/windows",
    "a/b/../../../c",
    "a\\..\\b",
    "a\0b",
    "a\nb",
    "a b/c",          // space — rejected by the whitelist, not by enumeration
    "a;rm -rf /",
    "",
    "x".repeat(201),
    "a/b/c/d/e",      // deeper than the 4-level cap
  ]) {
    assert.throws(
      () => validateDestination(bad),
      undefined,
      `destination ${JSON.stringify(bad)} was ACCEPTED — this route writes files, so an accepted escape is an arbitrary write`,
    );
  }
});

test("destination accepts the ordinary shapes and normalises them", () => {
  assert.equal(validateDestination("laura-work"), "laura-work");
  assert.equal(validateDestination("laura-work/benefits"), "laura-work/benefits");
  assert.equal(validateDestination("a/b/c/d"), "a/b/c/d");
  // Redundant separators collapse rather than producing an empty segment that
  // path.join would silently swallow.
  assert.equal(validateDestination("laura-work//benefits/"), "laura-work/benefits");
  assert.equal(validateDestination("2026_Q3.archive-1"), "2026_Q3.archive-1");
});

test("a destination is consumed once, so it cannot capture a later fetch", () => {
  const url = "https://example.invalid/one-shot.pdf";
  setFetchDestination(url, "seat-a");
  assert.equal(takeFetchDestination(url), "seat-a");
  assert.equal(
    takeFetchDestination(url),
    null,
    "a destination that survived its own fetch would silently redirect an unrelated later fetch of the same URL",
  );
  assert.equal(takeFetchDestination(undefined), null);
  assert.equal(takeFetchDestination(null), null);
});

test("the upload route writes into the destination but guards against FETCHED_DIR", () => {
  const code = codeOnly(serverSrc);
  assert.match(
    code,
    /takeFetchDestination\(sourceUrl\)/,
    "the route must claim the destination the tool registered, keyed on the source URL",
  );
  assert.match(
    code,
    /startsWith\(path\.resolve\(FETCHED_DIR\)\s*\+\s*path\.sep\)/,
    "⛔ the containment check MUST be rooted at FETCHED_DIR — rooting it at the caller-influenced targetDir makes the guard agree with whatever was asked for, which is not a check",
  );
  assert.match(
    code,
    /ensurePrivateDir\(targetDir,\s*FETCHED_DIR\)/,
    "the subdirectory must be created private AND owned — a bare mkdir leaves it root-owned and world-readable",
  );
});

/**
 * ⛔ THE STORE'S 0700 WAS HOST-SIDE STATE, AND THAT WAS A SILENT REGRESSION
 * WAITING TO HAPPEN. The route recreates the store if it is missing, as root,
 * so deleting the directory once brought it back root:root 0755 — protection
 * gone, nothing failed, nothing logged.
 *
 * ⚠️ And the obvious one-line fix is wrong: `mode: 0o700` alone yields a
 * ROOT-OWNED private directory, which locks out every agent seat (all uid
 * 1000, measured 2026-09-13). Mode cannot express "private to the agents"
 * without an owner, which is why this goes through a helper and reads the
 * owner from the environment.
 */
test("recreating the fetched store cannot silently drop it to world-readable", () => {
  const code = codeOnly(serverSrc);
  assert.match(
    code,
    /if\s*\(!fs\.existsSync\(FETCHED_DIR\)\)\s*ensurePrivateDir\(FETCHED_DIR\)/,
    "⛔ a bare mkdirSync here recreates the store root:root 0755 the first time anyone deletes it",
  );
  assert.match(
    code,
    /mkdirSync\(dir,\s*\{\s*recursive:\s*true,\s*mode:\s*0o700\s*\}\)/,
    "the helper must create private, not chmod afterwards — a window in which the directory is world-readable is the thing being removed",
  );
  assert.match(
    code,
    /fs\.chownSync\(dir,\s*uid,\s*gid\)/,
    "⛔ 0700 without a chown is worse than 0755: root-owned and private locks out every seat that needs to read these files",
  );
  assert.match(
    code,
    /const\s+FETCHED_OWNER_UID\s*=\s*process\.env\.FETCHED_OWNER_UID/,
    "the owner must be configurable — hardcoding 1000 breaks any deployment whose seats are not uid 1000",
  );
});

test("destination never reaches the browser", () => {
  const code = codeOnly(toolsSrc);
  assert.match(
    code,
    /const\s*\{\s*destination,\s*\.\.\.rest\s*\}\s*=\s*validatedParams/,
    "destination must be destructured OUT of the payload — the extension has no use for it and shipping it would imply the extension honours it",
  );
  assert.doesNotMatch(
    codeOnly(bgSrc),
    /X-Unibrowse-Destination/,
    "a destination header would do nothing on off-LAN browsers, which cannot be updated — that is why this is server-side",
  );
});

/**
 * ── the HTML guard reports an observation, not a cause ───────────────────────
 *
 * The guard itself is correct and load-bearing: a login wall answers 200 with
 * HTML, and storing that as a PDF looks like success on every axis the caller
 * can see. What was wrong was the sentence attached to it — it called the body
 * "almost certainly a login or consent page".
 *
 * MEASURED 2026-09-13 on mgb.ellucid.com: the session was fine and the page
 * rendered; it is a document VIEWER that is HTML by design. The wording sent a
 * seat off to re-authenticate a session that had never broken. The two causes
 * need opposite responses, so naming the likelier one as near-certain is worse
 * than naming neither.
 */
test("the HTML refusal does not assert an unmeasured cause", () => {
  const code = codeOnly(bgSrc);
  assert.doesNotMatch(
    code,
    /almost certainly a login or consent page/,
    "this wording asserts a cause the check cannot observe, and it demonstrably misdirected a seat",
  );
  assert.match(
    code,
    /fetch returned HTML \(\$\{contentType\}\) for \$\{data\.url\}, not a document/,
    "the message must lead with what was actually observed",
  );
  for (const branch of [/login or consent page/, /document viewer/]) {
    assert.match(
      code,
      branch,
      "both causes must be named — one means re-authenticate, the other means go find the embedded resource, and the caller cannot pick without being told there is a choice",
    );
  }
});

test("allowHtml gates the guard and defaults to refusing", () => {
  assert.match(
    codeOnly(bgSrc),
    /\/\^text\\\/html\/i\.test\(contentType\)[\s\S]{0,120}&&\s*!data\.allowHtml/,
    "the override must be part of the guard condition, and being falsy by default is what keeps the refusal the default",
  );
  assert.match(
    codeOnly(schemaSrc),
    /allowHtml:\s*z\s*\.boolean\(\)\s*\.optional\(\)/,
    "a flag the extension honours but the schema does not declare is unreachable through the tool",
  );
});
