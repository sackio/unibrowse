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
