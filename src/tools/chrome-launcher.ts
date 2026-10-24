import { spawn, execSync, type ChildProcess } from "child_process";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
// ⚠️ Its own module so the unit tests can import it: this file imports the
// "@/types" path alias, which the bare `node --test` runner cannot resolve.
import { sweepDeadProfiles } from "../utils/dead-profiles.ts";
import { parseProxySpec, buildProxyBypassList } from "../utils/proxy-spec.ts";
import { stageProxyAuth, validateProxyAuth, proxyAuthCollected } from "../utils/proxy-auth.ts";
import { listSidecars, sidecarByName, sidecarFor, type Sidecar } from "../utils/sidecars.ts";
import { profileNameForExtensionId } from "../utils/profile-identity.ts";
import { fileURLToPath } from "url";
import { LaunchIsolatedChromeTool, CloseIsolatedChromeTool, StageProxyAuthTool } from "@/types/tool-schemas";
import { textResponse, errorResponse, jsonResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

// __dirname is not defined in ESM bundles; recompute it from the module URL.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Read (or mint) the stable extensionId for a profile.
 *
 * ⛔ Stored OUTSIDE profileDir, in a sibling registry directory keyed by
 * profile name. The first version of this put the file at
 * <profileDir>/.unibrowse-identity.json, reasoning that the wipe only clears
 * Default/* so a sibling of Default/ was safe. That is true of
 * wipeStaleExtensionData — and false of freshProfile, which `rmSync`s the
 * ENTIRE profileDir. freshProfile DEFAULTS TO TRUE, so the common path
 * deleted the identity every launch and the id rotated exactly as before.
 *
 * Caught by launching the same profile twice and comparing the ids, which is
 * the only check that would have caught it: the code was correct about the
 * wipe it was written against, and there were two wipes.
 *
 * Keyed on profileName rather than on anything the browser generates —
 * profileName is the stable handle a caller already uses to mean "this
 * browser", so the id it addresses should track it. Returns null rather than
 * throwing: a missing or unwritable mount degrades to mint-on-first-run and
 * must never block a launch.
 */
function stableExtensionIdFor(profileName?: string | null): string | null {
  if (!profileName) return null;
  const roots = [
    "/app/.chrome-profiles",
    path.resolve(__dirname, "..", "..", ".chrome-profiles"),
  ];
  const root = roots.find(r => fs.existsSync(r));
  if (!root) return null;
  // Flatten to a safe filename — profile names are caller-supplied.
  const key = profileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(root, ".unibrowse-identities", `${key}.json`);
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed?.extensionId) return String(parsed.extensionId);
    }
  } catch { /* corrupt → re-mint below */ }
  try {
    const id = `ext_${randomUUID()}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(
      { extensionId: id, profileName, mintedAt: new Date().toISOString() }, null, 2));
    return id;
  } catch {
    return null;
  }
}

/**
 * Track spawned Chrome processes
 */
const launchedProcesses = new Map<number, ChildProcess>();

/**
 * Track spawned Xvfb processes alongside their chromiums so we can reap them
 * together on shutdown — orphan Xvfb's leave stale /tmp/.X11-unix/X* sockets
 * that block display-number reuse.
 */
const launchedXvfbs = new Map<number, ChildProcess>();

/**
 * SIGTERM/SIGINT handler — when docker compose restart sends SIGTERM, give
 * each spawned chromium up to 5s to shut down gracefully so the persistent
 * profile gets `exit_type: Normal` (no Restore Pages dialog next launch).
 * Without this, docker's 10s grace expires and the cgroup gets SIGKILL'd,
 * leaving every profile with `exit_type: Crashed`. Idempotent: only the
 * first signal triggers cleanup.
 */
let shuttingDown = false;
const installSignalHandlers = () => {
  const shutdown = (sig: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[chrome-launcher] Received ${sig}, gracefully closing ${launchedProcesses.size} spawned chromium(s)...`);
    for (const [pid, proc] of launchedProcesses) {
      try {
        // SIGTERM to chromium triggers its own clean-shutdown path (writes
        // Normal exit_type, flushes session). Give it up to 5s.
        proc.kill("SIGTERM");
        console.log(`[chrome-launcher] SIGTERM → chromium pid ${pid}`);
      } catch (e) {
        console.warn(`[chrome-launcher] Failed to SIGTERM chromium pid ${pid}:`, (e as Error).message);
      }
    }
    for (const [pid, proc] of launchedXvfbs) {
      try { proc.kill("SIGTERM"); } catch { /* best-effort */ }
      console.log(`[chrome-launcher] SIGTERM → Xvfb pid ${pid}`);
    }
    // Don't process.exit here — let the parent node process complete its
    // own shutdown. Chromiums get up to ~5s before docker's SIGKILL anyway.
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
};
installSignalHandlers();

/**
 * One-time startup cleanup — wipe stale state from previous container
 * incarnations that may block this launcher's first use:
 *  - Stale SingletonLock / SingletonSocket / SingletonCookie symlinks in
 *    each profile dir, left behind when chromium was SIGKILL'd. The lock
 *    points at a hostname:pid that no longer exists, but chromium will
 *    refuse to launch ("profile is in use") until the lock is gone.
 *  - Stale /tmp/.X11-unix/X* sockets from killed Xvfb's, which can collide
 *    with newly-picked display numbers.
 */
let startupCleanupDone = false;
const runStartupCleanup = () => {
  if (startupCleanupDone) return;
  startupCleanupDone = true;
  const cleaned: string[] = [];
  // Profiles live next to extension dir; probe candidate roots.
  const profileRoots = [
    "/app/.chrome-profiles",
    path.resolve(__dirname, "..", "..", ".chrome-profiles"),
  ];
  for (const root of profileRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      for (const profile of fs.readdirSync(root)) {
        for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
          const p = path.join(root, profile, lock);
          try {
            if (fs.lstatSync(p)) {
              fs.unlinkSync(p);
              cleaned.push(p);
            }
          } catch { /* not present, skip */ }
        }
      }
    } catch { /* root unreadable, skip */ }
  }
  // Stale X11 sockets
  const xUnixDir = "/tmp/.X11-unix";
  if (fs.existsSync(xUnixDir)) {
    try {
      for (const f of fs.readdirSync(xUnixDir)) {
        if (!/^X\d+$/.test(f)) continue;
        const p = path.join(xUnixDir, f);
        try { fs.unlinkSync(p); cleaned.push(p); } catch { /* socket in use */ }
      }
    } catch { /* skip */ }
  }
  if (cleaned.length) {
    console.log(`[chrome-launcher] Startup cleanup: removed ${cleaned.length} stale lock/socket(s): ${cleaned.slice(0, 5).join(", ")}${cleaned.length > 5 ? "…" : ""}`);
  }
};

/**
 * Profile self-heal: chromium writes `exit_type: "Crashed"` to
 * Default/Preferences if it didn't shut down cleanly. On next launch it
 * shows a "Restore pages?" infobar on the FIRST page load — which can
 * dismiss programmatic navigations and hide auth forms. Patch the marker
 * to "Normal" before chromium starts, so the user-visible page is the
 * one we asked for.
 */
const selfHealProfile = (profileDir: string) => {
  const prefsPath = path.join(profileDir, "Default", "Preferences");
  if (!fs.existsSync(prefsPath)) return;
  try {
    const raw = fs.readFileSync(prefsPath, "utf8");
    const prefs = JSON.parse(raw);
    let dirty = false;
    if (prefs?.profile?.exit_type && prefs.profile.exit_type !== "Normal") {
      prefs.profile.exit_type = "Normal";
      dirty = true;
    }
    if (prefs?.profile?.exited_cleanly === false) {
      prefs.profile.exited_cleanly = true;
      dirty = true;
    }
    if (dirty) {
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
      console.log(`[chrome-launcher] Self-healed profile exit markers at ${prefsPath}`);
    }
  } catch (e) {
    console.warn(`[chrome-launcher] Profile self-heal failed (${prefsPath}):`, (e as Error).message);
  }
};

/**
 * Chromium-host sidecar client. POSTs the launch request to the side
 * container's HTTP RPC, then polls the local extension registry (same as
 * the in-process path) for the newly-registered extensionId so the caller
 * can pin subsequent tool calls. Server URL is passed as `serverHint` so
 * the sidecar can write a managed-server.json into the profile and the
 * extension's resolver knows where to reach this mcp-server.
 */
async function launchViaChromiumHost(
  context: any,
  params: any,
  sidecar: Sidecar,
  max_tokens: number | undefined,
): Promise<any> {
  // ⚠️ The whole Sidecar, not just its url: where a browser dials back to is
  // per-sidecar (see Sidecar.serverHint), and threading one more scalar is how
  // the next per-sidecar field gets forgotten.
  const hostUrl = sidecar.url;
  const validatedParams = LaunchIsolatedChromeTool.shape.arguments.parse(params);
  const preLaunchExtensionIds = new Set(
    context.listExtensions?.().map((e: any) => e.extensionId) ?? [],
  );

  // The sidecar shares the chrome-profiles bind mount so profileName resolves
  // the same on both sides; we just hand it the validated args.
  // Prepend the seed bootstrap URL so the extension's unibrowse-seed.js
  // content script writes the right server config to chrome.storage BEFORE
  // background.js's resolveServerConfig probes for it. Without this, the
  // sidecar chromium would default to localhost:9010 (its own container,
  // not the mcp-server). The HTTP route at /__unibrowse_seed is served by
  // the same mcp-server we want the extension to connect to.
  // ⛔ PER-SIDECAR FIRST. The fallbacks are a compose service name, which is
  // correct for a sidecar on mcp-server's own docker network and meaningless
  // anywhere else — a sidecar off that network MUST carry its own serverHint or
  // its browsers come up unable to find this server. Full mechanism, and the
  // 2026-10-24 measurement, on Sidecar.serverHint in src/utils/sidecars.ts.
  const wsHint = sidecar.serverHint
    || process.env.UNIBROWSE_CHROMIUM_SERVER_HINT
    || "ws://mcp-server:9010/ws";
  const httpHint = wsHint.replace(/^ws/, "http").replace(/\/ws$/, "");
  // Carry a STABLE per-profile extensionId through the seed. Relaunching a
  // profile wipes Default/Local Extension Settings (that is deliberate — stale
  // extension state is what breaks a reused profile), but chrome.storage.local
  // is exactly where the extension keeps __unibrowseExtensionId. So every
  // relaunch minted a brand-new identity: measured 2026-08-12, ha's
  // ecobee-broker produced 1,329 distinct extensionIds in 26 hours.
  //
  // ⭐ That turns a retry into a trap. ha's integration relaunched the broker
  // whenever it could not find a registered broker extension — and the
  // relaunch is what destroyed the id the next poll went looking for, so it
  // could never converge. The wipe list's own comment claimed the seed
  // "re-populates" this; the seed repopulated the SERVER config but never the
  // identity, so "stable" held only until the next relaunch.
  //
  // The id lives at <profileDir>/.unibrowse-identity.json — a sibling of
  // Default/, so the wipe cannot reach it.
  const stableExtId = stableExtensionIdFor(validatedParams.profileName);
  const proxySpec = (validatedParams as any).proxy
    ? parseProxySpec((validatedParams as any).proxy)
    : undefined;
  // ⛔ A proxy password NEVER goes on this URL. The seed page is a real
  // navigation: its URL lands in that profile's history, in this server's
  // access log, and in any Referer the page emits. So the URL carries a
  // single-use NONCE and the extension exchanges it for the credentials over
  // the LAN, body-only. See src/utils/proxy-auth.ts.
  let proxyAuthNonce: string | null = null;
  if ((validatedParams as any).proxyAuth) {
    if (!stableExtId) {
      throw new Error(
        "proxyAuth needs a stable extension id to deliver to, and this profile has none. " +
        "⇒ Launch a named persistent profile; an ephemeral one has no identity to key credentials to.",
      );
    }
    proxyAuthNonce = stageProxyAuth(
      stableExtId,
      validateProxyAuth((validatedParams as any).proxyAuth, proxySpec),
    );
  }
  const seedUrl = `${httpHint}/__unibrowse_seed?ws=${encodeURIComponent(wsHint)}&http=${encodeURIComponent(httpHint)}`
    + (stableExtId ? `&eid=${encodeURIComponent(stableExtId)}` : "")
    + (proxyAuthNonce ? `&pa=${proxyAuthNonce}` : "");
  const userUrls = validatedParams.url
    ? (Array.isArray(validatedParams.url) ? validatedParams.url : [validatedParams.url])
    : ["chrome://extensions/"];
  // ⚠️ `userUrls` is NOT evidence the caller asked for anything — with no `url`
  //   it holds this launcher's own default. Measured 2026-10-22: a launch with
  //   no url timed out and the timeout branch told the caller its "requested
  //   URL" had not opened, naming a URL the caller never sent. Same failure
  //   class as the one that branch exists to fix, one level up: a message that
  //   calls our own default the caller's request.
  const urlWasRequested = !!validatedParams.url;
  // Semantic upgrade when routing through the sidecar: `headless: true`
  // historically meant `--headless=new` (lightweight but anti-bot-detectable).
  // For the sidecar, treat `headless: true` as "isolated, no user window
  // pollution" instead — which the sidecar already provides via its own
  // container. Inside the sidecar we spin up Xvfb-headful so the chromium
  // looks like a real browser to Auth0/Cloudflare/Akamai. Callers who
  // genuinely need the lighter --headless=new path can pass
  // `realHeadless: true` to opt back into it. This makes
  // `browser_launch_isolated_chrome({headless: true})` the right default
  // for headless-mode agents without them having to know about Xvfb.
  const useXvfbForHeadless = !(validatedParams as any).realHeadless;
  const innerHeadless = !!validatedParams.headless && !useXvfbForHeadless;
  // Default autoAttach behavior: when caller supplied a URL (or array of URLs),
  // open them via browser_create_tab AFTER the extension registers — this gives
  // each user URL an auto-attached debugger session that the agent can drive
  // immediately. The seed URL is the ONLY thing on chrome's command line so
  // it can run the bootstrap content script + write the server config to
  // chrome.storage before the user URLs land. Old behavior (everything on
  // cmd line, no auto-attach) is preserved when autoAttach:false is passed.
  const autoAttach = (validatedParams as any).autoAttach !== false;
  const cmdLineUrls = autoAttach ? [seedUrl] : [seedUrl, ...userUrls];
  const reqBody = {
    profileName: validatedParams.profileName,
    urls: cmdLineUrls,
    freshProfile: validatedParams.freshProfile !== false,
    headless: innerHeadless,
    width: validatedParams.width,
    height: validatedParams.height,
    serverHint: wsHint,
    // Persistent-profile override. The sidecar refuses to wipe a profileDir
    // on the persistent allowlist unless this NAMES the profile verbatim — a
    // bare boolean would get set once in a wrapper and inherited by every
    // later call, silently dissolving the friction it exists to create.
    forceProfileName: (validatedParams as any).forceProfileName,
    caller: (validatedParams as any).caller,
    // Scoped VPN/proxy egress for this profile only. Validated HERE as well as
    // in the sidecar: a bad spec should be refused by the process the caller is
    // talking to, not surface as a sidecar 500 two hops away.
    proxy: proxySpec,
    proxyBypassList: proxySpec ? buildProxyBypassList((validatedParams as any).proxyBypassList, wsHint) : undefined,
  };
  const launchResp = await fetch(`${hostUrl.replace(/\/$/, "")}/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!launchResp.ok) {
    const text = await launchResp.text().catch(() => "");
    // 409 = persistent-profile refusal, not a fault. Surface the sidecar's
    // message verbatim rather than wrapping it in HTTP noise — it names the
    // safe alternative, the reset cost, the owner to ask, and the override,
    // in that order, and that ordering is the whole point.
    if (launchResp.status === 409) {
      try {
        const body = JSON.parse(text);
        if (body?.message) return errorResponse(body.message, false, undefined, max_tokens);
      } catch { /* fall through to the generic form */ }
    }
    return errorResponse(
      `chromium-host /launch returned ${launchResp.status}: ${text}`,
      false, undefined, max_tokens,
    );
  }
  const launchJson = await launchResp.json() as any;
  const { pid, display, profileDir } = launchJson;

  // ⛔ POSITIVE ECHO CHECK — the sidecar is a separate container with its own
  // deploy, so mcp-server can be running proxy-aware code against a sidecar
  // that is not. It destructures named fields, which means an older one accepts
  // `proxy`, ignores it, and returns 200. The browser then comes up, every page
  // loads, and only the exit IP is wrong — the single outcome the caller cannot
  // observe, on the one feature whose entire purpose is the exit IP.
  // ⇒ Refuse rather than report success. Rebuild the sidecar; do not "fix" this
  // by trusting the request.
  if (proxySpec && launchJson?.proxy !== proxySpec) {
    return errorResponse(
      `chromium-host accepted the launch but did not apply proxy ${proxySpec} ` +
      `(echoed ${JSON.stringify(launchJson?.proxy ?? null)}). The sidecar predates proxy support, so ` +
      `this chromium is running UNPROXIED on the host's own IP — it has not been closed, close it with ` +
      `browser_close_isolated_chrome. Rebuild the chromium-host container to proceed.`,
      false, undefined, max_tokens,
    );
  }

  // Poll for the newcomer extension. Side-container path is slower than the
  // in-process path because the new chromium has to fully boot AND its
  // extension has to discover the mcp-server URL via the seed content
  // script BEFORE its background can register. Cold-boot + dirty-profile
  // restore can push past the legacy 15s window — bump to 30s. Also wait
  // a minimum of 3s before declaring success to absorb ben's-Chrome-style
  // reconnect races (where a pre-existing extension reconnects to mcp-server
  // and shows up as a newcomer briefly).
  // ⛔ 30s WAS TOO SHORT AND THE TIMEOUT LOOKED LIKE A HARD FAILURE. MEASURED
  // 2026-10-14 on office, two launches I made as controls while diagnosing
  // `apis`: registration landed at ~45s (with a proxy) and 66s (without), on
  // fresh profiles, with the sidecar running 73 chromium processes for other
  // profiles. The old 30s window expired first, the tool returned
  // `extensionId: null`, and the caller — correctly reading that as a failure —
  // CLOSED a browser that was seconds from registering, three times in a row.
  // ⚠️ The cause of the slowdown is NOT established; Chrome, Xvfb, DNS, the
  // seed page and mcp-server all checked out. So this is a wait sized to a
  // measurement, not a fix for whatever made the boot slow.
  // ⛔⛔ AND 90s WAS THE WRONG FIX — MEASURED 2026-10-14, MY OWN CLIENT KILLED THE
  // CALL. I shipped a 90s blocking wait, launched one browser through it, and got
  // "The operation timed out" from the MCP client while the chromium came up
  // fine and registered ~30s in. That is STRICTLY WORSE than the 30s timeout it
  // replaced: the old path at least returned a structured result carrying the pid
  // and the display, and a transport timeout returns NOTHING the caller can act
  // on. ⇒ THE WAIT MUST STAY WELL UNDER THE SHORTEST CLIENT TIMEOUT IN THE
  // FLEET, which we do not control and cannot enumerate.
  // ⇒ The durable half of the fix is NOT the length of this wait — it is that a
  // timeout now returns `expectedExtensionId`, `registered: false` and a message
  // saying the browser is still booting and must not be closed. Polling is the
  // caller's job and costs them one cheap GET; blocking is ours and costs the
  // whole call.
  // ⚠️ Overridable for a caller that knows its own client limit, never raised
  // here by default: the default must be safe for the seat with the TIGHTEST
  // timeout, not the one with the most patience.
  const EXT_REGISTER_WAIT_MS = Math.min(Math.max(
    Number(process.env.UNIBROWSE_EXT_REGISTER_WAIT_MS) || 25_000, 5_000), 300_000);
  let spawnedExtensionId: string | null = null;
  const deadline = Date.now() + EXT_REGISTER_WAIT_MS;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const current = context.listExtensions?.() ?? [];
    // ⭐ WE ALREADY KNOW THE ID — match on it instead of on "a newcomer
    // appeared". `stableExtId` is what we seeded into the bootstrap URL, so
    // when it registers there is nothing to disambiguate and no settle window
    // to wait out. The newcomer scan below stays for the case where no
    // identities mount exists and the id is minted browser-side.
    // ⚠️ GUARDED against the one way this can lie: relaunching a profile whose
    // PREVIOUS instance is still connected would match its id immediately and
    // report the OLD browser as the new one. So an id that was already present
    // before this launch only counts once it has re-registered.
    if (stableExtId) {
      const mine: any = current.find((e: any) => e.extensionId === stableExtId);
      if (mine && (!preLaunchExtensionIds.has(stableExtId) ||
                   (mine.registeredAt ?? 0) > startedAt)) {
        spawnedExtensionId = stableExtId;
        break;
      }
    }
    // ⛔⛔ ONLY WHEN WE DO NOT KNOW OUR OWN ID. A "newcomer" is any extension that
    // was not connected when THIS launch began, and that includes SOMEBODY
    // ELSE'S BROWSER registering while we wait. The sort below was written to
    // beat "a coincidental concurrent reconnect" and cannot: picking the most
    // recent newcomer picks the other browser just as confidently.
    //
    // MEASURED 2026-10-23 21:16, reproduced deliberately after `alpaca` reported
    // it: the captcha lane relaunches its profile on every VPN rotation, one of
    // those registrations landed inside a brand-new profile's launch window, and
    // that launch returned the LANE's extensionId. mcp-server then POSTed the id
    // onto OUR pid (below), so the sidecar listed TWO live browsers under one
    // extensionId and every call addressed to it reached whichever answered
    // first. That is how alpaca's VPN lane egressed on the house IP with
    // correct code, and how a run of 30s "WebSocket response timeout" errors
    // appeared as an mcp-server capacity problem.
    //
    // ⇒ When `stableExtId` is known it is the ONLY id that can be ours — it was
    //   seeded into this browser's own bootstrap URL. Timing out and reporting
    //   `registered: false` with `expectedExtensionId` is strictly better than
    //   adopting a stranger: the caller can retry, and nothing it does in the
    //   meantime lands in another seat's browser.
    if (!stableExtId) {
      const newcomers = current.filter((e: any) => !preLaunchExtensionIds.has(e.extensionId));
      if (newcomers.length > 0 && Date.now() - startedAt > 3_000) {
        newcomers.sort((a: any, b: any) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
        spawnedExtensionId = newcomers[0].extensionId;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Tell the sidecar which extensionId belongs to this pid, so
  // browser_close_isolated_chrome({extensionId}) can resolve it later. Stored
  // sidecar-side deliberately: mcp-server restarts are exactly when you need
  // to find an orphaned instance, so the mapping must outlive this process.
  // Best-effort — a failure here costs discoverability, not correctness.
  if (spawnedExtensionId && pid) {
    try {
      await fetch(`${hostUrl.replace(/\/$/, "")}/processes/${pid}/extension`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extensionId: spawnedExtensionId }),
      });
    } catch { /* non-fatal */ }
  }

  // Auto-attach: for each user URL, open via browser_create_tab on the
  // sidecar's extension. That handler creates the tab AND attaches the
  // debugger AND records the reservation if `agent` is supplied. The result
  // gives us the attached tabId which the agent can use immediately.
  const attachedTabIds: number[] = [];
  if (autoAttach && spawnedExtensionId && userUrls.length > 0) {
    for (const url of userUrls) {
      try {
        const createRes: any = await context.sendSocketMessage(
          "browser_create_tab",
          { url, agent: (validatedParams as any).agent },
          { extensionId: spawnedExtensionId, timeoutMs: 20_000 },
        );
        if (createRes?.tabId) attachedTabIds.push(createRes.tabId);
      } catch (e: any) {
        console.warn(`[chrome-launcher] auto-attach failed for ${url}: ${e?.message || e}`);
      }
    }
  }

  // ⛔ A TIMED-OUT REGISTRATION USED TO DROP THE CALLER'S URLS ON THE FLOOR while
  //   the response printed "URLs requested: <url>" as if they had been opened.
  //   MEASURED 2026-10-22 on `ha`'s ecobee-broker: the extension registered 182s
  //   after spawn (connectedForMs 204170 read at 04:10 against a 04:04:04 start),
  //   far past this wait, so auto-attach never ran and the consumerportal tab
  //   never existed. `ha`'s integration cannot read the warning text above — its
  //   MCP client timed the call out before the response came back — so it scored
  //   the launch dead and relaunched. ⛔ EVERY RELAUNCH REAPS THE PREVIOUS PID FOR
  //   THE SAME PROFILE ("reaping for profile ecobee-broker: tracked=[4127]" then
  //   SIGKILL), so each attempt destroyed the instance that had just become
  //   usable. With a retry cadence shorter than the registration latency that
  //   loop CANNOT converge, and it held their ecobee JWT down for over an hour.
  // ⇒ Finish the job out of band. The call still returns fast — the lesson above
  //   about blocking waits stands and is not being relitigated — but the URLs the
  //   caller asked for are opened when the extension actually registers, carrying
  //   the caller's own `agent` so the reservation lands with them and not with us.
  // ⚠️ Fire-and-forget on purpose, and deliberately not awaited: it must not be
  //   able to fail the call it belongs to, and there is no one left to report to.
  // ⚠️ It does NOT verify the pid is still the one we spawned. A caller who gave
  //   up and relaunched gets the same deterministic id, and opening their URL in
  //   that browser is still the outcome they asked for.
  // ⚠️ 300s IS NOT ALWAYS ENOUGH, MEASURED 2026-10-22 07:26-07:34 EDT ON OFFICE.
  //   A virgin sidecar profile (`bgtest-1022`) at load average 18.85 had still
  //   not registered 7 MINUTES after spawn, with `ha`'s ecobee-broker chromium
  //   (spawned 06:49) unregistered at 40+ minutes alongside it — both pids alive,
  //   neither extension ever reaching the server. So the 60-177s figures above are
  //   a floor, not a range, and on that host this window expires before the
  //   extension arrives. ⛔ Do NOT read a longer default into this: nothing has
  //   been observed to register at 8-15 minutes either, so raising it is a guess
  //   until someone measures a late registration that actually lands. The knob is
  //   there for a caller who has one. ⭐ The discriminator is whether the MV3
  //   worker ever connects at all: GET /extensions for the deterministic id, or
  //   mcp-server's "Extension registered:" line — not the pid, which stays alive
  //   either way and reads as healthy.
  const BG_COMPLETE_WAIT_MS = Math.min(Math.max(
    Number(process.env.UNIBROWSE_BG_COMPLETE_WAIT_MS) || 300_000, 0), 900_000);
  // ⛔ REGISTRATION IS THE SOCKET CONNECTING, NOT THE WORKER BEING READY, AND THE
  //   DIFFERENCE IS NOT COSMETIC. Measured 2026-10-22 on two virgin sidecar
  //   profiles: creating the tab the instant the extension appeared in
  //   `connected[]` returned a tabId and logged "opened <url>", while the tab
  //   itself came up with an EMPTY url, was never attached (no TAB_ATTACHED) and
  //   was absent from browser_list_attached_tabs — invisible to the caller who
  //   asked for it. ⇒ Let the worker settle, then READ THE TAB BACK. A create
  //   call returning a tabId is not evidence the tab carries the URL.
  const BG_SETTLE_MS = Math.min(Math.max(
    Number(process.env.UNIBROWSE_BG_SETTLE_MS) || 5_000, 0), 60_000);
  if (!spawnedExtensionId && stableExtId && autoAttach && userUrls.length > 0 && BG_COMPLETE_WAIT_MS > 0) {
    const bgExtId = stableExtId;
    const bgAgent = (validatedParams as any).agent;
    const bgDeadline = Date.now() + BG_COMPLETE_WAIT_MS;
    void (async () => {
      while (Date.now() < bgDeadline) {
        await new Promise((r) => setTimeout(r, 2_000));
        const cur = context.listExtensions?.() ?? [];
        const mine: any = cur.find((e: any) => e.extensionId === bgExtId);
        // Same guard as the foreground loop: an id that was already connected
        // before this launch only counts once it has re-registered, or we would
        // decorate the PREVIOUS instance and report it as this one.
        if (!mine) continue;
        if (preLaunchExtensionIds.has(bgExtId) && !((mine.registeredAt ?? 0) > startedAt)) continue;
        if (pid) {
          try {
            await fetch(`${hostUrl.replace(/\/$/, "")}/processes/${pid}/extension`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ extensionId: bgExtId }),
            });
          } catch { /* non-fatal: costs discoverability, not correctness */ }
        }
        await new Promise((r) => setTimeout(r, BG_SETTLE_MS));
        // ⛔ POLL — DO NOT ASK ONCE. Measured 2026-10-22: a single read-back right
        //   after the create came back empty while the tab was in fact loading, the
        //   retry fired, and the profile ended up with TWO tabs on the same URL
        //   (labels "example.com" and "example.com-2"), both attached and both
        //   reserved. A verification that is cheaper to fail than the thing it
        //   guards turns one missing tab into two unwanted ones.
        const carries = async (url: string, withinMs = 12_000): Promise<boolean> => {
          const until = Date.now() + withinMs;
          const want = url.split("#")[0];
          for (;;) {
            try {
              const list: any = await context.sendSocketMessage(
                "browser_list_tabs", {}, { extensionId: bgExtId, timeoutMs: 10_000 },
              );
              const tabs: any[] = list?.tabs ?? [];
              if (tabs.some((t: any) => typeof t?.url === "string" && t.url.startsWith(want))) return true;
            } catch { /* fall through to the retry below */ }
            if (Date.now() >= until) return false;
            await new Promise((r) => setTimeout(r, 2_000));
          }
        };
        const opened: string[] = [];
        const unverified: string[] = [];
        for (const url of userUrls) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              await context.sendSocketMessage(
                "browser_create_tab",
                { url, agent: bgAgent },
                { extensionId: bgExtId, timeoutMs: 20_000 },
              );
            } catch (e: any) {
              console.warn(`[chrome-launcher] background completion create failed for ${url} `
                + `on ${bgExtId}: ${e?.message || e}`);
            }
            if (await carries(url)) { opened.push(url); break; }
            if (attempt === 1) { await new Promise((r) => setTimeout(r, BG_SETTLE_MS)); continue; }
            unverified.push(url);
          }
        }
        console.warn(`[chrome-launcher] background completion on ${bgExtId} `
          + `(${validatedParams.profileName}, ${Math.round((Date.now() - startedAt) / 1000)}s after launch): `
          + `opened ${opened.length ? opened.join(", ") : "nothing"}`
          + (unverified.length
              ? ` — ⛔ UNVERIFIED, a tab was created but does not carry: ${unverified.join(", ")}`
              : ""));
        return;
      }
      console.warn(`[chrome-launcher] background completion gave up on ${bgExtId} `
        + `(${validatedParams.profileName}) after ${Math.round(BG_COMPLETE_WAIT_MS / 1000)}s — never registered`);
    })();
  }

  const fresh = validatedParams.freshProfile !== false;
  let message = `✓ Chrome launched via chromium-host sidecar\n`;
  message += `  Profile: ${validatedParams.profileName} ${fresh ? "(fresh - no cookies/history)" : "(persistent)"}\n`;
  message += `  Profile Directory: ${profileDir}\n`;
  message += `  Display: ${display || "(headless)"}\n`;
  message += `  PID (in chromium-host): ${pid}\n`;
  message += `  URLs requested: ${userUrls.length > 0 ? userUrls.join(", ") : "(none)"}\n`;
  if (spawnedExtensionId) {
    message += `  Extension ID: ${spawnedExtensionId}\n`;
    if (attachedTabIds.length > 0) {
      message += `  Attached tabs: ${attachedTabIds.join(", ")}\n`;
      message += `\nReady to drive — pass extensionId=${spawnedExtensionId} and tabTarget=${attachedTabIds[0]} on subsequent tool calls.`;
    } else if (autoAttach && userUrls.length > 0) {
      message += `\nExtension registered but auto-attach failed — call browser_attach_tab({autoOpenUrl, extensionId=${spawnedExtensionId}}) manually.`;
    } else {
      message += `\nPass extensionId=${spawnedExtensionId} on subsequent tool calls to pin them to this chromium.`;
    }
  } else {
    // ⛔ SAY THAT THIS IS A TIMEOUT, NOT A DEAD BROWSER, AND SAY WHAT NOT TO DO.
    // The old text ("not seen within 30s — check browser_list_attached_tabs")
    // read as a failure, and the reasonable response to a failed launch —
    // closing it and retrying — is what destroyed three browsers on 2026-10-14
    // that had already registered by the time they were killed.
    // ⛔ AND GIVE A NUMBER. The warning above said "may still be booting" with
    // no duration, so a caller who waited a couple of minutes still concluded
    // failure and reaped it — measured 2026-10-20, `apis`, twice, which also
    // sent them chasing their proxy as the cause. MEASURED the same evening on
    // office at load average 24: 4/4 launches registered, at 60s, 90s, 150s
    // and 177s. The MV3 service worker boot is what takes the minutes, so the
    // latency tracks host load, not anything about the profile or the proxy.
    message += `\n⚠️ Extension not registered within ${Math.round(EXT_REGISTER_WAIT_MS / 1000)}s. `
      + `The chromium IS running (pid ${pid}) and may still be booting — `
      + `⛔ do NOT close it and relaunch. Poll GET /extensions or `
      + `browser_list_attached_tabs`
      + (stableExtId ? ` for ${stableExtId}, which is this profile's deterministic id` : ``)
      + `, and close it only once you have decided to give up on it.`
      + `\n⚠️ ALLOW 5 MINUTES before deciding that. Registration is the MV3 service `
      + `worker booting, so it tracks host load: measured 60-177s on office at load `
      + `average 24. A browser whose pid is still alive has not failed. `
      + `Raise UNIBROWSE_EXT_REGISTER_WAIT_MS (capped 300000) to wait inside the call instead.`;
    // ⛔ SAY THAT THE URLS DID NOT OPEN. "URLs requested: <url>" above is the
    //   caller's own request echoed back, not an outcome, and on this path
    //   nothing has opened them — the auto-attach block needs a registered
    //   extension and was skipped. Measured 2026-10-22: `ha` read the launch as
    //   having produced a browser with no tab and no explanation.
    if (userUrls.length > 0) {
      message += (urlWasRequested
          ? `\n⛔ THE REQUESTED URL${userUrls.length > 1 ? "S WERE" : " WAS"} NOT OPENED — `
            + `"URLs requested" above is your request, not an outcome.`
          : `\n⚠️ NO TAB WAS OPENED — "URLs requested" above is this launcher's own default `
            + `(${userUrls.join(", ")}); you did not ask for it.`)
        + (autoAttach
            ? ` A background completion is still waiting for this profile's extension and will open `
              + `${userUrls.join(", ")} (reserved to ${(validatedParams as any).agent || "nobody"}) if it registers `
              + `within ${Math.round(BG_COMPLETE_WAIT_MS / 1000)}s of launch. Re-read browser_list_attached_tabs before opening it yourself.`
            : ` autoAttach was off, so opening it is yours.`);
    }
  }
  return jsonResponse({
    pid, profileDir,
    urls: userUrls,
    display,
    extensionId: spawnedExtensionId,
    // ⚠️ ADDITIVE, deliberately. `extensionId` keeps meaning "registered and
    // usable" — callers branch on it being non-null — so a browser that has
    // not registered yet must not be handed back through that field. The id we
    // seeded goes in its own field, and `registered` says which state we are in.
    expectedExtensionId: stableExtId,
    registered: spawnedExtensionId !== null,
    tabId: attachedTabIds[0] ?? null,
    tabIds: attachedTabIds,
    via: "chromium-host",
    message,
  }, true, max_tokens);
}

/**
 * Find Chrome executable on the system
 */
function findChromeExecutable(): string | null {
  const possiblePaths = [
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  // Try which/where commands
  try {
    const commands = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];

    for (const cmd of commands) {
      try {
        const result = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
          encoding: "utf-8",
        }).trim();
        if (result && fs.existsSync(result)) {
          return result;
        }
      } catch {
        // Continue to next command
      }
    }
  } catch {
    // Failed to find Chrome
  }

  return null;
}

/**
 * Launch Chrome in isolated mode with the Browser MCP extension
 * Creates an isolated profile separate from the user's main browser, useful for testing,
 * automation, and development. The extension will auto-connect to the MCP server.
 */
export const launchIsolatedChrome: Tool = {
  schema: {
    name: LaunchIsolatedChromeTool.shape.name.value,
    description: LaunchIsolatedChromeTool.shape.description.value,
    inputSchema: zodToJsonSchema(LaunchIsolatedChromeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      // Chromium-host sidecar path: when UNIBROWSE_CHROMIUM_HOST is set,
      // delegate the spawn to the sidecar via HTTP RPC instead of spawning
      // in-process. The chromium then survives mcp-server restarts (its
      // lifecycle is bound to chromium-host, not mcp-server). The extension
      // still registers back to the mcp-server's WebSocket the same way,
      // so the post-spawn poll for the new extensionId is unchanged.
      // ⭐ Two sidecars can be configured — see src/utils/sidecars.ts for why
      // they run side by side rather than one replacing the other. `sidecar`
      // picks; omitting it keeps the first, which is the long-standing
      // UNIBROWSE_CHROMIUM_HOST, so an existing caller's behaviour is
      // byte-identical to before this existed.
      const chosen = sidecarByName((params as any)?.sidecar);
      if (chosen) {
        return await launchViaChromiumHost(context, params, chosen, max_tokens);
      }

      // Lazy startup-time cleanup on first launch after process start.
      // Wipes stale SingletonLock + X11 sockets left from prior incarnations.
      runStartupCleanup();

      const validatedParams = LaunchIsolatedChromeTool.shape.arguments.parse(params);

      // Snapshot the currently-registered extensionIds before spawn. After
      // launch, we poll for a NEW id to appear in the pool — that's how we
      // know which extension belongs to the chromium we just started, and we
      // return it so the caller can pin subsequent tool calls.
      const preLaunchExtensionIds = new Set(
        (context as any).listExtensions?.().map((e: any) => e.extensionId) ?? [],
      );

      // Find Chrome executable
      const chromeBin = findChromeExecutable();
      if (!chromeBin) {
        return errorResponse(
          "Could not find Chrome or Chromium executable. " +
          "Please install Chrome/Chromium or set the path manually.", false
        );
      }

      // Resolve the extension directory. In dev mode, src/tools/ lives two
      // levels under repo root; in the production bundle, __dirname is /app/dist
      // and extension/ sits next to it at /app/extension. Probe both layouts
      // (and an absolute /app fallback for safety) and pick the first that
      // contains a manifest.json.
      const candidates = [
        path.resolve(__dirname, "..", "extension"),         // /app/extension when run from /app/dist
        path.resolve(__dirname, "..", "..", "extension"),   // <repo>/extension when run from <repo>/src/tools
        "/app/extension",
      ];
      let extensionDir: string | null = null;
      for (const c of candidates) {
        try {
          if (fs.existsSync(path.join(c, "manifest.json"))) { extensionDir = c; break; }
        } catch { /* ignore */ }
      }
      if (!extensionDir) {
        return errorResponse(
          `Extension directory not found (searched: ${candidates.join(", ")})`, false
        );
      }
      // Profiles live next to the extension dir for portability
      const profilesDir = path.join(path.dirname(extensionDir), ".chrome-profiles");

      // ⭐ REAP THE .dead-* BACKLOG. The EBUSY fallback below renames a profile
      // aside and its comment has always said the dir is "left for an external
      // sweep" — that sweep was never written, so they accumulated for months
      // (130 found 2026-09-03, all 83-90 days old, 25 MB). This is it, and it
      // lives here because this process already runs as root inside the
      // container with the profiles dir bind-mounted, so it needs neither host
      // sudo nor a new cron entry.
      // ⛔ NOT AWAITED. See sweepDeadProfiles' header: the synchronous version
      // of this blocked mcp-server's startup on 2026-09-03 and took the shared
      // server down. A launch must never wait on housekeeping.
      void sweepDeadProfiles(profilesDir).catch(() => { /* never surfaces */ });

      // Create profiles directory if it doesn't exist
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true }, max_tokens);
      }

      // Set up profile directory
      const profileName = validatedParams.profileName || "unibrowse-test";
      const profileDir = path.join(profilesDir, profileName);

      // Default to fresh profile (delete existing data)
      const freshProfile = validatedParams.freshProfile !== false;

      // Delete existing profile if freshProfile is true. NFS-resilient: when
      // the chrome that previously owned this profile exited recently, NFS
      // may have sillyrenamed open files (.nfsXXXX) that can't be unlinked
      // immediately — rmSync throws EBUSY. Fall back to renaming the whole
      // profile dir aside (.dead-${ts}) so the fresh launch never blocks on
      // the previous chrome's lingering file handles. The renamed dir is
      // left for an external sweep to reap when the kernel finally lets go.
      if (freshProfile && fs.existsSync(profileDir)) {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true });
        } catch (rmErr: any) {
          if (rmErr?.code === "EBUSY" || rmErr?.code === "ENOTEMPTY") {
            const aside = `${profileDir}.dead-${Date.now()}`;
            try {
              fs.renameSync(profileDir, aside);
              console.warn(`[chrome-launcher] rmSync EBUSY (NFS sillyrename?); renamed ${profileDir} → ${aside}`);
            } catch (mvErr: any) {
              console.error(`[chrome-launcher] could not clear ${profileDir}: rm failed (${rmErr.message}) and rename failed (${mvErr.message}). Launching with stale profile.`);
            }
          } else {
            throw rmErr;
          }
        }
      }

      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Profile self-heal: patch any "Crashed" exit_type to "Normal" so
      // chromium doesn't show the Restore Pages infobar over the first
      // navigation. Only matters for non-fresh profiles that previously
      // exited dirty (covers the entire fleet that was SIGKILL'd today).
      if (!freshProfile) {
        selfHealProfile(profileDir);
      }

      // Determine URLs to open
      let urls: string[];
      if (!validatedParams.url) {
        urls = ["chrome://extensions/"];
      } else if (Array.isArray(validatedParams.url)) {
        urls = validatedParams.url;
      } else {
        urls = [validatedParams.url];
      }

      // Build Chrome launch arguments
      const chromeArgs = [
        `--user-data-dir=${profileDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-features=TranslateUI",
        "--disable-default-apps",
      ];

      // Detect "we're running inside a container" and add the flags Chrome
      // needs to survive there. The big two:
      //   --no-sandbox: container kernel namespacing collides with Chrome's
      //                 own sandbox; without this the renderer exits at start.
      //   --disable-dev-shm-usage: default /dev/shm in docker is 64MB; Chrome
      //                 mmap's much more and falls over. Use /tmp instead.
      const inContainer = fs.existsSync("/.dockerenv") || process.env.UNIBROWSE_FORCE_CHROME_NOSANDBOX === "1";
      if (inContainer) {
        chromeArgs.push("--no-sandbox", "--disable-dev-shm-usage");
      }

      // Add window dimensions if specified.
      // ⚠️ This is the OS WINDOW size, NOT the viewport, and Chrome does not
      // honour it exactly: it clamps to a platform minimum (~500px wide) and
      // the window chrome eats more. `storybook` asked for 390x844 and measured
      // 500x701; asked 768x1024 and measured 980x1307. Nothing is broken — the
      // flag simply does not mean what a caller doing responsive work assumes.
      // ⇒ For breakpoint testing use browser_set_device_metrics, which drives
      // Emulation.setDeviceMetricsOverride and sets the REAL viewport. Verified
      // 2026-08-02: 390x844 mobile:true emulates and screenshots correctly.
      // Do not "fix" this by clamping here — the flag is right for sizing a
      // window; it is the wrong tool for emulating a device.
      if (validatedParams.width && validatedParams.height) {
        chromeArgs.push(`--window-size=${validatedParams.width},${validatedParams.height}`);
      }

      // Add headless mode if specified
      if (validatedParams.headless) {
        chromeArgs.push("--headless=new");
        chromeArgs.push("--disable-gpu");
      }

      // Scoped proxy egress. Profile-local by construction: these are argv on
      // THIS chromium, so the host's main Chrome and every other extension are
      // untouched. ⚠️ The bypass list is not a nicety — a killswitch VPN blocks
      // LAN egress, so without it the extension's own WebSocket to mcp-server
      // is blocked and the launch presents as the proxy being broken.
      if ((validatedParams as any).proxy) {
        const spec = parseProxySpec((validatedParams as any).proxy);
        chromeArgs.push(`--proxy-server=${spec}`);
        chromeArgs.push(
          `--proxy-bypass-list=${buildProxyBypassList(
            (validatedParams as any).proxyBypassList,
            process.env.UNIBROWSE_CHROMIUM_SERVER_HINT,
          )}`,
        );
      }

      // Add URLs to open
      chromeArgs.push(...urls);

      // When running headful inside a container, we need a display server.
      // Auto-spin an Xvfb on a per-launch display number (:90 + random) so
      // multiple isolated chromiums don't collide. The chromium process gets
      // DISPLAY=:N set in its env, but the host's display server is untouched
      // — so the window is invisible to whoever is on the host's :0/:1. This
      // is the magic that lets Auth0 see a "real browser" fingerprint while
      // ben's desktop stays uncluttered.
      const spawnEnv: Record<string, string> = { ...(process.env as any) };
      let xvfbProcess: any = null;
      let xvfbDisplay: string | null = null;
      if (inContainer && !validatedParams.headless) {
        xvfbDisplay = `:${90 + Math.floor(Math.random() * 100)}`;
        try {
          xvfbProcess = spawn("Xvfb", [xvfbDisplay, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"], {
            detached: true,
            stdio: "ignore",
          });
          xvfbProcess.unref();
          // Brief wait for Xvfb to come up before chromium binds to it
          // (Xvfb's listen socket appears in /tmp/.X11-unix/ — chromium fails
          // fast otherwise with "Cannot open display").
          const startSleep = Date.now();
          while (Date.now() - startSleep < 1500) {
            if (fs.existsSync(`/tmp/.X11-unix/X${xvfbDisplay.slice(1)}`)) break;
            execSync("sleep 0.1");
          }
          spawnEnv.DISPLAY = xvfbDisplay;
          console.log(`[chrome-launcher] Spawned Xvfb on ${xvfbDisplay} (pid ${xvfbProcess.pid}) for headful chromium`);
        } catch (xvfbErr) {
          console.warn(`[chrome-launcher] Xvfb failed to start (${(xvfbErr as any).message}); chromium will likely fail to open display`);
        }
      }

      // Spawn Chrome process
      const chromeProcess = spawn(chromeBin, chromeArgs, {
        detached: true,
        stdio: "ignore",
        env: spawnEnv,
      });

      // Unref the process so it doesn't keep the Node.js process alive
      chromeProcess.unref();

      // Track the process for shutdown-time graceful close.
      if (chromeProcess.pid) {
        launchedProcesses.set(chromeProcess.pid, chromeProcess);
        // Also clean up the map entry when the chromium dies on its own,
        // so shutdown doesn't try to signal a corpse pid that may have been
        // reused by a different process by then.
        chromeProcess.once("exit", () => launchedProcesses.delete(chromeProcess.pid!));
      }
      // Pair the Xvfb with the chromium so the SIGTERM handler also reaps it.
      if (xvfbProcess?.pid) {
        launchedXvfbs.set(xvfbProcess.pid, xvfbProcess);
        xvfbProcess.once("exit", () => launchedXvfbs.delete(xvfbProcess.pid!));
      }

      // Wait for the freshly-spawned chromium's extension to register so we
      // can return its extensionId. We poll listExtensions() for up to 15s
      // (cold start of headful chromium + Xvfb + extension load can be slow);
      // if it never appears we still return success with the PID, just no
      // extensionId — the caller can recover via listAttachedTabs's
      // extensions array. We always grab the LAST newcomer in case multiple
      // launches race.
      let spawnedExtensionId: string | null = null;
      const pollDeadline = Date.now() + 15_000;
      while (Date.now() < pollDeadline) {
        const current = (context as any).listExtensions?.() ?? [];
        const newcomers = current.filter((e: any) => !preLaunchExtensionIds.has(e.extensionId));
        if (newcomers.length > 0) {
          spawnedExtensionId = newcomers[newcomers.length - 1].extensionId;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      // Build response message
      let message = `✓ Chrome launched in isolated mode\n`;
      message += `  Profile: ${profileName} ${freshProfile ? "(fresh - no cookies/history)" : "(persistent)"}\n`;
      message += `  Profile Directory: ${profileDir}\n`;
      message += `  Extension: ${extensionDir}\n`;
      message += `  PID: ${chromeProcess.pid}\n`;
      message += `  URLs: ${urls.join(", ")}\n`;
      if (validatedParams.headless) {
        message += `  Mode: Headless\n`;
      }
      if (spawnedExtensionId) {
        message += `  Extension ID: ${spawnedExtensionId}\n`;
        message += `\nPass extensionId=${spawnedExtensionId} on subsequent tool calls to pin them to this chromium.`;
      } else {
        message += `\nThe extension will auto-connect to the MCP server at localhost:9010 (extension id not seen within 15s — check browser_list_attached_tabs).`;
      }

      return jsonResponse({
        pid: chromeProcess.pid,
        profileName,
        profileDir,
        extensionDir,
        urls,
        extensionId: spawnedExtensionId,
        message,
      }, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to launch isolated Chrome: ${error.message}`, false, error
      , max_tokens);
    }
  },
};

/**
 * Shut down an isolated chromium — the destroy counterpart to
 * browser_launch_isolated_chrome.
 *
 * Why this exists: until now `launch` had no opposite. The sidecar has always
 * exposed DELETE /processes/:pid, but :9020 is docker-network-only and
 * mcp-server never called it, so no MCP caller could reach it. Meanwhile
 * browser_close_tab reaps only the renderers and RETURNS SUCCESS, so callers
 * believed they had cleaned up. Result: every isolated chromium ever launched
 * leaked (26 found resident on 2026-08-01, oldest 10 days).
 *
 * PROCESS-ONLY by design — this never deletes profileDir. Killing the process
 * costs a cheap relaunch onto surviving auth state; deleting the profile can
 * cost a full credential re-seed. We are reclaiming RAM, not disk.
 */
export const closeIsolatedChrome: Tool = {
  schema: {
    name: CloseIsolatedChromeTool.shape.name.value,
    description: CloseIsolatedChromeTool.shape.description.value,
    inputSchema: zodToJsonSchema(CloseIsolatedChromeTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const args = CloseIsolatedChromeTool.shape.arguments.parse(params || {});
      const { extensionId, profileName, forceProfileName, caller } = args as any;
      if (!extensionId && !profileName) {
        return errorResponse("Either extensionId or profileName is required.", false, undefined, max_tokens);
      }
      if (!listSidecars().length) {
        return errorResponse(
          "browser_close_isolated_chrome requires the chromium-host sidecar (UNIBROWSE_CHROMIUM_HOST unset). " +
          "Instances launched in-process are not tracked by the sidecar and cannot be closed this way.",
          false, undefined, max_tokens,
        );
      }
      // ⛔ Ask which sidecar is running it rather than assuming the default.
      // A close sent to the wrong sidecar finds no match and would report
      // "nothing to close" about a browser that is very much alive.
      // ⚠️ By extensionId only — sidecarFor keys on that. With just a
      // profileName we fall back to the default sidecar, which is the old
      // behaviour and is correct whenever only one is configured.
      let base: string;
      if (extensionId) {
        try {
          base = (await sidecarFor(extensionId)).url;
        } catch (e: any) {
          return errorResponse(e.message, false, undefined, max_tokens);
        }
      } else {
        base = sidecarByName(undefined)!.url;
      }

      const listResp = await fetch(`${base}/processes`);
      if (!listResp.ok) {
        return errorResponse(`chromium-host /processes returned ${listResp.status}`, false, undefined, max_tokens);
      }
      const { processes } = (await listResp.json()) as any;
      let match = (processes || []).find((p: any) =>
        (extensionId && p.extensionId === extensionId) ||
        (profileName && p.profileName === profileName));
      // ⛔ FALL BACK TO THE PROFILE NAME — THE THIRD PLACE THIS WAS NEEDED, and
      // the one that was missed. sidecarFor and displayFor both learned it on
      // 2026-10-23; displayFor's own comment says the close path "has to" match
      // this way, and the close path did not. A sidecar learns a pid's
      // extensionId only when mcp-server POSTs /processes/<pid>/extension, which
      // happens only if the extension registers while the launch call is still
      // waiting — so a browser that registers late keeps `extensionId: null` for
      // the rest of its life and this lookup can never find it.
      //
      // MEASURED 2026-10-23 21:0x, on the very run that was testing a different
      // fix: profile `fieldscroll-…` came up with extensionId null, the close
      // was refused with "No tracked isolated chromium matches extensionId=…"
      // while listing that same profile as tracked, and the Chrome plus its Xvfb
      // display :94 leaked until they were reaped by pid.
      //
      // ⚠️ Fallback only, and only onto a process with NO extensionId of its own:
      // one reporting a different id is a different browser that happens to
      // share a profile name, and killing it would be a worse failure than the
      // one being fixed.
      if (!match && extensionId) {
        const byProfile = profileNameForExtensionId(extensionId);
        if (byProfile) {
          match = (processes || []).find(
            (p: any) => p.profileName === byProfile && !p.extensionId);
        }
      }
      if (!match) {
        return errorResponse(
          `No tracked isolated chromium matches ${extensionId ? `extensionId=${extensionId}` : `profileName=${profileName}`}. ` +
          `Currently tracked: ${(processes || []).map((p: any) => p.profileName).join(", ") || "(none)"}.`,
          false, undefined, max_tokens,
        );
      }

      const qs = new URLSearchParams();
      if (forceProfileName) qs.set("forceProfileName", forceProfileName);
      if (caller) qs.set("caller", caller);
      const delUrl = `${base}/processes/${match.pid}${qs.toString() ? `?${qs}` : ""}`;
      const delResp = await fetch(delUrl, { method: "DELETE" });
      const body = await delResp.json().catch(() => ({}) as any);

      if (delResp.status === 409) {
        // Persistent-profile refusal. Surface the sidecar's message verbatim —
        // it names the safe alternative, the per-profile reset cost, the owner
        // to ask, and the override, in that order.
        return errorResponse((body as any).message || "Refused: profile is persistent.", false, undefined, max_tokens);
      }
      if (!delResp.ok) {
        return errorResponse(`chromium-host DELETE returned ${delResp.status}: ${JSON.stringify(body)}`, false, undefined, max_tokens);
      }
      const freed = (body as any).freed || {};
      return jsonResponse({
        closed: true,
        pid: match.pid,
        profileName: match.profileName,
        extensionId: match.extensionId || null,
        display: freed.display ?? null,
        xvfbReaped: freed.xvfbPid ?? null,
        note: "Process-only: the profile directory was NOT deleted. Relaunch with freshProfile:false to reuse its auth state.",
      }, max_tokens);
    } catch (error: any) {
      return errorResponse(`Failed to close isolated Chrome: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Give a RUNNING browser its proxy credentials.
 *
 * ⛔ WHY A SEPARATE TOOL AND NOT A LAUNCH FLAG. On this deployment
 * UNIBROWSE_CHROMIUM_HOST is set, so browser_launch_isolated_chrome always
 * routes to a sidecar container and the in-process host-spawn branch is
 * unreachable — there is no parameter that changes that. Host Chrome is
 * therefore a browser this server can drive but cannot launch, and until now
 * that meant it could never be put behind an authenticated proxy at all:
 * --proxy-server cannot carry a password and the only thing that can answer
 * the 407 is the extension. `alpaca` hit exactly this asking for a VPN lease
 * on pid 825530 (ATC DM, 2026-10-23 17:11).
 *
 * ⭐ The credentials survive a restart of the target browser, because the
 * extension keeps them in that profile's chrome.storage.local. So the sequence
 * is stage once -> then relaunch onto the lease, in that order, and the
 * relaunch needs nothing from this server.
 */
export const stageProxyAuthTool: Tool = {
  schema: {
    name: StageProxyAuthTool.shape.name.value,
    description: StageProxyAuthTool.shape.description.value,
    inputSchema: zodToJsonSchema(StageProxyAuthTool.shape.arguments),
  },
  handle: async (context: any, params: any) => {
    const { max_tokens } = params || {};
    try {
      const args = StageProxyAuthTool.shape.arguments.parse(params || {});

      // ⛔ Refuse an extensionId this server does not have a live connection
      // to. Staging would otherwise "succeed" into a map entry nothing can
      // ever collect, and the caller would go on to relaunch a browser onto a
      // lease it cannot authenticate against.
      const known = (context.listExtensions?.() ?? []).map((e: any) => e.extensionId);
      if (!known.includes(args.extensionId)) {
        return errorResponse(
          `No connected extension ${args.extensionId}. Connected: ${known.join(", ") || "(none)"}. ` +
          `⇒ The credentials have to be delivered THROUGH the extension, so the browser must be up ` +
          `and registered before you stage; there is no offline form of this.`,
          false, undefined, max_tokens,
        );
      }

      // Rejects a spec carrying credentials — same refusal as a launch, for the
      // same reason: a proxy URL with a password in it ends up on a command
      // line, and a command line is world-readable via `ps`.
      const proxySpec = parseProxySpec(args.proxy);
      const nonce = stageProxyAuth(args.extensionId, validateProxyAuth(args.proxyAuth, proxySpec));

      const wsHint = process.env.UNIBROWSE_CHROMIUM_SERVER_HINT || "ws://mcp-server:9010/ws";
      const base = (args.serverBase || wsHint.replace(/^ws/, "http").replace(/\/ws$/, ""))
        .replace(/\/$/, "");

      // ⛔ NO `ws=` PARAM, deliberately. The seed page rewrites the extension's
      // server config when it is given one, and this tool's job is credentials
      // for a browser that is already connected — re-pointing a working
      // connection as a side effect of handing it a password would be a fault
      // nobody would look for here. The seed's proxy branch runs before its
      // `if (!wsUrl) return`, so omitting it costs nothing.
      const seedUrl = `${base}/__unibrowse_seed?http=${encodeURIComponent(base)}`
        + `&eid=${encodeURIComponent(args.extensionId)}&pa=${nonce}`
        + (args.replace === false ? "" : "&par=1");

      const tab: any = await context.sendSocketMessage("browser_create_tab" as any, {
        url: seedUrl,
        extensionId: args.extensionId,
      } as any);
      const tabId = tab?.tabId ?? null;

      // ⭐ POLL THE SERVER'S OWN RECORD, not the page. The seed page's fetch is
      // what flips `collected`, so this is the one observation that cannot
      // succeed while the browser is unable to reach us — which is the failure
      // this whole call is most likely to hit, since `base` has to be right
      // AND be in the browser's proxy bypass list.
      let collected = false;
      for (let i = 0; i < 30; i++) {
        if (proxyAuthCollected(args.extensionId) === true) { collected = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }

      // ⚠️ Best-effort, and SAID SO rather than swallowed. The extension can
      // reserve a tab it just created to a stale caller (known bug, fixed only
      // on builds reloaded after 2026-10-10), which makes this close fail — and
      // this runs against other seats' browsers, where a seed-page tab left
      // open is their problem to notice, not ours to hide.
      let closeError: string | null = null;
      if (tabId != null) {
        try {
          await context.sendSocketMessage("browser_close_tab" as any, {
            tabTarget: tabId, extensionId: args.extensionId,
          } as any);
        } catch (e: any) {
          closeError = e?.message || String(e);
        }
      }

      if (!collected) {
        return errorResponse(
          `Staged a lease for ${args.extensionId}, but its extension never collected it within 15s, ` +
          `so that browser STILL CANNOT answer a 407. Most likely ${base} is not reachable from that ` +
          `browser (a sidecar hint like http://mcp-server:9010 does not resolve on the host — pass ` +
          `serverBase), or it is not in the browser's --proxy-bypass-list, or the extension predates ` +
          `the 2026-10-23 build and has no proxy-auth code to run. The nonce is unspent; fix the ` +
          `cause and call again.`,
          false, undefined, max_tokens,
        );
      }

      return jsonResponse({
        staged: true,
        collected: true,
        extensionId: args.extensionId,
        proxy: proxySpec,
        seedTab: tabId,
        seedTabClosed: tabId == null ? null : closeError === null,
        seedTabCloseError: closeError,
        replaced: args.replace !== false,
        note:
          "The extension fetched the credentials and they are now in that profile's " +
          "chrome.storage.local, so they survive a restart of this browser — relaunch it onto the " +
          "proxy and the 407 is answered without staging again. ⚠️ COLLECTION IS NOT AN ARMED " +
          "HANDLER: the extension stores first and arms second, and only a real 407 proves the " +
          "second half. Load a page through the proxy before reporting this lane working.",
      }, max_tokens);
    } catch (error: any) {
      return errorResponse(`Failed to stage proxy auth: ${error.message}`, false, error, max_tokens);
    }
  },
};
