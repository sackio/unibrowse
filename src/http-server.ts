#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { appConfig } from "@/config/app.config";
import { registerCaptchaRoutes, sweepCaptchaSessions } from "@/captcha";
import { registerSlipwayRoutes, sweepSlipwaySessions, type SlipwayTab } from "@/slipway";
import { takeFetchDestination } from "@/utils/fetch-destinations";

import type { Resource } from "@/resources/resource";
import { createServerWithTools, createServerWithoutWebSocket, globalContext } from "@/server";
import * as bookmarks from "@/tools/bookmarks";
import * as clipboard from "@/tools/clipboard";
import * as common from "@/tools/common";
import * as cookies from "@/tools/cookies";
import * as custom from "@/tools/custom";
import * as captchaTools from "@/tools/captcha";
import * as slipwayTools from "@/tools/slipway";
import * as downloads from "@/tools/downloads";
import * as extensions from "@/tools/extensions";
import * as exploration from "@/tools/exploration";
import * as forms from "@/tools/forms";
import * as history from "@/tools/history";
import * as interactions from "@/tools/interactions";
import * as watch from "@/tools/watch";
import * as network from "@/tools/network";
import * as snapshot from "@/tools/snapshot";
import * as system from "@/tools/system";
import * as tabs from "@/tools/tabs";
import * as userAction from "@/tools/user-action";
import * as macros from "@/tools/macros";
import * as recordings from "@/tools/recordings";
import { sweepDeadProfiles } from "@/utils/dead-profiles";
import { installLandingHandler, installZipHandler } from "@/install";
import { requireApiKey, requireLan, isAuthEnabled, isLocalClient, getEffectiveClientIP } from "@/utils/auth";
import * as realisticInput from "@/tools/realistic-input";
import * as multiTabManagement from "@/tools/multi-tab-management";
import * as videoRecording from "@/tools/video-recording";
import { fetchDestinations, getParked } from "@/tools/send-to-agent";
import * as frames from "@/tools/frames";
import * as errors from "@/tools/errors";
import * as chromeLauncher from "@/tools/chrome-launcher";
import type { Tool } from "@/tools/tool";

import packageJSON from "../package.json";
import { mongodb } from "@/utils/mongodb";
import { v4 as uuidv4 } from "uuid";
import { redactUrl } from "@/utils/redact-url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, "..", "recordings");
/**
 * ⚠️ DERIVED, NOT REQUIRED. PROFILES_DIR is set on the chromium-host service but
 * NOT on mcp-server, so reading only the env var made the startup sweep a
 * silent no-op here — it ran, found nothing to do, and logged nothing, which is
 * byte-identical to working. Measured 2026-09-03: a restart left the backlog at
 * 130. Same shape as RECORDINGS_DIR above; __dirname is /app/dist in the
 * container, so this resolves to the bind-mounted /app/.chrome-profiles.
 */
const PROFILES_DIR = process.env.PROFILES_DIR || path.join(__dirname, "..", ".chrome-profiles");

/**
 * Where browser_fetch_to_server puts bytes pulled out of a driven browser.
 * Same derivation as RECORDINGS_DIR — __dirname is /app/dist in the container,
 * so this resolves to the bind-mounted /app/fetched.
 *
 * ⛔ THE BIND SOURCE IS ON THE NAS, AND IS THEREFORE READABLE FLEET-WIDE.
 * compose maps this to /home/ben/files on office — Ben's choice, 2026-09-12
 * ("~/files is fine").
 *
 * ⚠️ /home/ben/files is a SYMLINK to /mnt/nas/data/files. MEASURED 2026-09-12
 * (`readlink -f`, then `df` → 192.168.1.207:/volume1/nas). I chose that path
 * over the repo's ./fetched specifically BECAUSE /home/ben is documented
 * host-local and I wanted the weaker exposure — and got the same exposure I
 * was avoiding, because a symlink out of a host-local tree is invisible from
 * the path. `laura-work` caught it; I had asserted the opposite to the
 * operator and to two seats before checking.
 *
 * ⇒ The upside is real and worth knowing: any seat on any host can read these
 * files directly at /mnt/nas/data/files, with no ssh and no copy step.
 * ⇒ The cost is equally real: every agent seat in the fleet can read them.
 *
 * ⛔ "It is under /home/<user>" IS NOT EVIDENCE OF HOST-LOCAL. Resolve it.
 *
 * ⛔ A directory being less exposed is not permission to widen what goes in
 * it. Personal records need the operator to say so explicitly and to say
 * where they land.
 *
 * ⚠️ Do NOT encode the current scope here. On 2026-09-12 Ben said "just
 * policy / resource documents", and 13 minutes later said to get the pay
 * stubs too. A scope committed to a comment is stale within the hour and then
 * reads as authority to whoever finds it next. Ask; do not cite this file.
 */
const FETCHED_DIR = process.env.FETCHED_DIR || path.join(__dirname, "..", "fetched");

/**
 * Who should own the fetched store, when we are the one creating it.
 *
 * ⛔ WHY THIS IS NOT JUST `mode: 0o700` ON THE mkdir. This container runs as
 * ROOT, so anything it creates is root-owned, and a root-owned 0700 directory
 * locks out every agent seat — all of which run as uid 1000 (measured
 * 2026-09-13 on office and 192.168.1.168). Mode alone therefore cannot express
 * "private to the agents": it needs an owner too.
 *
 * ⚠️ THE HAZARD THIS CLOSES, which is silent in both directions. The store's
 * 0700 was set by hand on the host. The route below recreates the directory if
 * it is missing, so deleting it once brings it back root:root 0755 — the
 * protection gone, with nothing failing and nothing logged. Conversely a
 * hardcoded chown would break any deployment whose seats are not uid 1000.
 * ⇒ Explicit opt-in via the environment: set, we create it private and owned;
 * unset, we behave exactly as before. Both compose files set it.
 */
const FETCHED_OWNER_UID = process.env.FETCHED_OWNER_UID
  ? Number(process.env.FETCHED_OWNER_UID)
  : null;
const FETCHED_OWNER_GID = process.env.FETCHED_OWNER_GID
  ? Number(process.env.FETCHED_OWNER_GID)
  : null;

/**
 * Create `dir` as a private directory owned by the configured store owner.
 * Never throws: the bytes are the deliverable, and failing a retrieval over an
 * ownership detail is the worse outcome. Warns instead.
 */
const ensurePrivateDir = (dir: string, inheritFrom?: string): void => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let uid = FETCHED_OWNER_UID;
  let gid = FETCHED_OWNER_GID;
  if (inheritFrom) {
    // A subdirectory inherits from the store itself, so it follows whatever the
    // store actually is rather than whatever the environment claims.
    try {
      const owner = fs.statSync(inheritFrom);
      uid = owner.uid;
      gid = owner.gid;
    } catch { /* fall back to the configured owner below */ }
  }

  // ⛔ EVERY SEGMENT, NOT JUST THE LEAF. `recursive: true` creates the whole
  // chain, and this used to chown only `dir` — so a nested destination like
  // "laura-work/mgb-oe-2027" left the INTERMEDIATE "laura-work" root-owned and
  // mode 0700, which uid 1000 cannot traverse. The leaf underneath was chowned
  // correctly and was still unreachable, because traversal needs execute on
  // every parent.
  //
  // ⚠️ Reported by `thread-laura-work-2` 2026-09-28 and reproduced here the same
  // day: a single-level destination works, a two-level one strands the file.
  // The fetch still returned indexed:true — success reported for bytes that no
  // seat, including the one that asked for them, could read. A one-level test
  // cannot catch this, which is why the defect survived.
  const targets: string[] = [];
  if (inheritFrom) {
    const root = path.resolve(inheritFrom);
    let cur = path.resolve(dir);
    // Walk up to, but never including, the store root — its ownership is
    // host-side state we inherit FROM and must not rewrite.
    while (cur.startsWith(root + path.sep)) {
      targets.push(cur);
      cur = path.dirname(cur);
    }
    targets.reverse();
  } else {
    targets.push(dir);
  }

  for (const target of targets) {
    try {
      if (uid !== null && gid !== null && Number.isFinite(uid) && Number.isFinite(gid)) {
        fs.chownSync(target, uid, gid);
      }
      fs.chmodSync(target, 0o700);
    } catch (err: any) {
      console.warn("[fetched] could not set owner/mode on", target, err?.message || err);
    }
  }
};

const commonTools: Tool[] = [
  common.pressKey,
  common.scroll,
  common.scrollToElement,
  common.setDeviceMetrics,
  common.setFileInput,
  common.wait,
];

const customTools: Tool[] = [
  custom.evaluate,
  custom.getConsoleLogs,
  custom.getNetworkLogs,
  custom.screenshot,
  custom.segmentedScreenshot,
];

const explorationTools: Tool[] = [
  exploration.queryDOM,
  exploration.getVisibleText,
  exploration.getComputedStyles,
  exploration.checkVisibility,
  exploration.getAttributes,
  exploration.countElements,
  exploration.getPageMetadata,
  exploration.getFilteredAriaTree,
  exploration.findByText,
  exploration.getFormValues,
  exploration.checkElementState,
];

const tabTools: Tool[] = [
  tabs.listTabs,
  tabs.switchTab,
  tabs.createTab,
  tabs.closeTab,
  tabs.handleDialog,
  tabs.createWindow,
];

const formTools: Tool[] = [
  forms.fillForm,
  forms.submitForm,
];

const recordingTools: Tool[] = [
  userAction.requestUserAction(false),
  recordings.saveRecording,
  recordings.listRecordings,
  recordings.getRecording,
  recordings.updateRecording,
  recordings.deleteRecording,
  recordings.startSessionRecording,
  recordings.stopSessionRecording,
  recordings.getSessionRecordingState,
  recordings.getRecordingScreenshot,
];

const interactionTools: Tool[] = [
  interactions.getInteractions,
  interactions.pruneInteractions,
  interactions.searchInteractions,

  // Watch — push events out of the browser instead of polling for them.
  // See docs/WATCH_DESIGN.md.
  watch.watchSources,
  watch.watchCreate,
  watch.watchList,
  watch.watchDelete,
  watch.watchPoll,
];

const cookieTools: Tool[] = [
  cookies.getCookies,
  cookies.setCookie,
  cookies.deleteCookie,
  cookies.clearCookies,
];

const downloadTools: Tool[] = [
  downloads.downloadFile,
  downloads.getDownloads,
  downloads.fetchToServer,
  downloads.listFetched,
  captchaTools.requestCaptchaSolve,
  captchaTools.checkCaptchaSolve,
  captchaTools.cancelCaptchaSolve,
  slipwayTools.openSlipway,
  slipwayTools.closeSlipway,
  downloads.cancelDownload,
  downloads.openDownload,
];

const clipboardTools: Tool[] = [
  clipboard.getClipboard,
  clipboard.setClipboard,
];

const historyTools: Tool[] = [
  history.searchHistory,
  history.getHistoryVisits,
  history.deleteHistory,
  history.clearHistory,
];

const systemTools: Tool[] = [
  system.getVersion,
  system.getSystemInfo,
  system.getBrowserInfo,
  chromeLauncher.launchIsolatedChrome,
  chromeLauncher.closeIsolatedChrome,
];

const networkTools: Tool[] = [
  network.getNetworkState,
  network.setNetworkConditions,
  network.clearCache,
];

const bookmarkTools: Tool[] = [
  bookmarks.getBookmarks,
  bookmarks.createBookmark,
  bookmarks.deleteBookmark,
  bookmarks.searchBookmarks,
];

const extensionTools: Tool[] = [
  extensions.listExtensions,
  extensions.getExtensionInfo,
  extensions.enableExtension,
  extensions.disableExtension,
];

const macroTools: Tool[] = [
  macros.storeMacro,
  macros.listMacros,
  macros.getMacro,
  macros.executeMacro,
  macros.updateMacro,
  macros.deleteMacro,
];

const realisticInputTools: Tool[] = [
  realisticInput.realisticMouseMove,
  realisticInput.realisticClick,
  realisticInput.realisticType,
];

const videoRecordingTools: Tool[] = [
  videoRecording.startVideoRecording,
  videoRecording.stopVideoRecording,
];

const multiTabTools: Tool[] = [
  multiTabManagement.listAttachedTabs,
  multiTabManagement.setTabLabel,
  multiTabManagement.detachTab,
  multiTabManagement.getActiveTab,
  multiTabManagement.attachTab,
  multiTabManagement.reserveTab,
  multiTabManagement.releaseTab,
];

const frameTools: Tool[] = [
  frames.listFrames,
];

const diagnosticTools: Tool[] = [
  errors.getErrors,
  errors.reloadExtension,
];

const snapshotTools: Tool[] = [
  common.navigate(false),
  common.goBack(false),
  common.goForward(false),
  snapshot.snapshot,
  snapshot.click,
  snapshot.drag,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
  ...tabTools,
  ...formTools,
  ...recordingTools,
  ...interactionTools,
  ...cookieTools,
  ...downloadTools,
  ...clipboardTools,
  ...historyTools,
  ...systemTools,
  ...networkTools,
  ...bookmarkTools,
  ...extensionTools,
  ...macroTools,
  ...realisticInputTools,
  ...multiTabTools,
  ...videoRecordingTools,
  ...frameTools,
  ...diagnosticTools,
];

const resources: Resource[] = [];

// Create server with WebSocket for Chrome extension
async function createServerWithWebSocket(): Promise<Server> {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10gb" }));

  // Allow large binary uploads for video (matches both /video and /video/:tabId)
  app.use("/api/v1/recordings/:id/video", express.raw({ type: "video/*", limit: "500mb" }));

  // Bytes pulled out of a driven browser arrive as an opaque blob of any type —
  // PDF, xlsx, zip — so this one cannot filter by Content-Type the way the video
  // route does. Scoped to the exact path so `type: "*/*"` cannot swallow the
  // JSON body of any other route.
  app.use("/api/v1/fetched", express.raw({ type: "*/*", limit: "100mb" }));

  // CORS for extension fetch calls
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const port = parseInt(process.env.PORT || "9010");

  // Health check endpoint — always public (used by docker healthcheck + LAN probe)
  app.get("/health", (req, res) => {
    const authOn = isAuthEnabled();
    const local = isLocalClient(req);
    res.json({
      status: "ok",
      version: packageJSON.version,
      // All gated routes (/mcp, /ws, /install/zip, /api/v1/recordings/*)
      // share the same policy: LAN clients always allowed; remote clients
      // need an API key when UNIBROWSE_API_KEYS is set.
      policy: authOn ? "lan-open-remote-required" : "open",
      authRequired: authOn && !local,
      clientIp: getEffectiveClientIP(req),
      isLocalClient: local,
    });
  });

  // Connected extensions + recent disconnects. Public, read-only, no secrets.
  //
  // ⚠️ The point of this endpoint is that it answers "is a usable browser
  // attached, and if not, when and how did it go?" WITHOUT needing a browser.
  // Every previous instrument for that question lived inside the extension, so
  // it died with the thing it was measuring.
  //
  // `hostBrowserPresent` deliberately encodes the SAME gate the login script
  // uses (an extension that is neither a container sidecar nor off-host), so a
  // watchdog built on this cannot report healthy for a browser the login would
  // reject. ⛔ It is NOT proof a sign-in will complete: the container sidecar
  // requests a magic link happily and then hangs forever consuming one. Necessary,
  // not sufficient — treat a true here as "worth attempting", never as success.
  app.get("/extensions", (_req, res) => {
    const identities = globalContext.describeExtensions();
    const usable = identities.filter(
      (e) => e.kind !== "container-sidecar" && e.kind !== "lan-remote",
    );
    res.json({
      hostBrowserPresent: usable.length > 0,
      hostBrowserKinds: usable.map((e) => e.kind),
      connected: identities,
      // Newest last. Close code is the diagnostic field: 1000/1001 = deliberate
      // close (worker shutdown), 1006 = socket vanished with no close frame.
      recentDisconnects: globalContext.getDisconnects(),
    });
  });

  // Extension distribution — public landing page; the zip download itself is
  // gated by the same API key middleware when UNIBROWSE_API_KEYS is set.
  /**
   * The broker's live seat list, proxied for the extension popup's picker.
   *
   * ⛔ Proxied rather than fetched directly by the extension, for the same
   * reason the send itself is: the extension does not talk to third parties.
   * ⭐ The picker and the send-time validation read the SAME list, so a name
   * the picker offers can never be one the sender rejects.
   */
  app.get("/destinations", async (_req: any, res: any) => {
    try {
      const destinations = await fetchDestinations();
      res.json({ status: "ok", count: destinations.length, destinations });
    } catch (e: any) {
      res.status(502).json({ status: "error", error: e?.message || String(e) });
    }
  });

  /**
   * A page body too large to inline in an ATC message. Plain GET, no auth —
   * the id is unguessable and the content is a web page the recipient could
   * have fetched themselves. Expires after 6h.
   */
  app.get("/shared/:id", (req: any, res: any) => {
    const entry = getParked(String(req.params.id));
    if (!entry) {
      res.status(404).type("text/plain").send(
        "Not found. Parked page bodies expire 6 hours after they are sent; " +
        "ask the sender to re-send.",
      );
      return;
    }
    res.type(entry.format === "html" ? "text/html" : "text/plain").send(entry.body);
  });

  app.get("/install", installLandingHandler);
  app.get("/install/extension.zip", installZipHandler);

  // Chromium-host sidecar bootstrap. The chromium-host service spawns each
  // new chromium with this URL as the first tab (carrying ws/http/key as
  // query params). The extension's unibrowse-seed.js content script picks
  // up the params on document_start and writes them to chrome.storage.local
  // so resolveServerConfig finds a non-localhost default on first connect.
  // Public route (no API key) since the page itself contains no secrets;
  // the key in the URL is what the page is meant to seed.
  app.get("/__unibrowse_seed", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      `<!doctype html><meta charset=utf-8><title>unibrowse seed</title><body>seeding…</body>`,
    );
  });

  // ── Session Recording API ───────────────────────────────────────────────────

  // Ensure recordings directory exists
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

  // ⛔ SWEEP DEAD PROFILES HERE, NOT ONLY AT LAUNCH. chrome-launcher also calls
  // this, but that call sits AFTER the early return into the chromium-host
  // sidecar (UNIBROWSE_CHROMIUM_HOST) — which is the path this whole fleet
  // takes, so on every real deployment it never runs. Measured 2026-09-03: one
  // launch reaped nothing and the backlog stayed at 130. Startup always runs,
  // has nobody waiting on it, and shares the same bind-mounted profiles dir.
  //
  // ⚠️ The cap is higher here for the same reason: no caller is blocked, so a
  // restart can clear a real backlog instead of dribbling it out 25 at a time.
  async function ensureMongoConnected() {
    if (!mongodb.isConnected()) await mongodb.connect();
  }

  // ── remote captcha solving ───────────────────────────────────────────────
  //
  // The solver page and its poll/tap endpoints. See src/captcha.ts for why the
  // token in the path is the credential and why these are not behind
  // requireApiKey: a phone opening the link has no LAN access and no login, and
  // that is the entire point of the feature.
  registerCaptchaRoutes(app, {
    // ⛔ A BACKGROUNDED TAB NEVER PRODUCES A FRAME. Page.captureScreenshot waits
    // on the compositor, and Chrome does not composite a hidden tab, so the
    // capture times out — the relay then serves a JSON error where the operator
    // expects a picture, and the session looks broken rather than backgrounded.
    // MEASURED 2026-10-09: three sessions were opened in one browser window, so
    // only one tab could be foreground; the other two could not be screenshotted
    // at all.
    //
    // ⚠️ FOREGROUND ON FAILURE, NOT ON EVERY SHOT. Shots poll every ~2.2s, and
    // activating the tab each time would yank focus continuously — which breaks
    // the focus-sensitive widgets this relay exists to drive (reCAPTCHA closes
    // its image grid when the page loses focus). One retry costs a round trip
    // only in the case that was failing anyway.
    screenshot: async (s) => {
      const capture = () =>
        globalContext.sendSocketMessage("browser_screenshot", {
          tabTarget: s.tabTarget,
          ...(s.extensionId ? { extensionId: s.extensionId } : {}),
        } as any) as Promise<any>;
      try {
        return await capture();
      } catch (err: any) {
        if (!/hidden|timed out/i.test(String(err?.message ?? err))) throw err;
        await globalContext.sendSocketMessage("browser_switch_tab", {
          tabTarget: s.tabTarget,
          ...(s.extensionId ? { extensionId: s.extensionId } : {}),
        } as any);
        return await capture();
      }
    },

    // ⛔ Ask the PAGE for its viewport rather than trusting the screenshot's
    // pixel dimensions. captureScreenshot returns device pixels, so on any
    // non-1 devicePixelRatio the image is larger than the CSS viewport and a
    // tap mapped from image pixels lands short and to the left — consistently,
    // which reads as "the click is slightly off" rather than as a scaling bug.
    viewport: async (s) => {
      const r: any = await globalContext.sendSocketMessage("browser_evaluate", {
        expression: "({ width: window.innerWidth, height: window.innerHeight })",
        tabTarget: s.tabTarget,
        ...(s.extensionId ? { extensionId: s.extensionId } : {}),
      } as any);
      const v = r?.result ?? r?.value ?? r;
      const width = Number(v?.width), height = Number(v?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`could not read viewport from tab ${s.tabTarget} (got ${JSON.stringify(v)})`);
      }
      return { width, height };
    },

    click: async (s, x, y, holdMs) => {
      // ⭐ `downDelay` IS THE HOLD, and it already exists in the extension:
      // cdp.js clickRealistic() sleeps downDelay between mousePressed and
      // mouseReleased (defaulting to a random 50-100ms). So a press-and-hold
      // needs no extension change and no ↻ — it ships on a :9010 restart.
      // ⚠️ It is NOT reachable through the browser_realistic_click TOOL, whose
      // schema does not declare downDelay; this path talks to the socket
      // directly, which is the only reason it can be passed at all.
      //
      // ⛔ currentX/currentY ARE NOT OPTIONAL HERE. Omitted, the extension's
      // bezier starts at (0,0) — the viewport corner — on every relayed tap.
      // 6057caf fixed that for the realistic_* tools by tracking the cursor
      // server-side; this path bypasses those tools, so it carries its own
      // origin on the session. First tap of a session has no prior position,
      // so it starts from a random plausible point rather than a constant.
      const from = s.cursor ?? {
        x: 40 + Math.round(Math.random() * 180),
        y: 60 + Math.round(Math.random() * 200),
      };
      await globalContext.sendSocketMessage("browser_realistic_click", {
        x, y, moveFirst: true, tabTarget: s.tabTarget,
        currentX: from.x, currentY: from.y,
        ...(holdMs !== undefined ? { downDelay: holdMs } : {}),
        ...(s.extensionId ? { extensionId: s.extensionId } : {}),
      } as any);
    },

    type: async (s, text) => {
      await globalContext.sendSocketMessage("browser_realistic_type", {
        text, tabTarget: s.tabTarget,
        ...(s.extensionId ? { extensionId: s.extensionId } : {}),
      } as any);
    },

    // ⛔ NOT AWAITED, AND THE .catch IS LOAD-BEARING. notifySolvedToRequester
    // never throws by design, but an unhandled rejection here would land on a
    // request that has already been answered — so the guard stays whatever that
    // function promises, because this side cannot see a change to it.
    onSolved: (s) => {
      void captchaTools.notifySolvedToRequester(s).catch((err: any) => {
        console.error(`[captcha] solve notice failed for ${s.id}: ${err?.message ?? err}`);
      });
    },
  });

  // Sessions are in-memory and terminal states are reached by reading the clock,
  // so nothing reaps them on its own. Hourly is far more often than needed.
  setInterval(() => {
    const n = sweepCaptchaSessions();
    if (n) console.log(`[captcha] swept ${n} finished session(s)`);
  }, 3600_000).unref();

  // ── Slipway: drive one browser from a phone ──────────────────────────────
  //
  // ⭐ THE SCREENSHOT AND CLICK DEPS ARE THE CAPTCHA RELAY'S, LESSON FOR
  // LESSON. A backgrounded tab never produces a frame, so a failed capture
  // retries ONCE after activating the tab rather than activating on every
  // poll; the viewport is read from the PAGE because captureScreenshot returns
  // device pixels; and a relayed click carries currentX/currentY or the
  // extension's bezier starts at (0,0) on every tap. All three were measured
  // on the captcha path — see registerCaptchaRoutes above for the detail, and
  // ⛔ do not "simplify" either copy without reading those comments.
  const slipwayShot = async (s: { tabTarget: number | string | null; extensionId: string }) => {
    const ext = { extensionId: s.extensionId };
    const capture = () =>
      globalContext.sendSocketMessage("browser_screenshot", {
        tabTarget: s.tabTarget, ...ext,
      } as any) as Promise<any>;
    try {
      return await capture();
    } catch (err: any) {
      if (!/hidden|timed out/i.test(String(err?.message ?? err))) throw err;
      await globalContext.sendSocketMessage("browser_switch_tab", {
        tabTarget: s.tabTarget, ...ext,
      } as any);
      return await capture();
    }
  };

  registerSlipwayRoutes(app, {
    // ⚠️ Scoped to the session's ONE extension with `only`, not aggregated
    // across the fleet. That scoping IS the security bound promised in
    // slipway.ts's header, so it belongs here where the call is made.
    listTabs: async (s) => {
      const results = await globalContext.broadcastSocketMessage(
        "browser_list_attached_tabs",
        { live: true } as any,
        { only: [s.extensionId] },
      );
      const out: SlipwayTab[] = [];
      for (const r of results) {
        if (r.error) continue;
        for (const t of (r.result?.tabs ?? []) as any[]) {
          out.push({
            tabTarget: t.tabId ?? t.label,
            label: t.label ?? null,
            // Prefer LIVE title/url: the attach-time record never updates on
            // navigation and fails toward "nothing changed", which on a tab
            // picker means offering the holder a page the tab has left.
            title: t.liveTitle ?? t.title ?? null,
            url: redactUrl(t.liveUrl ?? t.url),
            reservedTo: t.reservation?.owner ?? null,
          });
        }
      }
      return out;
    },

    screenshot: (s) => slipwayShot(s),

    viewport: async (s) => {
      const r: any = await globalContext.sendSocketMessage("browser_evaluate", {
        expression: "({ width: window.innerWidth, height: window.innerHeight })",
        tabTarget: s.tabTarget, extensionId: s.extensionId,
      } as any);
      const v = r?.result ?? r?.value ?? r;
      const width = Number(v?.width), height = Number(v?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`could not read viewport from tab ${s.tabTarget} (got ${JSON.stringify(v)})`);
      }
      return { width, height };
    },

    click: async (s, x, y, holdMs) => {
      const from = s.cursor ?? {
        x: 40 + Math.round(Math.random() * 180),
        y: 60 + Math.round(Math.random() * 200),
      };
      await globalContext.sendSocketMessage("browser_realistic_click", {
        x, y, moveFirst: true, tabTarget: s.tabTarget,
        currentX: from.x, currentY: from.y,
        ...(holdMs !== undefined ? { downDelay: holdMs } : {}),
        extensionId: s.extensionId,
      } as any);
    },

    type: async (s, text) => {
      await globalContext.sendSocketMessage("browser_realistic_type", {
        text, tabTarget: s.tabTarget, extensionId: s.extensionId,
      } as any);
    },

    scroll: async (s, y) => {
      await globalContext.sendSocketMessage("browser_scroll", {
        x: 0, y, tabTarget: s.tabTarget, extensionId: s.extensionId,
      } as any);
    },

    pressKey: async (s, key) => {
      await globalContext.sendSocketMessage("browser_press_key", {
        key, tabTarget: s.tabTarget, extensionId: s.extensionId,
      } as any);
    },

    record: async (s, on) => {
      await globalContext.sendSocketMessage(
        on ? "browser_start_session_recording" : "browser_stop_session_recording",
        { tabTarget: s.tabTarget, extensionId: s.extensionId } as any,
      );
    },
  });

  setInterval(() => {
    const n = sweepSlipwaySessions();
    if (n) console.log(`[slipway] swept ${n} finished session(s)`);
  }, 3600_000).unref();

  // ── browser_fetch_to_server receiving end ────────────────────────────────
  //
  // The extension's service worker fetched a URL with the browser's own
  // cookies and POSTs the raw bytes here. See FetchToServerTool in
  // tool-schemas.ts for why neither a tool response nor an in-page fetch can
  // do this job.

  /**
   * ⛔ SANITISE THE FILENAME, DO NOT TRUST IT.
   *
   * It originates from a remote page — a Content-Disposition header or an
   * attacker-influenced URL path — and is about to be concatenated into a
   * filesystem path on our server. `../../etc/cron.d/x` is the obvious attack;
   * a bare `.` or an empty string is the boring one that writes to the
   * directory itself.
   *
   * basename() strips any directory component, then the allowlist removes
   * everything that is not plainly a filename character. The stored name is
   * ALSO prefixed with a server-generated uuid, so two files with the same
   * name cannot collide and a caller cannot choose the final path even if the
   * allowlist were wrong.
   */
  function safeStoredName(raw: unknown, id: string): string {
    const fallback = "download";
    let name = typeof raw === "string" ? raw : "";
    name = path.basename(name);
    name = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
    if (!name || name === "_") name = fallback;
    if (name.length > 120) name = name.slice(-120);
    return `${id}-${name}`;
  }

  /**
   * ⛔ HTTP HEADERS ARE ISO-8859-1. Anything with a character outside it —
   * an en-dash, an accent, a curly quote — makes the BROWSER throw
   * `Failed to read the 'headers' property from 'RequestInit': String contains
   * non ISO-8859-1 code point` when it builds the upload request. That throw
   * happens BEFORE the fetch, so nothing reaches us and a retry is
   * deterministic, not transient. Reported by `thread-laura-work-1` 2026-09-13
   * pulling real HR documents, whose titles are full of en-dashes.
   *
   * ⚠️ It is NOT only the caller's `label`: when no filename is supplied the
   * extension derives one from `Content-Disposition`, so an accented document
   * name throws with nothing the caller passed being at fault.
   *
   * So these values travel percent-encoded. Two senders, two vintages:
   *  · `label` — encoded by US in tools/downloads.ts before it is ever sent to
   *    the extension, so it is safe even on an extension too old to know about
   *    this. Always decode it.
   *  · `filename` / `sourceUrl` — originate in the browser, so only a NEW
   *    extension can encode them. It announces itself with
   *    `X-Unibrowse-Encoding: percent`; without that marker the values are raw
   *    and must NOT be decoded, or a filename containing a literal `%` gets
   *    mangled by our own fix.
   */
  const safeDecode = (v: string | undefined | null): string | null => {
    if (v === undefined || v === null) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      // Malformed escape — keep the raw value rather than losing the field.
      return v;
    }
  };

  // POST /api/v1/fetched — store bytes the extension pulled with the user's session
  app.post("/api/v1/fetched", requireApiKey, async (req: any, res: any) => {
    try {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: "empty body — nothing to store" });
      }
      // ⛔ Recreating this must not silently drop the store back to a
      // world-readable 0755 — see ensurePrivateDir. Deleting the directory once
      // used to do exactly that, with nothing logged and nothing failing.
      if (!fs.existsSync(FETCHED_DIR)) ensurePrivateDir(FETCHED_DIR);

      const id = uuidv4();
      const encoded = req.get("X-Unibrowse-Encoding") === "percent";
      const rawFilename = req.get("X-Unibrowse-Filename");
      const storedName = safeStoredName(
        encoded ? safeDecode(rawFilename) : rawFilename,
        id,
      );
      const sourceUrl = (encoded
        ? safeDecode(req.get("X-Unibrowse-Source-Url"))
        : req.get("X-Unibrowse-Source-Url")) || null;

      // ⭐ Did the caller ask for a subdirectory? The tool registered it against
      // this URL before the socket call — the extension is not involved and
      // needs no update, which is the whole point (utils/fetch-destinations.ts).
      // Already validated there; the prefix assertion below is still the gate.
      const destination = takeFetchDestination(sourceUrl);
      const targetDir = destination ? path.join(FETCHED_DIR, destination) : FETCHED_DIR;
      if (destination) {
        // ⛔ 0700, and owned by whoever owns the store — NOT root. The container
        // runs as root, so anything it creates is root-owned and mode 0700 would
        // lock out every agent seat (all of which run as uid 1000). Inheriting
        // the store's owner keeps the subdirectory readable by exactly the
        // principals that can already read the store, and no one else.
        // ⚠️ This does NOT isolate one seat from another and cannot: every seat
        // is the same uid. It keeps the bytes off a world-readable path from the
        // FIRST write, closing the land-then-move window.
        ensurePrivateDir(targetDir, FETCHED_DIR);
      }

      const absPath = path.join(targetDir, storedName);

      // Belt and braces: even after sanitising, refuse to write outside the
      // directory. If this ever fires, safeStoredName has a hole.
      // ⛔ Rooted at FETCHED_DIR, never at targetDir — checking against a
      // caller-influenced directory would make the guard agree with whatever
      // the caller asked for, which is not a check.
      const resolved = path.resolve(absPath);
      if (!resolved.startsWith(path.resolve(FETCHED_DIR) + path.sep)) {
        return res.status(400).json({ error: "refusing to write outside the fetched directory" });
      }

      fs.writeFileSync(absPath, body);
      const sha256 = crypto.createHash("sha256").update(body).digest("hex");

      const record = {
        id,
        storedName,
        path: absPath,
        bytes: body.length,
        sha256,
        contentType: req.get("X-Unibrowse-Content-Type") || req.get("Content-Type") || null,
        sourceUrl,
        // null when the file landed in the shared store, so a listing shows at
        // a glance which files are in a private subdirectory and which are not.
        destination: destination || null,
        // ⛔ Always decoded, regardless of the marker: WE encoded it on the way
        // out (tools/downloads.ts), so it arrives encoded from every extension
        // vintage. This is the half that fixes an already-deployed browser.
        label: safeDecode(req.get("X-Unibrowse-Label")) || null,
        extensionId: req.get("X-Unibrowse-Extension-Id") || null,
        createdAt: new Date(),
      };

      try {
        await ensureMongoConnected();
        await mongodb.getFetchedFilesCollection().insertOne({ ...record });
      } catch (err: any) {
        // ⚠️ The FILE is already on disk and is the deliverable. A Mongo failure
        // must not make a successful retrieval look like a failed one — it only
        // costs the listing. Say so in the response rather than throwing.
        console.warn("[fetched] stored on disk but not indexed:", err?.message || err);
        return res.json({ ...record, indexed: false, indexWarning: String(err?.message || err) });
      }

      res.json({ ...record, indexed: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/fetched — list what has been retrieved
  app.get("/api/v1/fetched", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 500);
      const rows = await mongodb.getFetchedFilesCollection()
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      res.json({ files: rows, count: rows.length, dir: FETCHED_DIR });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings — create recording metadata, return id
  app.post("/api/v1/recordings", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const body = req.body as any;
      const doc = {
        id: uuidv4(),
        sessionId: body.sessionId || "",
        title: body.title || "Untitled Session",
        description: body.description || "",
        tags: body.tags || [],
        status: body.status || "complete",
        // ⛔ Query values and fragments redacted. A URL's query string routinely
        // IS the credential -- measured in this very store 2026-10-06: a full
        // JWT in `…ivastudio.ai/store?token=eyJ…`, an Amazon
        // `passkeyClaimVerificationToken`, a Stripe `apiKey=pk_live_…`.
        // `finance` names two more where the URL alone grants access with no
        // login behind it. Origin, path and param NAMES survive, so
        // browser_list_recordings({startUrl}) still filters by host.
        startUrl: redactUrl(body.startUrl || ""),
        startTime: body.startTime || Date.now(),
        endTime: body.endTime || Date.now(),
        duration: body.duration || 0,
        pages: (Array.isArray(body.pages) ? body.pages : []).map((pg: any) =>
          pg && typeof pg === "object"
            ? { ...pg, url: redactUrl(pg.url), referrer: redactUrl(pg.referrer) }
            : pg,
        ),
        rrwebEventCount: body.rrwebEventCount || 0,
        networkEntryCount: body.networkEntryCount || 0,
        annotations: [],
        videoPath: null,
        primaryTabId: body.primaryTabId || null,
        recordedTabIds: body.recordedTabIds || [],
        videoStartTimes: body.videoStartTimes || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await recordings.insertOne(doc);
      res.json({ id: doc.id, success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/video — upload raw video bytes
  app.post("/api/v1/recordings/:id/video", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const videoPath = path.join(RECORDINGS_DIR, `${id}.webm`);
      fs.writeFileSync(videoPath, req.body as Buffer);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { videoPath: `recordings/${id}.webm`, updatedAt: new Date() } }
      );
      res.json({ success: true, videoPath: `recordings/${id}.webm` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/events — append a chunk of events.
  // Recordings can produce >16MB of events (Mongo's per-doc limit), so each call
  // inserts a NEW chunk doc rather than replacing. Pass ?reset=1 on the first
  // chunk to wipe any prior chunks for this recording (re-uploads).
  // Chunks are reassembled on read by querying all docs for recordingId, sorted
  // by chunkIndex.
  app.post("/api/v1/recordings/:id/events", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const { rrwebEvents = [], networkEntries = [], interactions = [], chunkIndex = 0 } = req.body as any;
      const recordingEvents = mongodb.getRecordingEventsCollection();

      // ⛔ RESPONSE AND REQUEST BODIES ARE STRIPPED AT INGEST. Ben, Slack
      // #unibrowse 2026-10-06. Two reasons, and the second is the important one:
      //
      // 1. SIZE. Each body is capped at 50 KB in the interceptor and a recording
      //    caps at 5,000 network entries, so bodies alone can be ~250 MB of a
      //    single capture.
      // 2. ⛔ CONTENT. These are the operator's own logged-in sessions. A saved
      //    store of 693 unrequested recordings was found 2026-10-06 holding
      //    secure.bankofamerica.com, fidelity.com and five captures of a family
      //    member's MGB benefits portal — as rendered, with bodies. Account
      //    pages, in a store every seat on every host can read.
      //
      // ⚠️ SERVER-SIDE ON PURPOSE. The interceptor that captures them is
      // extension code, and extension code reaches no running browser without
      // the ↻ the operator has declined. Stripping here protects every connected
      // browser on the next :9010 restart instead of only the ones that reload.
      // ⇒ When the extension-side change ships, this stays: defence in depth
      // costs one map() and the failure mode it prevents is unrecoverable.
      //
      // URL, method, status, headers and timing are KEPT — that is what makes a
      // network log useful for debugging. Only the payloads go.
      const strippedEntries = (Array.isArray(networkEntries) ? networkEntries : []).map(
        (e: any) => {
          if (!e || typeof e !== "object") return e;
          const hadReq = typeof e.requestBody === "string" && e.requestBody.length > 0;
          const hadRes = typeof e.responseBody === "string" && e.responseBody.length > 0;
          // ⛔ A body-less entry still needs its URL redacted. The first version
          // of this returned `e` untouched here, which would have left the token
          // on every GET -- i.e. on exactly the requests that carry one in the
          // query string. The early return is for bodies, not for URLs.
          if (!hadReq && !hadRes) return { ...e, url: redactUrl(e.url) };
          return {
            ...e,
            url: redactUrl(e.url),
            requestBody: null,
            responseBody: null,
            // Say the body existed and was dropped. ⚠️ A silently absent body is
            // indistinguishable from a request that had none, and a reader
            // debugging an empty response would chase the wrong thing.
            bodiesStrippedAtIngest: true,
            ...(hadReq ? { requestBodyBytes: e.requestBody.length } : {}),
            ...(hadRes ? { responseBodyBytes: e.responseBody.length } : {}),
          };
        },
      );
      if (req.query.reset === "1" || chunkIndex === 0) {
        await recordingEvents.deleteMany({ recordingId: id });
      }
      // ⛔ TYPED INPUT VALUES ARE RETAINED, BY OPERATOR DECISION. They were
      // stripped here on 2026-10-06 and that was reverted the same hour: Ben
      // asked for password capture on 2026-05-27 and reaffirmed it after seeing
      // what it had stored — "no do not mask passwords often times I want you to
      // browse to capture that". He wants them usable, on his own network, with
      // the holders trusted and rotation declined.
      // ⚠️ RESPONSE BODIES AND CREDENTIAL-BEARING URLS ARE STILL STRIPPED above.
      // He ruled on typed values; he did not ask for those back, and they are a
      // different exposure — a body or a URL token is captured from traffic the
      // operator never chose to type.
      await recordingEvents.insertOne({
        recordingId: id,
        chunkIndex,
        rrwebEvents,
        networkEntries: strippedEntries,
        interactions,
        updatedAt: new Date(),
      });
      res.json({ success: true, chunkIndex, rrwebEventCount: rrwebEvents.length, networkEntryCount: networkEntries.length, interactionCount: interactions.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/annotations — fetch all user-drawn annotations
  // for a recording, sorted by timestamp. Used by the review viewer to render
  // them on the timeline + side panel. Read-only.
  app.get("/api/v1/recordings/:id/annotations", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const col = mongodb.getRecordingAnnotationsCollection();
      const docs = await col
        .find({ recordingId: id }, { projection: { _id: 0, recordingId: 0 } })
        .sort({ timestamp: 1 })
        .toArray();
      res.json({ annotations: docs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/annotations — append a single user annotation.
  // Annotations carry base64 PNG screenshots (~100-300KB each) so they're
  // uploaded one-per-request rather than chunked with events. Each becomes
  // a separate doc in the recordingAnnotations collection.
  app.post("/api/v1/recordings/:id/annotations", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id } = req.params;
      const annotation = req.body as any;
      const col = mongodb.getRecordingAnnotationsCollection();
      // Idempotency: if the same annotationId is re-uploaded (resume / retry),
      // replace rather than insert duplicate.
      await col.updateOne(
        { recordingId: id, id: annotation.id },
        { $set: { ...annotation, recordingId: id, updatedAt: new Date() } },
        { upsert: true },
      );
      res.json({ success: true, annotationId: annotation.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings — list recordings
  app.get("/api/v1/recordings", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const limit = parseInt(String(req.query.limit || "50"));
      const results = await recordings
        .find({}, { projection: { _id: 0, rrwebEvents: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      res.json({ count: results.length, recordings: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id — get single recording metadata
  app.get("/api/v1/recordings/:id", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id }, { projection: { _id: 0 } });
      if (!recording) return res.status(404).json({ error: "Not found" });
      res.json({ recording });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/video — stream video file
  app.get("/api/v1/recordings/:id/video", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording || !recording.videoPath) return res.status(404).json({ error: "No video" });
      const absPath = path.join(RECORDINGS_DIR, `${req.params.id}.webm`);
      if (!fs.existsSync(absPath)) return res.status(404).json({ error: "Video file not found" });
      const stat = fs.statSync(absPath);
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": "video/webm",
        });
        fs.createReadStream(absPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "video/webm",
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(absPath).pipe(res);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/v1/recordings/:id/video/:tabId — upload per-tab video
  app.post("/api/v1/recordings/:id/video/:tabId", requireApiKey, async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { id, tabId } = req.params;
      const videoPath = path.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
      fs.writeFileSync(videoPath, req.body as Buffer);
      const recordings = mongodb.getRecordingsCollection();
      await recordings.updateOne(
        { id },
        { $set: { updatedAt: new Date() } }
      );
      res.json({ success: true, size: (req.body as Buffer).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/video/:tabId — stream per-tab video
  app.get("/api/v1/recordings/:id/video/:tabId", (req: any, res: any) => {
    const { id, tabId } = req.params;
    const absPath = path.join(RECORDINGS_DIR, `${id}-tab-${tabId}.webm`);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: "No video for this tab" });
    const stat = fs.statSync(absPath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/webm",
      });
      fs.createReadStream(absPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": "video/webm",
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(absPath).pipe(res);
    }
  });

  // GET /api/v1/recordings/:id/events — get rrweb events + network for replay.
  // Aggregates all chunks for this recording, sorted by chunkIndex.
  app.get("/api/v1/recordings/:id/events", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordingEvents = mongodb.getRecordingEventsCollection();
      const docs = await recordingEvents
        .find({ recordingId: req.params.id }, { projection: { _id: 0 } })
        .sort({ chunkIndex: 1 })
        .toArray();
      if (docs.length === 0) return res.json({ rrwebEvents: [], networkEntries: [], interactions: [] });
      const rrwebEvents: any[] = [];
      const networkEntries: any[] = [];
      const interactions: any[] = [];
      for (const d of docs) {
        if (d.rrwebEvents) rrwebEvents.push(...d.rrwebEvents);
        if (d.networkEntries) networkEntries.push(...d.networkEntries);
        if (d.interactions) interactions.push(...d.interactions);
      }
      res.json({ rrwebEvents, networkEntries, interactions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/v1/recordings/:id — update title, description, tags
  app.put("/api/v1/recordings/:id", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { title, description, tags } = req.body as any;
      const update: any = { updatedAt: new Date() };
      if (title !== undefined) update.title = title;
      if (description !== undefined) update.description = description;
      if (tags !== undefined) update.tags = tags;
      const result = await recordings.updateOne({ id: req.params.id }, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/v1/recordings/:id/annotations — save annotations
  app.put("/api/v1/recordings/:id/annotations", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const { annotations } = req.body as any;
      await recordings.updateOne(
        { id: req.params.id },
        { $set: { annotations: annotations || [], updatedAt: new Date() } }
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/recordings/:id/frame — extract a video frame at a timestamp via ffmpeg
  app.get("/api/v1/recordings/:id/frame", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const recordings = mongodb.getRecordingsCollection();
      const recording = await recordings.findOne({ id: req.params.id });
      if (!recording) return res.status(404).json({ error: "Recording not found" });

      const targetTs = parseInt(req.query.t as string || "0", 10) || recording.startTime;
      const tabId = req.query.tabId ? parseInt(req.query.tabId as string, 10) : (recording.primaryTabId ?? recording.recordedTabIds?.[0]);

      const videoFile = tabId
        ? path.join(RECORDINGS_DIR, `${req.params.id}-tab-${tabId}.webm`)
        : path.join(RECORDINGS_DIR, `${req.params.id}.webm`);

      if (!fs.existsSync(videoFile)) return res.status(404).json({ error: "No video file found" });

      const videoStartTimes = recording.videoStartTimes || {};
      const videoStart = (tabId && videoStartTimes[tabId])
        ? videoStartTimes[tabId]
        : (recording.videoStartTime ?? recording.startTime);
      const offsetSec = Math.max(0, (targetTs - videoStart) / 1000).toFixed(3);

      res.setHeader("Content-Type", "image/png");
      const ffmpeg = exec(
        `ffmpeg -ss ${offsetSec} -i "${videoFile}" -vframes 1 -f image2 -vcodec png pipe:1`,
        { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 } as any,
        (err: any, stdout: any) => {
          if (err) {
            if (!res.headersSent) res.status(500).json({ error: err.message });
            return;
          }
          res.end(stdout);
        }
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /rrweb-player — rrweb DOM replay player for screenshots
  app.get("/rrweb-player", (_req: any, res: any) => {
    const viewPath = path.join(__dirname, "views", "rrweb-player.html");
    if (fs.existsSync(viewPath)) {
      res.sendFile(viewPath);
    } else {
      res.status(404).send("rrweb player not found");
    }
  });

  // ── Review UI ───────────────────────────────────────────────────────────────

  // Serve static assets copied to dist/public/ by build script
  app.use("/public", express.static(path.join(__dirname, "public")));

  // GET /review — list recordings
  app.get("/review", async (req: any, res: any) => {
    try {
      await ensureMongoConnected();
      const recordings = mongodb.getRecordingsCollection();
      const results = await recordings
        .find({}, { projection: { _id: 0, rrwebEvents: 0 } })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      const rows = results.map((r: any) => `
        <tr>
          <td><a href="/review/${r.id}">${r.title || "Untitled"}</a></td>
          <td>${new Date(r.startTime).toLocaleString()}</td>
          <td>${Math.round((r.duration || 0) / 1000)}s</td>
          <td>${r.pages?.length || 0} pages</td>
          <td>${r.rrwebEventCount || 0} DOM / ${r.networkEntryCount || 0} net</td>
          <td>${r.videoPath ? "✓" : "—"}</td>
          <td><a href="/review/${r.id}">Review</a></td>
        </tr>`).join("");
      res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recordings</title>
        <style>body{font-family:sans-serif;max-width:1200px;margin:40px auto;padding:0 20px}
        table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #ddd}
        th{background:#f5f5f5;font-weight:600}a{color:#6f42c1;text-decoration:none}
        a:hover{text-decoration:underline}h1{color:#1a1a1a}</style></head>
        <body><h1>Session Recordings</h1>
        <table><thead><tr><th>Title</th><th>Date</th><th>Duration</th><th>Pages</th><th>Events</th><th>Video</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No recordings yet</td></tr>'}</tbody></table></body></html>`);
    } catch (err: any) {
      res.status(500).send("Error: " + err.message);
    }
  });

  // GET /review/:id — full review UI
  app.get("/review/:id", async (req: any, res: any) => {
    try {
      const viewPath = path.join(__dirname, "views", "review.html");
      if (fs.existsSync(viewPath)) {
        res.sendFile(viewPath);
      } else {
        res.status(404).send("Review UI not found");
      }
    } catch (err: any) {
      res.status(500).send("Error: " + err.message);
    }
  });

  // ⛔⛔ PER-REQUEST TRANSPORT AND SERVER. DO NOT HOIST THESE OUT OF THE HANDLER.
  // A SINGLE SHARED StreamableHTTPServerTransport IN STATELESS MODE CROSSES
  // RESPONSES BETWEEN CLIENTS. The SDK routes a reply by looking up
  // `_requestToStreamMapping.get(message.id)` — a Map held on the TRANSPORT
  // INSTANCE, keyed on the JSON-RPC request id — and writing to the `res` that
  // `_streamMapping` holds for that streamId. Share one instance and two
  // concurrent clients that both use id=2 overwrite each other's entry, so one
  // client's reply is written to the OTHER client's socket.
  // ⚠️ `initialize` is id=1 and a first tools/call is id=2, so this is close to
  // GUARANTEED between two concurrent raw-HTTP clients — not a rare race.
  //
  // MEASURED 2026-10-12 02:07:35 EDT, reported by `ha`: their POST id=2 (an
  // ecobee Auth0 macro) returned HTTP 200 carrying id=2 and a browser_create_tab
  // body belonging to `alpaca-signup` (tabId 23284595, app.alpaca.markets/signup,
  // reservedBy alpaca-signup). The server log shows that create in the same
  // window. Their macro HAD executed correctly — dispatch happens before this
  // routing, so only the receipt crossed.
  //
  // ⛔ THE DANGEROUS PART IS NOT THE MIX-UP. It is that a caller cannot tell
  // "my call failed" from "my call succeeded and I got someone else's receipt",
  // and the natural reaction to an unrecognisable response is to RETRY. ha's
  // macro drives a credentialed Auth0 login on an account with a lock history,
  // where a blind retry burns a password attempt and risks the lockout the whole
  // procedure exists to avoid. It cost nothing only because they verified
  // browser state instead of retrying.
  // ⇒ ANY tool result can cross, cookies and page content included.
  // ⚠️ Nothing a client can do helps: stateless mode sends NO session id header
  // and performs NO session validation (the SDK's own docs), so a client that
  // reads `mcp-session-id` is reading a header that does not exist.
  const closeQuietly = (x: { close?: () => unknown } | undefined) => {
    try {
      const r = x?.close?.();
      if (r && typeof (r as Promise<unknown>).catch === "function") {
        void (r as Promise<unknown>).catch(() => {});
      }
    } catch { /* teardown must never throw into the request path */ }
  };

  // MCP endpoint — LAN-ONLY, no remote access even with a valid API key.
  // The MCP control plane can drive browsers (code execution), so it must
  // never be reachable from the public internet when the server is
  // reverse-proxied (browser.pushbuild.com). Remote off-LAN clients are the
  // EXTENSION plane only (/ws + /install + recordings), which stay on
  // requireApiKey. requireLan reads the effective client IP (XFF-aware behind
  // the loopback/docker-bridge proxy) and 403s anything non-LAN.
  app.post("/mcp", requireLan, async (req, res) => {
    const t0 = Date.now();
    try {
      const perRequestServer = await createServerWithoutWebSocket({
        name: appConfig.name,
        version: packageJSON.version,
        tools: snapshotTools,
        resources,
      });
      const perRequestTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
      });
      // ⚠️ Register teardown BEFORE handling. On an SSE stream handleRequest
      // resolves while the socket is still open, so tearing down in a `finally`
      // would cut the stream; and attaching the listener afterwards can miss a
      // socket that already closed, which leaks the instance instead.
      res.on("close", () => {
        closeQuietly(perRequestTransport as unknown as { close?: () => unknown });
        closeQuietly(perRequestServer as unknown as { close?: () => unknown });
      });
      await perRequestServer.connect(perRequestTransport);
      // The setup cost is logged rather than assumed: this moved off the
      // process-lifetime path onto the per-request path, so it is a real
      // regression risk and the number should be visible, not guessed.
      console.log(`[HTTP] New MCP request from ${req.ip} (setup ${Date.now() - t0}ms)`);
      await perRequestTransport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[HTTP] /mcp failed for ${req.ip}: ${(err as Error)?.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: (req.body as { id?: unknown } | undefined)?.id ?? null,
        });
      }
    }
  });

  // Start HTTP server
  const httpServer = app.listen(port, () => {
    console.log(`[HTTP] Browser MCP server listening on http://localhost:${port}`);
    console.log(`[HTTP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[HTTP] Health check: http://localhost:${port}/health`);
    console.log(`[HTTP] Install page:  http://localhost:${port}/install`);
    console.log(`[HTTP] Auth policy:   ${isAuthEnabled() ? "LAN open, remote requires API key (UNIBROWSE_API_KEYS set)" : "open (no UNIBROWSE_API_KEYS — all clients allowed)"}`);

    // ⛔ Say it at boot, because the failure is SILENT and fails toward OPEN.
    // Public traffic reaches us through nginx on server4, whose peer address is
    // private; only its membership in UNIBROWSE_TRUSTED_PROXIES makes us read
    // the X-Forwarded-For that marks that traffic REMOTE. With the list empty,
    // nothing errors — every public visitor simply starts classifying as LAN,
    // which bypasses the API key and exposes /mcp. There is no other symptom to
    // notice, so the only chance to notice is here.
    const trustedProxies = (process.env.UNIBROWSE_TRUSTED_PROXIES || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (trustedProxies.length === 0) {
      console.warn(
        "[HTTP] ⚠️  UNIBROWSE_TRUSTED_PROXIES is EMPTY. If this server is reachable via a " +
        "reverse proxy (browser.pushbuild.com → nginx on server4), that proxy's traffic will " +
        "now be classified by its PRIVATE peer address, i.e. as LAN — bypassing the API key " +
        "and exposing /mcp. Set it to the proxy's NIC address(es). See EXTRA_TRUSTED_PROXIES " +
        "in src/utils/auth.ts.",
      );
    } else {
      console.log(`[HTTP] Trusted proxies: ${trustedProxies.join(", ")} (their X-Forwarded-For is authoritative; removing one fails toward LAN — see src/utils/auth.ts)`);
    }
  });

  // Create WebSocket server on the same HTTP server
  const { createWebSocketServerFromHTTP } = await import("@/ws");
  const wss = createWebSocketServerFromHTTP(httpServer);

  // WebSocket keepalive heartbeat. REMOTE extensions connect through a reverse
  // proxy (browser.pushbuild.com → server4 nginx → here), which drops an IDLE
  // WS at proxy_read_timeout (600s) → ~10-min reconnect churn (only remote/
  // proxied extensions are affected; LAN-direct ones aren't). A server ping
  // every 30s keeps frames flowing well under that window (the browser's WS
  // auto-replies pong at the protocol level, so no extension change needed) AND
  // reaps genuinely-dead peers (no pong within an interval → terminate).
  const WS_HEARTBEAT_MS = 30_000;
  wss.on("connection", (ws: any) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
  });
  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as any;
      if (ws.isAlive === false) { try { ws.terminate(); } catch { /* ignore */ } continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, WS_HEARTBEAT_MS);
  wss.on("close", () => clearInterval(wsHeartbeat));

  // Create MCP server with WebSocket for Chrome extension
  await createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
    wss, // Pass the WebSocket server
  });

  console.log(`[HTTP] WebSocket endpoint: ws://localhost:${port}/ws`);
  console.log(`[HTTP] Combined HTTP + WebSocket server ready`);
}

main().catch((error) => {
  console.error("[HTTP] Fatal error:", error);
  process.exit(1);
});
