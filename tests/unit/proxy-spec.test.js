import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProxySpec, buildProxyBypassList, proxyHostFromUrl } from "../../src/utils/proxy-spec.ts";

test("a bare host:port and a schemed spec both normalise", () => {
  assert.equal(parseProxySpec("127.0.0.1:18889"), "127.0.0.1:18889");
  assert.equal(parseProxySpec("http://172.17.0.1:18889"), "http://172.17.0.1:18889");
  assert.equal(parseProxySpec("socks5://10.0.0.5:1080"), "socks5://10.0.0.5:1080");
  assert.equal(parseProxySpec("  http://127.0.0.1:18889  "), "http://127.0.0.1:18889");
  assert.equal(parseProxySpec("HTTP://127.0.0.1:18889"), "http://127.0.0.1:18889");
});

test("⛔ credentials are REFUSED — a command line is world-readable via ps", () => {
  assert.throws(() => parseProxySpec("http://user:pass@127.0.0.1:18889"), /credentials/);
});

test("⛔ a value that would be read as another chromium flag is REFUSED", () => {
  assert.throws(() => parseProxySpec("--headless"), /may not start with '-'/);
});

test("⛔ shell/argv metacharacters are REFUSED", () => {
  for (const bad of ["127.0.0.1:1 --foo", "127.0.0.1:1;rm -rf /", "127.0.0.1:1|x", "`id`:80"]) {
    assert.throws(() => parseProxySpec(bad), /forbidden characters|not a hostname/);
  }
});

test("a port is mandatory, numeric and in range — a reroll is not port-stable, so a missing one must not pass", () => {
  assert.throws(() => parseProxySpec("http://127.0.0.1"), /must include a port/);
  assert.throws(() => parseProxySpec("http://127.0.0.1:abc"), /numeric|not a hostname/);
  assert.throws(() => parseProxySpec("http://127.0.0.1:0"), /out of range/);
  assert.throws(() => parseProxySpec("http://127.0.0.1:70000"), /out of range/);
});

test("an unknown scheme and a path are REFUSED", () => {
  assert.throws(() => parseProxySpec("ftp://127.0.0.1:21"), /scheme must be one of/);
  assert.throws(() => parseProxySpec("http://127.0.0.1:8080/proxy"), /no path/);
});

test("empty and non-string specs are REFUSED rather than defaulted", () => {
  for (const bad of ["", "   ", undefined, null, 8080, {}]) {
    assert.throws(() => parseProxySpec(bad), /non-empty string/);
  }
});

test("an IPv6 literal keeps its brackets", () => {
  assert.equal(parseProxySpec("http://[2001:db8::1]:3128"), "http://[2001:db8::1]:3128");
});

test("⛔ the mcp-server host is in the default bypass list — a killswitch VPN blocks LAN egress, so proxying the extension's own socket FAILS it", () => {
  const list = buildProxyBypassList(undefined, "ws://mcp-server:9010/ws");
  assert.ok(list.split(";").includes("mcp-server"), list);
  assert.ok(list.includes("127.0.0.1"));
  assert.ok(list.includes("192.168.0.0/16"));
});

test("⛔ a caller override REPLACES the defaults but can NEVER drop the server host", () => {
  const list = buildProxyBypassList("example.com", "ws://mcp-server:9010/ws");
  assert.deepEqual(list.split(";"), ["example.com", "mcp-server"]);
  assert.ok(!list.includes("192.168.0.0/16"), "override replaces, it does not merge");
});

test("the server host is not duplicated when the caller already listed it", () => {
  const list = buildProxyBypassList("mcp-server;example.com", "ws://mcp-server:9010/ws");
  assert.equal(list.split(";").filter((x) => x === "mcp-server").length, 1);
});

test("an unreadable or absent serverHint degrades to the list without it, not to a throw", () => {
  assert.ok(buildProxyBypassList(undefined, undefined).includes("127.0.0.1"));
  assert.ok(buildProxyBypassList(undefined, "not a url").includes("127.0.0.1"));
  assert.equal(proxyHostFromUrl("not a url"), "");
  assert.equal(proxyHostFromUrl(undefined), "");
  assert.equal(proxyHostFromUrl("ws://mcp-server:9010/ws"), "mcp-server");
  assert.equal(proxyHostFromUrl("https://10.1.2.3:9010"), "10.1.2.3");
});
