import assert from "node:assert/strict";
import test from "node:test";
import { listSidecars, sidecarByName } from "../../src/utils/sidecars.ts";

test("one sidecar configured behaves exactly as before", () => {
  process.env.UNIBROWSE_CHROMIUM_HOST = "http://chromium-host:9020/";
  delete process.env.UNIBROWSE_CHROMIUM_HOST_CHROME;
  assert.deepEqual(listSidecars(), [{ name: "alpine", url: "http://chromium-host:9020" }]);
  assert.equal(sidecarByName(undefined)?.name, "alpine");
  // ⛔ asking for the one that is not configured must REFUSE, never fall back
  assert.throws(() => sidecarByName("chrome"), /not configured/);
});

test("both configured: default is still the first", () => {
  process.env.UNIBROWSE_CHROMIUM_HOST = "http://chromium-host:9020";
  process.env.UNIBROWSE_CHROMIUM_HOST_CHROME = "http://chromium-host-chrome:9020";
  assert.equal(sidecarByName(undefined)?.name, "alpine");
  assert.equal(sidecarByName("chrome")?.url, "http://chromium-host-chrome:9020");
});

test("none configured is null, not a guess", () => {
  delete process.env.UNIBROWSE_CHROMIUM_HOST;
  delete process.env.UNIBROWSE_CHROMIUM_HOST_CHROME;
  assert.deepEqual(listSidecars(), []);
  assert.equal(sidecarByName(undefined), null);
});

test("a deployment-named sidecar is selectable and does NOT become the default", () => {
  // ⛔ The second half is the load-bearing one. The first entry is what a launch
  // that names no sidecar gets, so if UNIBROWSE_SIDECARS were prepended, every
  // existing unnamed caller would silently move to another machine. Appended.
  process.env.UNIBROWSE_CHROMIUM_HOST = "http://chromium-host:9020";
  process.env.UNIBROWSE_CHROMIUM_HOST_CHROME = "http://chromium-host-chrome:9020";
  process.env.UNIBROWSE_SIDECARS =
    '[{"name":"k8s","url":"http://10.152.183.194:9020"}]';
  try {
    assert.equal(sidecarByName(undefined)?.name, "alpine");
    assert.equal(sidecarByName("k8s")?.url, "http://10.152.183.194:9020");
    assert.deepEqual(listSidecars().map((s) => s.name), ["alpine", "chrome", "k8s"]);
    // and an unknown name still refuses rather than falling back to the default
    assert.throws(() => sidecarByName("barn"), /not configured/);
  } finally {
    delete process.env.UNIBROWSE_SIDECARS;
  }
});

test("a sidecar off mcp-server's network carries its own serverHint", () => {
  // ⛔ WHY THIS IS A TEST AND NOT A COMMENT. The hint ends up in the
  // /__unibrowse_seed URL handed to the sidecar, and a browser that cannot
  // fetch that page does not fail -- it comes up, loads the extension, and
  // silently never registers. There is no error anywhere to notice, so the
  // only place this can be caught is here.
  process.env.UNIBROWSE_CHROMIUM_HOST = "http://chromium-host:9020";
  delete process.env.UNIBROWSE_CHROMIUM_HOST_CHROME;
  process.env.UNIBROWSE_SIDECARS =
    '[{"name":"k8s","url":"http://10.152.183.194:9020","serverHint":"ws://192.168.1.199:9010/ws"}]';
  try {
    assert.equal(sidecarByName("k8s")?.serverHint, "ws://192.168.1.199:9010/ws");
    // the on-network sidecars stay undefined, i.e. they keep the global default
    assert.equal(sidecarByName("alpine")?.serverHint, undefined);
  } finally {
    delete process.env.UNIBROWSE_SIDECARS;
  }
});

test("a malformed serverHint REFUSES rather than launching a blind browser", () => {
  process.env.UNIBROWSE_CHROMIUM_HOST = "http://chromium-host:9020";
  // an http:// url is the likely typo, and swapping ws->http on it yields
  // something that is not the seed base at all
  process.env.UNIBROWSE_SIDECARS =
    '[{"name":"k8s","url":"http://10.152.183.194:9020","serverHint":"http://192.168.1.199:9010"}]';
  try {
    assert.throws(() => listSidecars(), /serverHint must be a ws/);
  } finally {
    delete process.env.UNIBROWSE_SIDECARS;
  }
});
