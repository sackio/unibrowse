/**
 * The nonce is the only thing guarding the collect endpoint, because that
 * endpoint cannot require an API key — the extension fetches it before it has
 * registered. So these are the properties the design rests on, asserted.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { stageProxyAuth, collectProxyAuth, validateProxyAuth, proxyAuthCollected } from "../../src/utils/proxy-auth.ts";

const AUTH = { username: "u", password: "p", proxy: "http://10.0.0.1:8888" };

test("a staged credential is collectable exactly once", () => {
  const nonce = stageProxyAuth("ext_a", AUTH);
  assert.deepEqual(collectProxyAuth("ext_a", nonce), AUTH);
  // ⛔ A second collect must fail: a replayable nonce is a credential that can
  // be read by anyone who saw the seed URL in a history file or an access log.
  assert.equal(collectProxyAuth("ext_a", nonce), null);
});

test("the wrong nonce, and the wrong eid, both get nothing", () => {
  const nonce = stageProxyAuth("ext_b", AUTH);
  assert.equal(collectProxyAuth("ext_b", "0".repeat(nonce.length)), null);
  assert.equal(collectProxyAuth("ext_other", nonce), null);
  // and the real one still works — a failed attempt must not burn the nonce,
  // or one stray probe would lock a profile out of its own proxy
  assert.deepEqual(collectProxyAuth("ext_b", nonce), AUTH);
});

test("a relaunch replaces the lease rather than leaving both answerable", () => {
  const first = stageProxyAuth("ext_c", AUTH);
  const second = stageProxyAuth("ext_c", { ...AUTH, password: "p2" });
  assert.notEqual(first, second);
  // ⛔ The old nonce must be dead: answering it would authenticate the new
  // launch against the previous exit, which presents as a proxy fault.
  assert.equal(collectProxyAuth("ext_c", first), null);
  assert.equal(collectProxyAuth("ext_c", second)?.password, "p2");
});

test("nonces are not guessable or reused across profiles", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(stageProxyAuth(`ext_${i}`, AUTH));
  assert.equal(seen.size, 200);
  for (const n of seen) assert.match(n, /^[0-9a-f]{32}$/);
});

test("a credential that cannot survive a header is refused, not cleaned up", () => {
  assert.throws(() => validateProxyAuth({ username: "u\r\nX-Evil: 1", password: "p" }, AUTH.proxy),
                /newline or NUL/);
  assert.throws(() => validateProxyAuth({ username: "u", password: "p\n" }, AUTH.proxy),
                /newline or NUL/);
  assert.throws(() => validateProxyAuth({ username: "u", password: "p" }, undefined),
                /nothing to authenticate to/);
  assert.throws(() => validateProxyAuth({ username: "", password: "p" }, AUTH.proxy),
                /username is required/);
  assert.deepEqual(validateProxyAuth({ username: "u", password: "p" }, AUTH.proxy), AUTH);
});

test("collected is observable, and distinguishes 'never staged' from 'not yet fetched'", () => {
  // ⭐ browser_stage_proxy_auth reports success on this and nothing else: a
  // staged lease and an opened seed page both succeed whether or not the
  // browser could reach this server, so without a server-side flag the tool
  // would report a working lane for a browser that 407s on every request.
  assert.equal(proxyAuthCollected("ext_never"), null);
  const nonce = stageProxyAuth("ext_d", AUTH);
  assert.equal(proxyAuthCollected("ext_d"), false);
  collectProxyAuth("ext_d", nonce);
  assert.equal(proxyAuthCollected("ext_d"), true);
});

test("a failed collect does not look like a successful one", () => {
  const nonce = stageProxyAuth("ext_e", AUTH);
  collectProxyAuth("ext_e", "f".repeat(nonce.length));
  // ⛔ Still false. If a wrong nonce flipped this, the staging tool would wait
  // out its poll and then report success on somebody else's failed probe.
  assert.equal(proxyAuthCollected("ext_e"), false);
});
