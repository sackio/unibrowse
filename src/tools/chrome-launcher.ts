import { spawn, execSync, type ChildProcess } from "child_process";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { LaunchIsolatedChromeTool } from "@/types/tool-schemas";
import { textResponse, errorResponse, jsonResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

// __dirname is not defined in ESM bundles; recompute it from the module URL.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  hostUrl: string,
  max_tokens: number | undefined,
): Promise<any> {
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
  const wsHint = process.env.UNIBROWSE_CHROMIUM_SERVER_HINT
    || "ws://mcp-server:9010/ws";
  const httpHint = wsHint.replace(/^ws/, "http").replace(/\/ws$/, "");
  const seedUrl = `${httpHint}/__unibrowse_seed?ws=${encodeURIComponent(wsHint)}&http=${encodeURIComponent(httpHint)}`;
  const userUrls = validatedParams.url
    ? (Array.isArray(validatedParams.url) ? validatedParams.url : [validatedParams.url])
    : ["chrome://extensions/"];
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
  const reqBody = {
    profileName: validatedParams.profileName,
    urls: [seedUrl, ...userUrls],
    freshProfile: validatedParams.freshProfile !== false,
    headless: innerHeadless,
    width: validatedParams.width,
    height: validatedParams.height,
    serverHint: wsHint,
  };
  const launchResp = await fetch(`${hostUrl.replace(/\/$/, "")}/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!launchResp.ok) {
    const text = await launchResp.text().catch(() => "");
    return errorResponse(
      `chromium-host /launch returned ${launchResp.status}: ${text}`,
      false, undefined, max_tokens,
    );
  }
  const { pid, display, profileDir } = await launchResp.json() as any;

  // Poll for the newcomer extension. Side-container path is slower than the
  // in-process path because the new chromium has to fully boot AND its
  // extension has to discover the mcp-server URL via the seed content
  // script BEFORE its background can register. Cold-boot + dirty-profile
  // restore can push past the legacy 15s window — bump to 30s. Also wait
  // a minimum of 3s before declaring success to absorb ben's-Chrome-style
  // reconnect races (where a pre-existing extension reconnects to mcp-server
  // and shows up as a newcomer briefly).
  let spawnedExtensionId: string | null = null;
  const deadline = Date.now() + 30_000;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const current = context.listExtensions?.() ?? [];
    const newcomers = current.filter((e: any) => !preLaunchExtensionIds.has(e.extensionId));
    if (newcomers.length > 0 && Date.now() - startedAt > 3_000) {
      // Pick the most-recently-registered newcomer (max registeredAt) rather
      // than the last in iteration order — guarantees the actual freshly-
      // spawned chromium wins over a coincidental concurrent reconnect.
      newcomers.sort((a: any, b: any) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
      spawnedExtensionId = newcomers[0].extensionId;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const fresh = validatedParams.freshProfile !== false;
  let message = `✓ Chrome launched via chromium-host sidecar\n`;
  message += `  Profile: ${validatedParams.profileName} ${fresh ? "(fresh - no cookies/history)" : "(persistent)"}\n`;
  message += `  Profile Directory: ${profileDir}\n`;
  message += `  Display: ${display || "(headless)"}\n`;
  message += `  PID (in chromium-host): ${pid}\n`;
  message += `  URLs: ${reqBody.urls.join(", ")}\n`;
  if (spawnedExtensionId) {
    message += `  Extension ID: ${spawnedExtensionId}\n`;
    message += `\nPass extensionId=${spawnedExtensionId} on subsequent tool calls to pin them to this chromium.`;
  } else {
    message += `\n(Extension id not seen within 15s — check browser_list_attached_tabs.)`;
  }
  return jsonResponse({
    pid, profileDir, urls: reqBody.urls, display,
    extensionId: spawnedExtensionId,
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
      const chromiumHost = process.env.UNIBROWSE_CHROMIUM_HOST;
      if (chromiumHost) {
        return await launchViaChromiumHost(context, params, chromiumHost, max_tokens);
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

      // Create profiles directory if it doesn't exist
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true }, max_tokens);
      }

      // Set up profile directory
      const profileName = validatedParams.profileName || "unibrowse-test";
      const profileDir = path.join(profilesDir, profileName);

      // Default to fresh profile (delete existing data)
      const freshProfile = validatedParams.freshProfile !== false;

      // Delete existing profile if freshProfile is true
      if (freshProfile && fs.existsSync(profileDir)) {
        fs.rmSync(profileDir, { recursive: true, force: true });
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

      // Add window dimensions if specified
      if (validatedParams.width && validatedParams.height) {
        chromeArgs.push(`--window-size=${validatedParams.width},${validatedParams.height}`);
      }

      // Add headless mode if specified
      if (validatedParams.headless) {
        chromeArgs.push("--headless=new");
        chromeArgs.push("--disable-gpu");
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
