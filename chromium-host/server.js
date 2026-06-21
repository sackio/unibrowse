// Chromium-host RPC: spawns + tracks + reaps container chromiums on behalf
// of the mcp-server, which lives in a separate container. Decouples chromium
// lifecycle from mcp-server lifecycle so deploys / restarts of the mcp-server
// don't kill in-flight Auth0 sessions / broker tabs.
//
// Endpoints (all JSON, port 9020, docker-network-only):
//   POST /launch     → spawn chromium + paired Xvfb. Returns {pid, display}.
//   GET  /processes  → list tracked chromiums (pid, profileName, startedAt, alive).
//   DELETE /processes/:pid → SIGTERM the chromium (graceful close).
//   GET  /health     → liveness probe.
//
// All the spawn / Xvfb / signal-handling / startup-cleanup / profile-self-heal
// logic from src/tools/chrome-launcher.ts lives HERE now. The client side in
// mcp-server becomes a thin HTTP POST.

import { spawn, execSync } from "node:child_process";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = parseInt(process.env.PORT || "9020", 10);
const PROFILES_DIR = process.env.PROFILES_DIR || "/app/.chrome-profiles";
const EXTENSION_DIR = process.env.EXTENSION_DIR || "/app/extension";
const CHROME_BIN = process.env.CHROME_PATH || "/usr/bin/chromium-browser";

/** Track spawned chromium + Xvfb procs for graceful close + visibility. */
const launchedProcesses = new Map(); // pid → { proc, profileName, startedAt, display }
const launchedXvfbs = new Map();     // pid → { proc, display }

/* ---------- Startup cleanup -------------------------------------------- */
// Wipes stale SingletonLock/Socket/Cookie + stale /tmp/.X11-unix sockets
// from previous incarnations. Run once at boot.
const runStartupCleanup = () => {
  const cleaned = [];
  if (fs.existsSync(PROFILES_DIR)) {
    for (const profile of fs.readdirSync(PROFILES_DIR)) {
      for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
        const p = path.join(PROFILES_DIR, profile, lock);
        try { fs.lstatSync(p); fs.unlinkSync(p); cleaned.push(p); } catch {}
      }
    }
  }
  if (fs.existsSync("/tmp/.X11-unix")) {
    for (const f of fs.readdirSync("/tmp/.X11-unix")) {
      if (!/^X\d+$/.test(f)) continue;
      const p = path.join("/tmp/.X11-unix", f);
      try { fs.unlinkSync(p); cleaned.push(p); } catch {}
    }
  }
  if (cleaned.length) console.log(`[chromium-host] startup cleanup: ${cleaned.length} stale lock/socket(s) removed`);
};

/* ---------- Profile self-heal ------------------------------------------ */
const selfHealProfile = (profileDir) => {
  const prefs = path.join(profileDir, "Default", "Preferences");
  if (!fs.existsSync(prefs)) return;
  try {
    const obj = JSON.parse(fs.readFileSync(prefs, "utf8"));
    let dirty = false;
    if (obj?.profile?.exit_type && obj.profile.exit_type !== "Normal") {
      obj.profile.exit_type = "Normal"; dirty = true;
    }
    if (obj?.profile?.exited_cleanly === false) {
      obj.profile.exited_cleanly = true; dirty = true;
    }
    if (dirty) {
      fs.writeFileSync(prefs, JSON.stringify(obj));
      console.log(`[chromium-host] self-healed ${prefs}`);
    }
  } catch (e) { console.warn(`[chromium-host] self-heal failed (${prefs}): ${e.message}`); }
};

/* ---------- Stale extension state cleanup (freshProfile:false) -------- */
// Diagnosed 2026-06-11 (ha + ben): launching with freshProfile:false against
// a profile whose prior chromium was killed mid-flight (e.g. dead PID 19
// holding the ecobee-broker profile) causes the new chromium to die during
// service-worker startup — extension never registers, upstream sees
// `extensionId: None`. Wiping the whole profile fixes it but loses auth
// cookies (Auth0 SSO, OAuth refresh tokens, etc.), which the ecobee_silent
// broker depends on (freshProfile:false is by design).
//
// Intermediate tier: wipe ONLY the directories tied to extension/runtime
// state that go stale across launches, while preserving Cookies / Login
// Data / Local Storage / IndexedDB / page-side persistent storage.
//
// Wiped:
//   Singleton{Lock,Socket,Cookie}        — point at the dead chromium's PID
//   Default/Service Worker               — chromium's SW database (extension
//                                          SW + page SWs; page SWs reinstall
//                                          themselves cheaply on next visit)
//   Default/Extension State              — chromium's per-extension state
//   Default/Local Extension Settings     — extension's chrome.storage.local
//                                          (incl. stable __unibrowseExtensionId,
//                                          stale server_config). Seed CS
//                                          re-populates on next load.
//   Default/Extension Scripts            — chromium's extension script cache
//   Default/Extension Rules              — declarativeNetRequest rules cache
//
// Preserved (the whole point — Auth0 cookies live here):
//   Default/Cookies + Cookies-journal    — login session
//   Default/Login Data + journal         — saved passwords
//   Default/Local Storage                — page-side localStorage
//   Default/Session Storage              — page-side sessionStorage
//   Default/IndexedDB                    — page-side IndexedDB
//   Default/Web Data                     — autofill / forms
const STALE_EXTENSION_DIRS = [
  "Default/Service Worker",
  "Default/Extension State",
  "Default/Local Extension Settings",
  "Default/Extension Scripts",
  "Default/Extension Rules",
];
const STALE_SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
const wipeStaleExtensionData = (profileDir) => {
  const removed = [];
  for (const f of STALE_SINGLETON_FILES) {
    const p = path.join(profileDir, f);
    try { fs.lstatSync(p); fs.unlinkSync(p); removed.push(f); } catch {}
  }
  for (const rel of STALE_EXTENSION_DIRS) {
    const p = path.join(profileDir, rel);
    if (!fs.existsSync(p)) continue;
    try {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(rel);
    } catch (e) {
      // NFS sillyrename / EBUSY: profiles dir is bind-mounted host-side. If
      // unlink fails, rename aside so the next launch isn't blocked.
      if (e?.code === "EBUSY" || e?.code === "ENOTEMPTY") {
        const aside = `${p}.dead-${Date.now()}`;
        try { fs.renameSync(p, aside); removed.push(`${rel} (→ ${path.basename(aside)})`); }
        catch (mvErr) { console.warn(`[chromium-host] wipeStale ${rel} failed: rm=${e.message} rename=${mvErr.message}`); }
      } else {
        console.warn(`[chromium-host] wipeStale ${rel} failed: ${e.message}`);
      }
    }
  }
  if (removed.length) console.log(`[chromium-host] wipeStale ${profileDir}: ${removed.join(", ")}`);
};

/* ---------- Managed server seed --------------------------------------- */
// Write a tiny JSON file into each profile telling the extension which MCP
// server URL to connect to. The extension's server-resolver checks here
// before falling back to localhost autodetect.
const writeServerSeed = (profileDir, serverHint) => {
  if (!serverHint) return;
  const seed = { url: serverHint, writtenBy: "chromium-host", at: new Date().toISOString() };
  try {
    fs.writeFileSync(path.join(profileDir, "managed-server.json"), JSON.stringify(seed));
  } catch (e) { console.warn(`[chromium-host] failed to write managed-server.json: ${e.message}`); }
};

/* ---------- Reap pre-existing chromium for same profile ---------------- */
// If a chromium is still alive for this profile, SIGTERM it before we wipe
// the profile or spawn a new one. Without this, the new chromium tries to
// acquire SingletonLock against a running peer using the same user-data-dir
// and either dies silently or comes up degraded — its extension never
// connects to mcp-server, which surfaces upstream as `extensionId: None`
// from browser_launch_isolated_chrome. (Diagnosed 2026-06-11: ha's
// ecobee_silent broker had been hitting a 16-day-old container PID 19
// holding the ecobee-broker profile after a recent extension-reload nuked
// its WS registration.)
//
// We look in TWO places: (1) our own launchedProcesses tracking map, and
// (2) raw `ps` for any chromium with `--user-data-dir=<that profile>`.
// (2) catches chromiums that survived a chromium-host process restart
// (they keep running but the tracking map is empty after our reboot).
const reapExistingForProfile = async (profileName) => {
  const profileDir = path.join(PROFILES_DIR, profileName);
  const tracked = []; // {pid, proc}
  for (const [pid, v] of launchedProcesses) {
    if (v.profileName === profileName) tracked.push({ pid, proc: v.proc });
  }
  // ps-scan for untracked chromiums using the same profile dir.
  const untrackedPids = [];
  try {
    const out = execSync(
      // -ww: don't truncate the arg list; we need the full --user-data-dir match
      `ps -eww -o pid=,args= | grep -F -- "--user-data-dir=${profileDir}" | grep -v grep || true`,
      { encoding: "utf8" }
    );
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const args = m[2];
      // Skip helper procs (zygote/gpu/utility/renderer) — only the main
      // chromium process holds the SingletonLock.
      if (/--type=(zygote|gpu-process|utility|renderer)/.test(args)) continue;
      if (tracked.some((t) => t.pid === pid)) continue;
      untrackedPids.push(pid);
    }
  } catch (e) { console.warn(`[chromium-host] ps scan failed: ${e.message}`); }

  if (!tracked.length && !untrackedPids.length) return;
  console.log(`[chromium-host] reaping for profile ${profileName}: tracked=[${tracked.map(t=>t.pid).join(",")}] untracked=[${untrackedPids.join(",")}]`);

  for (const t of tracked) {
    try { t.proc.kill("SIGTERM"); }
    catch (e) { console.warn(`[chromium-host] SIGTERM tracked pid=${t.pid} failed: ${e.message}`); }
  }
  for (const pid of untrackedPids) {
    try { process.kill(pid, "SIGTERM"); }
    catch (e) { console.warn(`[chromium-host] SIGTERM untracked pid=${pid} failed: ${e.message}`); }
  }

  // Wait up to 3s for all to die. Tracked drop out of launchedProcesses via
  // their exit handler; untracked we re-check with kill(0).
  const allPids = [...tracked.map(t => t.pid), ...untrackedPids];
  const deadline = Date.now() + 3000;
  const isAlive = (pid) => {
    if (launchedProcesses.has(pid)) return true;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  while (Date.now() < deadline) {
    if (!allPids.some(isAlive)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const pid of allPids) {
    if (!isAlive(pid)) continue;
    try {
      console.warn(`[chromium-host] pid=${pid} did not exit on SIGTERM; SIGKILL`);
      process.kill(pid, "SIGKILL");
    } catch (e) { console.warn(`[chromium-host] SIGKILL pid=${pid} failed: ${e.message}`); }
  }
  // Final settle for the kernel to release file handles on the profile dir
  // so the imminent rmSync succeeds first time.
  await new Promise((r) => setTimeout(r, 200));
};

/* ---------- Launch a chromium ------------------------------------------ */
const launchChromium = async ({
  profileName,
  urls = ["chrome://extensions/"],
  freshProfile = true,
  headless = false,
  width,
  height,
  serverHint,            // e.g. "ws://mcp-server:9010/ws"
}) => {
  if (!profileName) throw new Error("profileName is required");
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const profileDir = path.join(PROFILES_DIR, profileName);
  // Reap any tracked chromium for this profileName first — fresh-launch
  // semantics require we don't co-exist with a stale instance holding the
  // SingletonLock. This runs whether or not freshProfile is set, because the
  // collision happens regardless of whether the dir is wiped.
  await reapExistingForProfile(profileName);
  // NFS-resilient cleanup — see chrome-launcher.ts for the rationale.
  // .nfsXXXX sillyrenames from the previous chromium can throw EBUSY on
  // unlink; fall back to renaming the dir aside so the fresh launch isn't
  // blocked. External sweep reaps *.dead-* later.
  if (freshProfile && fs.existsSync(profileDir)) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (rmErr) {
      if (rmErr?.code === "EBUSY" || rmErr?.code === "ENOTEMPTY") {
        const aside = `${profileDir}.dead-${Date.now()}`;
        try {
          fs.renameSync(profileDir, aside);
          console.warn(`[chromium-host] rmSync EBUSY (NFS sillyrename?); renamed ${profileDir} → ${aside}`);
        } catch (mvErr) {
          console.error(`[chromium-host] could not clear ${profileDir}: rm=${rmErr.message} rename=${mvErr.message}. Launching with stale profile.`);
        }
      } else {
        throw rmErr;
      }
    }
  }
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  if (!freshProfile) {
    // Intermediate cleanup tier for persistent-profile launches: wipe
    // extension/SW state that goes stale across launches while preserving
    // Cookies / Login Data / IndexedDB. Required because brokers like
    // ecobee_silent hardcode freshProfile:false to keep Auth0 cookies but
    // need a clean extension-side slate. See wipeStaleExtensionData() for
    // full diagnosis.
    wipeStaleExtensionData(profileDir);
    selfHealProfile(profileDir);
  }
  writeServerSeed(profileDir, serverHint);

  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${EXTENSION_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-features=TranslateUI",
    "--disable-default-apps",
    "--no-sandbox", "--disable-dev-shm-usage",   // we're in a container
  ];
  if (width && height) args.push(`--window-size=${width},${height}`);
  if (headless) args.push("--headless=new", "--disable-gpu");
  args.push(...urls);

  const env = { ...process.env };
  let xvfb = null, display = null;
  if (!headless) {
    display = `:${90 + Math.floor(Math.random() * 100)}`;
    try {
      xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x1024x24", "-nolisten", "tcp"], { detached: true, stdio: "ignore" });
      xvfb.unref();
      const start = Date.now();
      while (Date.now() - start < 1500) {
        if (fs.existsSync(`/tmp/.X11-unix/X${display.slice(1)}`)) break;
        execSync("sleep 0.1");
      }
      env.DISPLAY = display;
      console.log(`[chromium-host] spawned Xvfb ${display} (pid ${xvfb.pid}) for ${profileName}`);
    } catch (e) {
      console.warn(`[chromium-host] Xvfb spawn failed: ${e.message}`);
      xvfb = null;
    }
  }

  const proc = spawn(CHROME_BIN, args, { detached: true, stdio: "ignore", env });
  proc.unref();
  if (!proc.pid) throw new Error("failed to spawn chromium (no pid)");

  launchedProcesses.set(proc.pid, { proc, profileName, startedAt: Date.now(), display });
  proc.once("exit", () => launchedProcesses.delete(proc.pid));
  if (xvfb?.pid) {
    launchedXvfbs.set(xvfb.pid, { proc: xvfb, display });
    xvfb.once("exit", () => launchedXvfbs.delete(xvfb.pid));
  }
  return { pid: proc.pid, display, profileDir };
};

/* ---------- Signal handler --------------------------------------------- */
let shuttingDown = false;
const shutdown = (sig) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[chromium-host] ${sig} — closing ${launchedProcesses.size} chromium(s)...`);
  for (const [pid, { proc }] of launchedProcesses) { try { proc.kill("SIGTERM"); } catch {} }
  for (const [pid, { proc }] of launchedXvfbs) { try { proc.kill("SIGTERM"); } catch {} }
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

/* ---------- HTTP server ------------------------------------------------ */
const readBody = (req) => new Promise((resolve, reject) => {
  let buf = "";
  req.on("data", (c) => buf += c);
  req.on("end", () => resolve(buf));
  req.on("error", reject);
});
const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, running: launchedProcesses.size });
    }
    if (req.method === "GET" && req.url === "/processes") {
      const list = Array.from(launchedProcesses.entries()).map(([pid, v]) => ({
        pid, profileName: v.profileName, startedAt: v.startedAt, display: v.display, alive: !v.proc.killed,
      }));
      return send(res, 200, { processes: list });
    }
    if (req.method === "POST" && req.url === "/launch") {
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await launchChromium(body);
      return send(res, 200, result);
    }
    const delMatch = req.method === "DELETE" && req.url?.match(/^\/processes\/(\d+)$/);
    if (delMatch) {
      const pid = parseInt(delMatch[1], 10);
      const entry = launchedProcesses.get(pid);
      if (!entry) return send(res, 404, { error: "not found" });
      try { entry.proc.kill("SIGTERM"); return send(res, 200, { ok: true }); }
      catch (e) { return send(res, 500, { error: e.message }); }
    }
    send(res, 404, { error: "no route", method: req.method, url: req.url });
  } catch (e) {
    console.error(`[chromium-host] handler error:`, e);
    send(res, 500, { error: e.message });
  }
});

runStartupCleanup();
server.listen(PORT, () => console.log(`[chromium-host] listening on :${PORT}, profiles=${PROFILES_DIR}, extension=${EXTENSION_DIR}`));
