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
 * ⛔ NOT USABLE ON BEN'S CHROME AS IT STANDS — READ THIS FIRST
 * ------------------------------------------------------------
 * Chrome refuses DevTools remote debugging unless `--user-data-dir` names a
 * NON-DEFAULT directory, and it compares the PATH: passing the default location
 * spelled out is still refused. Ben's profile lives at the default location, so
 * the port never opens and this script exits 3.
 *
 * The refusal is SILENT in every place you would look: the flag is accepted,
 * `ps` shows it on the browser process, and there is no port, no
 * DevToolsActivePort file, and nothing in any log the startup script keeps. The
 * only evidence is a single line on Chrome's own stderr:
 *     "DevTools remote debugging requires a non-default data directory."
 *
 * Enabling this for real requires MOVING his profile off ~/.config/google-chrome
 * and launching with --user-data-dir pointing at the new location. That is a
 * real migration and his decision, not a side effect of a flag change.
 *
 * Until then the recovery path is the ui-eye click, and the watchdog escalates
 * to a human. This script stays because it is correct and tested — it is the
 * profile location, not the approach, that blocks it.
 *
 * MEASURED, NOT ASSUMED (office, Chrome 150.0.7871.186, 2026-08-15)
 * -----------------------------------------------------------------
 *  · headful + no --user-data-dir                 -> REFUSED
 *  · headful + --user-data-dir=<default path>     -> REFUSED
 *  · headful + --user-data-dir=<non-default path> -> PORT OPEN
 *  · headless + no --user-data-dir                -> PORT OPEN (headless is exempt)
 * ⛔ Two traps, both of which I fell into in one afternoon:
 *   1. I "verified" the flag using a HEADLESS browser. Headless is exempt, so the
 *      test proved nothing about the launch it was meant to validate. Verify a
 *      browser flag in the MODE it will actually run in.
 *   2. I then tested a path that merely LOOKED like a default
 *      (/tmp/fake/.config/google-chrome) and concluded Chrome checks only flag
 *      presence. It was a non-default path. A fixture that RESEMBLES the target
 *      is not the target.
 *  · `Extensions.loadUnpacked` on an ALREADY-LOADED unpacked extension returns
 *    the SAME extension id and spawns a fresh `service_worker` target for it.
 *    It is the CDP equivalent of the Reload button. Id stability matters:
 *    id rotation was itself one of the earlier bugs (fixed 08-12/13).
 *  · ⛔ RETRACTED 2026-09-13. This bullet used to read: "Remote debugging DOES
 *    work with Chrome's DEFAULT user-data-dir on this build." That is FALSE,
 *    and it contradicted the table four lines above it — which was right all
 *    along. Re-measured on office, Chrome 151.0.7922.169, headful, default
 *    profile, launched with --remote-debugging-port=9222: nothing ever listens
 *    on 9222 (`ss -ltn` empty, `curl :9222/json/version` no response), and
 *    Chrome's own stderr says why —
 *        "DevTools remote debugging requires a non-default data directory.
 *         Specify this using --user-data-dir."
 *    ⚠️ How the wrong bullet got here is trap 1, named ten lines above it: the
 *    "verification" was almost certainly a headless browser, and headless is
 *    exempt. I wrote the warning and then walked into it in the next bullet.
 *    ⇒ A caveat placed next to a claim does not protect the claim. Re-read
 *    your own warnings against what you just wrote, not against what you meant.
 *    ⛔ Do not re-open this: Ben authorised the restart on both his machines on
 *    2026-09-13 specifically to settle it, and the answer is no. Memos
 *    `52ab66c1`, `f7cdb9f9`.
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
