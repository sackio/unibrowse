#!/usr/bin/env node
/**
 * unibrowse-extension-reload — revive the unibrowse extension over CDP,
 * without a human clicking Reload on chrome://extensions.
 *
 * WHY
 * ---
 * When Chrome tears the extension's service worker down, NOTHING inside the
 * extension can bring it back: the keepalive alarm, onStartup and autoConnect
 * all live in the worker, and Chrome only restarts a worker in order to
 * deliver it an event. In that state there are no events, so none of our code
 * runs. The extension cannot resurrect itself by construction — which is why
 * Ben has had to hand-click Reload at least three times (08-12, 08-14, 08-15)
 * and finally asked why it keeps happening.
 *
 * The ui-eye click path works but is not automation: ui-eye REFUSES to click
 * while the operator is touching the keyboard (correctly — a script that
 * fights the operator for the mouse is worse than one that waits). On 08-15
 * that guard blocked both unibrowse and ui-eye and Ben clicked it himself.
 *
 * This path has no such constraint.
 *
 * MEASURED, NOT ASSUMED (office, Chrome 150.0.7871.186, 2026-08-15)
 * -----------------------------------------------------------------
 *  · `Extensions.loadUnpacked` on an ALREADY-LOADED unpacked extension returns
 *    the SAME extension id and spawns a fresh `service_worker` target for it.
 *    It is the CDP equivalent of the Reload button. Id stability matters:
 *    id rotation was itself one of the earlier bugs (fixed 08-12/13).
 *  · Remote debugging DOES work with Chrome's DEFAULT user-data-dir on this
 *    build. I expected the Chrome 136+ restriction to block it and tested
 *    instead of assuming; it did not apply. (The port takes ~5s to come up —
 *    a probe at 5s can miss it and read as "refused".)
 *  · ⚠️ `Schema.getDomains` reports the Extensions domain as ABSENT on the very
 *    connection where these calls succeed. Do NOT feature-detect with it —
 *    it produces a false negative. Try the call.
 *
 * ⛔ UNVERIFIED, AND IT IS THE CASE THAT MATTERS
 * ----------------------------------------------
 * Everything above was measured against a HEALTHY worker on a throwaway
 * Chrome. It has NOT been proven against an extension Chrome has genuinely
 * torn down — which is the only state this script exists for. It is plausible
 * (loadUnpacked re-reads from disk) but unproven. The first real drop is the
 * experiment. If it fails there, say so plainly rather than concluding the
 * script is broken: falling back to the ui-eye click is a correct outcome,
 * not a defeat.
 *
 * USAGE
 *   node scripts/unibrowse-extension-reload.mjs [--port 9222] [--path <extdir>]
 * Exit 0 = reloaded and a worker appeared. 3 = no CDP port (flag missing or
 * Chrome not started with it). 1 = reachable but reload failed.
 */
import WebSocket from "ws";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = arg("port", process.env.UNIBROWSE_CDP_PORT || "9222");
const EXT_PATH = arg("path", process.env.UNIBROWSE_EXT_PATH || "/mnt/nas/data/code/unibrowse/extension");
const TIMEOUT_MS = 10000;

const die = (code, msg) => { console.error(msg); process.exit(code); };

let version;
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(5000) });
  version = await r.json();
} catch (e) {
  // Distinguish "no debugging port" from "reload failed". They need different
  // fixes — the first is a launch-flag problem, the second is a CDP problem —
  // and conflating them sends the reader to the wrong place.
  die(3, `[reload] no CDP on 127.0.0.1:${PORT} (${e.message}). Chrome was not started with --remote-debugging-port=${PORT}. This takes effect only at browser startup; it cannot be turned on live.`);
}

const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const workerTargets = [];
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ timeout: true }); } }, TIMEOUT_MS);
  });

ws.on("message", (m) => {
  const d = JSON.parse(m);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === "Target.targetCreated") workerTargets.push(d.params.targetInfo);
});

await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });

// Watch for the worker to appear, so success is OBSERVED rather than inferred
// from loadUnpacked returning an id. The id comes back either way.
await send("Target.setDiscoverTargets", { discover: true });
await new Promise((r) => setTimeout(r, 400));
workerTargets.length = 0; // drop the initial inventory burst

const res = await send("Extensions.loadUnpacked", { path: EXT_PATH });
const extId = res.result?.id;
if (!extId) {
  ws.close();
  die(1, `[reload] Extensions.loadUnpacked failed: ${JSON.stringify(res.error || res)}`);
}

// Give the worker a moment to spawn.
await new Promise((r) => setTimeout(r, 3000));
const revived = workerTargets.some((t) => t.url?.includes(extId) && t.type === "service_worker");
const all = await send("Target.getTargets");
const nowPresent = (all.result?.targetInfos || []).some(
  (t) => t.type === "service_worker" && t.url?.includes(extId),
);
ws.close();

if (revived || nowPresent) {
  console.log(`[reload] OK — extension ${extId} reloaded, service worker running`);
  process.exit(0);
}
// A worker that started and went idle again inside the 3s window would look
// identical to one that never started. Report the ambiguity rather than
// claiming either — the caller re-probes /extensions, which is the real test.
console.log(`[reload] extension ${extId} reloaded, but no service_worker target observed within 3s. It may have started and gone idle. Re-probe /extensions to decide.`);
process.exit(0);
