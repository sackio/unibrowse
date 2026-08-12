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

/* ---------- Persistent-profile allowlist ------------------------------- */
// Some profiles are NOT disposable: they hold long-lived auth state that is
// expensive to rebuild. `ecobee-broker` is the canonical case — a cookie
// holder for ha's ecobee_silent integration, sitting on an Auth0 SSO session
// that mints silent JWTs for three thermostats. It is idle BY DESIGN (weeks
// can pass with no interaction while it works perfectly), which is exactly
// why an activity-keyed reaper is the wrong instrument: it would
// preferentially kill whatever is most correct.
//
// An entry protects the profile from BOTH destroyers:
//   (1) the automatic reaper below, and
//   (2) `freshProfile:true` wiping profileDir at launch (the default!).
// It deliberately does NOT block reapExistingForProfile() during a launch of
// that same profile — that is the OWNER relaunching, and blocking it would
// break their self-heal.
//
// `owner` and `resetCost` are REQUIRED. That keeps the refusal text accurate
// per-profile (written by whoever knows the consequence, not hardcoded from
// one example), makes the owner DM deliverable at all, and forces whoever
// declares a profile persistent to articulate what breaks if it isn't.
//
// ⚠️ Read fresh on EVERY check, never cached: restarting this sidecar to pick
// up a config change would kill every chromium it tracks — including the ones
// the file exists to protect.
const PERSISTENT_FILE = process.env.PERSISTENT_FILE || path.join(PROFILES_DIR, "_persistent.json");
const loadPersistent = () => {
  try {
    if (!fs.existsSync(PERSISTENT_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(PERSISTENT_FILE, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw.profiles || []);
    const ok = [];
    for (const e of list) {
      if (!e?.profileName) { console.warn(`[chromium-host] persistent entry skipped: no profileName`); continue; }
      if (!e.owner) { console.warn(`[chromium-host] persistent entry "${e.profileName}" skipped: owner is REQUIRED`); continue; }
      if (!e.resetCost) { console.warn(`[chromium-host] persistent entry "${e.profileName}" skipped: resetCost is REQUIRED`); continue; }
      ok.push(e);
    }
    return ok;
  } catch (e) {
    // Fail SAFE: an unreadable allowlist must not silently downgrade to
    // "nothing is protected". Treat parse failure as protect-everything by
    // returning a sentinel the callers honour.
    console.error(`[chromium-host] persistent allowlist unreadable (${e.message}) — failing SAFE (all profiles treated persistent)`);
    return null;
  }
};
const persistentEntry = (profileName) => {
  const list = loadPersistent();
  if (list === null) {
    return { profileName, owner: "unknown", resetCost: "unknown — allowlist file is unreadable, so this profile is protected by default", _failSafe: true };
  }
  return list.find((e) => e.profileName === profileName) || null;
};

/** ha's redraft: lead with the SAFE path, override last. */
const persistentRefusal = (entry, action) => [
  `EPERSISTENT: profile "${entry.profileName}" is marked persistent (owner: session \`${entry.owner}\`)`,
  ` — refusing to ${action}.`,
  ``,
  `YOU PROBABLY WANT A RESTART, NOT A WIPE.`,
  `A process-only restart reuses the profile and self-heals:`,
  `    browser_launch_isolated_chrome({profileName:"${entry.profileName}", freshProfile:false})`,
  `Try that first — it clears a hung or crashed chromium without touching auth state.`,
  ``,
  `Cost of wiping THIS profile: ${entry.resetCost}`,
  ``,
  `Not session \`${entry.owner}\`? Ask them before overriding.`,
  ``,
  `To deliberately reset anyway, re-issue with BOTH:`,
  `    freshProfile: true`,
  `    forceProfileName: "${entry.profileName}"`,
  `The profileName must be repeated verbatim. This friction is intentional.`,
  `Overrides are logged (caller + timestamp) and the owner is DM'd.`,
].join("\n");

/* ---------- Owner notification (best-effort, never throws) ------------- */
// Verified reachable from this container 2026-08-01 (POST → 201, delivered).
// Every exemption mechanism can fail; the difference between recoverable and
// catastrophic is whether the owner finds out in minutes or in days. So a
// reap or an override is ALWAYS announced — but a notify failure must never
// break or block the operation it is reporting.
const ATC_URL = process.env.ATC_URL || "http://192.168.1.168:3030/messages";

// ⚠️ DRILL MARKING (ha, 2026-08-01, after a live routing test). A rehearsal and
// a real incident were indistinguishable by priority — both `critical`, with
// only the content differing. The failure mode is the INVERSE of alert fatigue:
// a drill that looks identical to the real thing teaches the recipient that
// this alert is usually a drill, so the one that isn't gets pattern-matched
// away. An allowlist entry with `drill: true` therefore marks its notifications
// structurally, not just by wording, and drops them to `info`.
const drillTag = (entry) => (entry?.drill ? "[DRILL] " : "");
const drillPriority = (entry, real) => (entry?.drill ? "info" : real);
// Point the reader at where to look, not just what happened — matters for
// whoever reads this cold, which is the likely case for a rare alert.
const WHERE_TO_LOOK =
  "\n\nInspect current state: GET /reaper on chromium-host — lists every tracked " +
  "instance with persistent / owner / wouldReap, without waiting for a sweep.";
const notifyOwner = (owner, subject, content, priority = "warning") => {
  if (!owner || owner === "unknown") return;
  try {
    const u = new URL(ATC_URL);
    const body = JSON.stringify({ to: owner, from: "chromium-host", subject, content, priority });
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 5000,
    }, (res) => { res.resume(); });
    req.on("timeout", () => { console.warn(`[chromium-host] notify ${owner}: timeout`); req.destroy(); });
    req.on("error", (e) => console.warn(`[chromium-host] notify ${owner} failed: ${e.message}`));
    req.write(body); req.end();
  } catch (e) { console.warn(`[chromium-host] notify ${owner} threw: ${e.message}`); }
};

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
  const tracked = []; // {pid, proc, display}
  for (const [pid, v] of launchedProcesses) {
    // ⚠️ Capture `display` HERE, before anything is killed. The first version
    // of the Xvfb reap below read launchedProcesses AFTER the kill+3s wait —
    // but each proc's own "exit" handler deletes its entry, so by then the
    // displays were already gone and the reap matched nothing. It silently did
    // nothing at all, and the leak looked fixed because the common path
    // (destroyInstance) was reaping correctly on its own.
    if (v.profileName === profileName) tracked.push({ pid, proc: v.proc, display: v.display });
  }
  // ps-scan for untracked chromiums using the same profile dir.
  const untrackedPids = [];
  try {
    // ⚠️ MUST be `ps -o pid,args`. This previously used `ps -eww -o pid=,args=`
    // — but this container is BUSYBOX, whose ps rejects `-w` outright
    // ("ps: unrecognized option: w"). execSync therefore threw, the catch below
    // logged a warning nobody read, and untrackedPids stayed EMPTY. So this
    // entire fallback — whose stated job is catching chromiums that survived a
    // chromium-host restart, i.e. exactly when launchedProcesses is empty and
    // this is the ONLY defence — has never once worked.
    // Verified 2026-08-01: with a chromium provably holding ecobee-broker, the
    // -eww form matched 0 processes and this form matched 1.
    // busybox ps prints full args (not truncated), so -ww was never needed.
    const out = execSync(
      `ps -o pid,args | grep -F -- "--user-data-dir=${profileDir}" | grep -v grep || true`,
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

  // ⚠️ TEAR DOWN THE PAIRED XVFBs TOO. destroyInstance() already does this and
  // carries a comment explaining why: without it "a fix for the leak merely
  // relocates it — the chromium dies, the Xvfb lingers, and a display number
  // burns on every cycle." That fix was applied there and never propagated
  // HERE, which is the path every RELAUNCH takes. Measured 2026-08-12: a caller
  // relaunching `ecobee-broker` every ~75s leaked one Xvfb per cycle and
  // consumed the whole :90-:189 range (100 live Xvfbs, host load 8) in a few
  // hours, after which every launch landed on a random already-occupied
  // display. The chromium reap above was working perfectly the entire time —
  // which is exactly why nobody looked here.
  const freedDisplays = new Set();
  for (const t of tracked) if (t.display) freedDisplays.add(t.display);
  for (const [xpid, v] of launchedXvfbs) {
    if (!v.display || !freedDisplays.has(v.display)) continue;
    // Don't kill an Xvfb some OTHER still-live chromium is sharing.
    const shared = Array.from(launchedProcesses.entries())
      .some(([p, e2]) => !allPids.includes(p) && e2.display === v.display);
    if (shared) { console.warn(`[chromium-host] display ${v.display} shared; leaving Xvfb ${xpid} up`); continue; }
    try { v.proc.kill("SIGTERM"); launchedXvfbs.delete(xpid); } catch {}
    console.log(`[chromium-host] reaped Xvfb ${xpid} (${v.display}) paired to ${profileName}`);
  }

  // Final settle for the kernel to release file handles on the profile dir
  // so the imminent rmSync succeeds first time.
  await new Promise((r) => setTimeout(r, 200));
};

/* ---------- Orphan-Xvfb sweep ------------------------------------------ */
// The backstop. Every targeted reap is keyed on knowing which Xvfb belongs to
// which chromium — via launchedXvfbs, or the tracked entry's `display`. Both
// fail for an instance that outlived a chromium-host restart, because the
// tracking maps start empty and nothing reconstructs them. That is precisely
// the population that accumulates.
//
// So instead of trusting bookkeeping, ask the kernel: an Xvfb whose display
// has no chromium on it is garbage, however it got that way. This is what
// would have caught the original 100-display exhaustion regardless of which
// path leaked it.
//
// ⚠️ Age guard: an Xvfb we spawned seconds ago legitimately has no chromium
// yet (we spawn it, wait for the socket, THEN spawn chromium). Untracked
// Xvfbs need no guard — they predate this process, so they cannot be mid-launch.
const XVFB_ORPHAN_GRACE_MS = 60_000;

const scanProcs = () => {
  const xvfbs = [];        // {pid, display}
  const chromeDisplays = new Set();
  let pids = [];
  try { pids = fs.readdirSync("/proc").filter(n => /^\d+$/.test(n)); } catch { return { xvfbs, chromeDisplays }; }
  for (const pid of pids) {
    let cmd;
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
    if (!cmd) continue;
    const parts = cmd.split("\0").filter(Boolean);
    if (!parts.length) continue;
    if (/(^|\/)Xvfb$/.test(parts[0])) {
      const d = parts.find(a => /^:\d+$/.test(a));
      if (d) xvfbs.push({ pid: parseInt(pid, 10), display: d });
      continue;
    }
    if (!parts.some(a => a.startsWith("--user-data-dir="))) continue;
    if (parts.some(a => /^--type=/.test(a))) continue;   // helper proc, not the browser
    try {
      const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
      const m = env.split("\0").find(v => v.startsWith("DISPLAY="));
      if (m) chromeDisplays.add(m.slice("DISPLAY=".length));
    } catch { /* raced with exit */ }
  }
  return { xvfbs, chromeDisplays };
};

const reapOrphanXvfbs = (reason = "sweep") => {
  const { xvfbs, chromeDisplays } = scanProcs();
  const now = Date.now();
  let reaped = 0;
  for (const { pid, display } of xvfbs) {
    if (chromeDisplays.has(display)) continue;
    const tracked = launchedXvfbs.get(pid);
    if (tracked && now - (tracked.spawnedAt || 0) < XVFB_ORPHAN_GRACE_MS) continue;  // mid-launch
    try {
      process.kill(pid, "SIGTERM");
      launchedXvfbs.delete(pid);
      reaped++;
    } catch { /* already gone */ }
  }
  if (reaped) console.log(`[chromium-host] orphan-Xvfb sweep (${reason}): reaped ${reaped} display(s) with no chromium`);
  return reaped;
};

/* ---------- Relaunch-loop breaker -------------------------------------- */
// A caller whose recovery for "my browser isn't working" is "relaunch it" will
// relaunch forever, because relaunching is itself destructive: it wipes the
// profile's extension storage and therefore the stable extensionId the caller
// was looking for. The retry destroys the thing it is retrying for.
//
// Measured 2026-08-12: ha's `ecobee-broker` was relaunched 1,329 times in 26
// hours — one every ~75s, sustained, each leaking an Xvfb until the whole
// :90-:189 display range was gone and office sat at load 8. Nothing anywhere
// in the path said "this is the 400th time."
//
// ⭐ The guard is a LOOP DETECTOR, not a cooldown. A fixed minimum interval
// would punish legitimate rapid relaunches (a test harness, a human iterating)
// while a 75s loop sails straight through it — 75s is already slower than any
// cooldown worth setting. What distinguishes a loop is SUSTAINED repetition,
// so that is what to measure.
const LOOP_WINDOW_MS = parseInt(process.env.LOOP_WINDOW_MS || `${15 * 60 * 1000}`, 10);
const LOOP_MAX_LAUNCHES = parseInt(process.env.LOOP_MAX_LAUNCHES || "8", 10);
const launchHistory = new Map();   // profileName → [epochMs, ...]

const detectRelaunchLoop = (profileName) => {
  if (!profileName) return null;
  const now = Date.now();
  const hist = (launchHistory.get(profileName) || []).filter(t => now - t < LOOP_WINDOW_MS);
  hist.push(now);
  launchHistory.set(profileName, hist);
  if (hist.length <= LOOP_MAX_LAUNCHES) return null;
  const spanMin = Math.round((now - hist[0]) / 60000) || 1;
  console.warn(
    `[chromium-host] RELAUNCH LOOP: "${profileName}" launched ${hist.length}x in ${spanMin}min — refusing. ` +
    `Relaunching wipes the profile's extension storage, so the extensionId changes every cycle; ` +
    `if the caller is retrying because the id went missing, retrying is what removed it.`
  );
  return {
    error: "ERELAUNCHLOOP",
    profileName,
    launches: hist.length,
    windowMinutes: Math.round(LOOP_WINDOW_MS / 60000),
    message:
      `Refusing to relaunch "${profileName}": ${hist.length} launches in the last ${spanMin} minutes ` +
      `looks like a retry loop. Each relaunch WIPES this profile's extension storage and mints a NEW ` +
      `extensionId, so if you are relaunching because the extensionId you had stopped working, the ` +
      `relaunch is the cause and not the cure. Attach to the existing instance instead ` +
      `(browser_list_attached_tabs shows the current extensionId), or wait out the window. ` +
      `Tune with LOOP_MAX_LAUNCHES / LOOP_WINDOW_MS.`,
  };
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
  forceProfileName,      // must equal profileName verbatim to wipe a persistent profile
  caller,                // optional session id, for the override audit line
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
  // ⚠️ PERSISTENT GUARD — the second destroyer. `freshProfile` DEFAULTS TO
  // TRUE, so an ordinary-looking relaunch silently wipes profileDir and any
  // auth state in it. For a persistent profile that must be deliberate, and
  // the override has to NAME the profile: a bare `force:true` gets set once
  // in a helper and inherited by every later call, so the friction evaporates
  // without anyone noticing. `forceProfileName` cannot be inherited usefully.
  if (freshProfile) {
    const pe = persistentEntry(profileName);
    if (pe && forceProfileName !== profileName) {
      const err = new Error(persistentRefusal(pe, "wipe profileDir (freshProfile:true)"));
      err.code = "EPERSISTENT";
      throw err;
    }
    if (pe) {
      const who = caller || "unknown caller";
      console.warn(`[chromium-host] PERSISTENT OVERRIDE: "${profileName}" wiped by ${who} at ${new Date().toISOString()} (forceProfileName matched)`);
      notifyOwner(pe.owner,
        `${drillTag(pe)}⚠️ persistent profile "${profileName}" was force-wiped`,
        `${pe.drill ? "*** THIS IS A DRILL — a rehearsal, not a real incident. ***\n\n" : ""}` +
        `chromium-host: profileDir for "${profileName}" was deliberately wiped via forceProfileName by ${who} at ${new Date().toISOString()}.\n\nReset cost you declared: ${pe.resetCost}\n\nIf this wasn't you, the auth state is already gone — begin your re-seed procedure.${WHERE_TO_LOOK}`,
        drillPriority(pe, "critical"));
    }
  }
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
    // Pick a display that is not already taken. The old `:${90+random(100)}`
    // collided in practice (observed 2026-08-01: swap-ben and
    // qf-dash-t014-specs both landed on :109), which puts two chromiums on one
    // Xvfb. Check both our own tracking map and the actual X11 sockets, since
    // instances can outlive a sidecar restart.
    // Sweep orphans first — otherwise their stale X11 sockets still read as
    // "taken" below and the range exhausts even though nothing is using them.
    reapOrphanXvfbs("pre-launch");
    const taken = new Set();
    for (const [, v] of launchedXvfbs) if (v.display) taken.add(v.display);
    for (const [, v] of launchedProcesses) if (v.display) taken.add(v.display);
    try {
      for (const f of fs.readdirSync("/tmp/.X11-unix")) {
        const m = f.match(/^X(\d+)$/);
        if (m) taken.add(`:${m[1]}`);
      }
    } catch {}
    display = null;
    for (let n = 90; n < 190; n++) {
      if (!taken.has(`:${n}`)) { display = `:${n}`; break; }
    }
    if (!display) {
      // Exhausted the range — fall back to the old behaviour rather than
      // refusing to launch, but say so loudly.
      display = `:${90 + Math.floor(Math.random() * 100)}`;
      console.warn(`[chromium-host] no free display in :90-:189 (${taken.size} taken); falling back to random ${display} — collision likely`);
    }
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

  // extensionId is filled in later by mcp-server once the newcomer extension
  // registers (POST /processes/:pid/extension). It lives HERE rather than in
  // mcp-server because the whole point of this sidecar is outliving
  // mcp-server restarts — a mapping held over there would vanish on deploy,
  // which is precisely when you need to find an orphan again.
  launchedProcesses.set(proc.pid, { proc, profileName, startedAt: Date.now(), display, extensionId: null });
  proc.once("exit", () => launchedProcesses.delete(proc.pid));
  if (xvfb?.pid) {
    launchedXvfbs.set(xvfb.pid, { proc: xvfb, display, spawnedAt: Date.now() });
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

/* ---------- Destroy one instance (chromium + its paired Xvfb) ---------- */
// ⚠️ PROCESS-ONLY. This never touches profileDir — that is a committed
// property, not an accident. Killing the process costs the owner a cheap
// relaunch onto surviving auth state; deleting the profile costs a full
// credential re-seed. Disk is not what we are reclaiming here; RAM is.
//
// Tears down the PAIRED XVFB too. Without that, a "fix" for the leak merely
// relocates it — the chromium dies, the Xvfb lingers, and a display number
// burns on every cycle.
const destroyInstance = (pid, { reason = "requested" } = {}) => {
  const entry = launchedProcesses.get(pid);
  if (!entry) return { ok: false, error: "not found" };
  const freed = { pid, profileName: entry.profileName, display: entry.display, xvfbPid: null };
  try { entry.proc.kill("SIGTERM"); }
  catch (e) { return { ok: false, error: e.message }; }
  // Reap the Xvfb bound to this instance's display.
  if (entry.display) {
    for (const [xpid, v] of launchedXvfbs) {
      if (v.display !== entry.display) continue;
      // Don't kill an Xvfb another live chromium is still sharing (possible
      // for instances predating the collision fix above).
      const shared = Array.from(launchedProcesses.entries())
        .some(([p, e2]) => p !== pid && e2.display === entry.display);
      if (shared) { console.warn(`[chromium-host] display ${entry.display} shared; leaving Xvfb ${xpid} up`); break; }
      try { v.proc.kill("SIGTERM"); freed.xvfbPid = xpid; } catch {}
      break;
    }
  }
  console.log(`[chromium-host] destroyed pid=${pid} profile=${entry.profileName} display=${entry.display || "-"} xvfb=${freed.xvfbPid || "-"} reason=${reason}`);
  return { ok: true, freed };
};

/* ---------- Automatic reaper ------------------------------------------- */
// ⚠️ SHIPS IN DRY-RUN. The `persistent` allowlist is consulted by profileName,
// but nothing that is already running was launched with any knowledge of it —
// so on first deploy an enforcing reaper would classify the fleet's most
// important instance (a 10-day-old, dormant-by-design cookie holder) as
// maximally reapable. The exemption and the outage would ship in the same
// release. General form: a guard keyed on metadata only new objects can carry
// is inert for exactly the population that most needs it.
//
// So: run the full logic, log and DM what it WOULD reap, kill nothing, until
// a cycle proves the exemptions actually fire. Flip with REAPER_MODE=enforce.
const REAPER_MODE = process.env.REAPER_MODE || "dryrun";   // dryrun | enforce | off
const REAPER_TTL_MS = parseInt(process.env.REAPER_TTL_MS || `${72 * 3600 * 1000}`, 10);
const REAPER_INTERVAL_MS = parseInt(process.env.REAPER_INTERVAL_MS || `${3600 * 1000}`, 10);

const reaperSweep = () => {
  if (REAPER_MODE === "off") return;
  const now = Date.now();
  const candidates = [];
  for (const [pid, v] of launchedProcesses) {
    const ageMs = now - v.startedAt;
    if (ageMs < REAPER_TTL_MS) continue;
    const pe = persistentEntry(v.profileName);
    if (pe) {
      // Routine correctness — a quiet skip plus a log line. Erroring on this
      // every hour would train everyone to ignore the reaper's output.
      console.log(`[chromium-host] reaper: SKIP ${v.profileName} (pid ${pid}, ${(ageMs/3.6e6).toFixed(1)}h) — rule=persistent owner=${pe.owner}${pe._failSafe ? " [FAIL-SAFE: allowlist unreadable]" : ""}`);
      continue;
    }
    candidates.push({ pid, profileName: v.profileName, ageH: +(ageMs / 3.6e6).toFixed(1) });
  }
  if (!candidates.length) { console.log(`[chromium-host] reaper (${REAPER_MODE}): nothing over ${(REAPER_TTL_MS/3.6e6).toFixed(0)}h`); return; }

  const list = candidates.map((c) => `${c.profileName} (pid ${c.pid}, ${c.ageH}h)`).join(", ");
  if (REAPER_MODE === "dryrun") {
    console.log(`[chromium-host] reaper DRY-RUN — WOULD reap ${candidates.length}: ${list}`);
    return;
  }
  for (const c of candidates) {
    const r = destroyInstance(c.pid, { reason: `reaper age>${(REAPER_TTL_MS/3.6e6).toFixed(0)}h` });
    console.log(`[chromium-host] reaper: REAPED ${c.profileName} (pid ${c.pid}, ${c.ageH}h) rule=age ok=${r.ok}`);
  }
};
setInterval(reaperSweep, REAPER_INTERVAL_MS).unref?.();

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
        pid, profileName: v.profileName, startedAt: v.startedAt, display: v.display,
        extensionId: v.extensionId || null, persistent: !!persistentEntry(v.profileName),
        alive: !v.proc.killed,
      }));
      return send(res, 200, { processes: list });
    }
    const extMatch = req.method === "POST" && (req.url || "").match(/^\/processes\/(\d+)\/extension$/);
    if (extMatch) {
      const pid = parseInt(extMatch[1], 10);
      const entry = launchedProcesses.get(pid);
      if (!entry) return send(res, 404, { error: "not found" });
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.extensionId) return send(res, 400, { error: "extensionId required" });
      entry.extensionId = body.extensionId;
      console.log(`[chromium-host] pid=${pid} profile=${entry.profileName} ← extensionId=${body.extensionId}`);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/launch") {
      const body = JSON.parse(await readBody(req) || "{}");
      const loop = detectRelaunchLoop(body.profileName);
      if (loop) return send(res, 429, loop);
      const result = await launchChromium(body);
      return send(res, 200, result);
    }
    // NOTE: parse the URL rather than regexing req.url directly — the override
    // arrives as a query param, which the old `^/processes/(\d+)$` anchor
    // would have silently failed to match.
    const parsed = new URL(req.url || "/", "http://localhost");
    const delMatch = req.method === "DELETE" && parsed.pathname.match(/^\/processes\/(\d+)$/);
    if (delMatch) {
      const pid = parseInt(delMatch[1], 10);
      const entry = launchedProcesses.get(pid);
      if (!entry) return send(res, 404, { error: "not found" });
      // An EXPLICIT destroy against a persistent profile is a loud refusal —
      // as opposed to the automatic reaper, which skips quietly. Automatic =
      // routine correctness; deliberate = must be acknowledged.
      const pe = persistentEntry(entry.profileName);
      const force = parsed.searchParams.get("forceProfileName");
      const caller = parsed.searchParams.get("caller") || "unknown caller";
      if (pe && force !== entry.profileName) {
        return send(res, 409, {
          error: "EPERSISTENT",
          profileName: entry.profileName,
          owner: pe.owner,
          message: persistentRefusal(pe, `destroy pid ${pid}`),
        });
      }
      if (pe) {
        console.warn(`[chromium-host] PERSISTENT OVERRIDE: destroying "${entry.profileName}" pid=${pid} by ${caller} at ${new Date().toISOString()}`);
        notifyOwner(pe.owner,
          `${drillTag(pe)}persistent profile "${entry.profileName}" was force-destroyed`,
          `${pe.drill ? "*** THIS IS A DRILL — a rehearsal, not a real incident. ***\n\n" : ""}` +
          `chromium-host: the chromium for "${entry.profileName}" (pid ${pid}) was deliberately destroyed via forceProfileName by ${caller} at ${new Date().toISOString()}.\n\nThis is PROCESS-ONLY — profileDir was NOT touched, so your auth state survives and a relaunch with freshProfile:false should self-heal.${WHERE_TO_LOOK}`,
          drillPriority(pe, "warning"));
      }
      const r = destroyInstance(pid, { reason: pe ? `explicit override by ${caller}` : `explicit request by ${caller}` });
      return r.ok ? send(res, 200, { ok: true, freed: r.freed }) : send(res, 500, { error: r.error });
    }
    if (req.method === "GET" && parsed.pathname === "/reaper") {
      // Visibility for the break-test: what the reaper currently thinks,
      // without waiting an hour for a sweep.
      const now = Date.now();
      const rows = Array.from(launchedProcesses.entries()).map(([pid, v]) => {
        const pe = persistentEntry(v.profileName);
        const ageH = +((now - v.startedAt) / 3.6e6).toFixed(1);
        return {
          pid, profileName: v.profileName, ageH,
          persistent: !!pe, owner: pe?.owner || null,
          wouldReap: !pe && (now - v.startedAt) >= REAPER_TTL_MS,
        };
      });
      return send(res, 200, {
        mode: REAPER_MODE, ttlHours: +(REAPER_TTL_MS / 3.6e6).toFixed(1),
        allowlistReadable: loadPersistent() !== null,
        instances: rows,
      });
    }
    send(res, 404, { error: "no route", method: req.method, url: req.url });
  } catch (e) {
    // A policy refusal is not a server fault. Without this the launch guard
    // returned 500, which is indistinguishable from "the sidecar broke" — so
    // a caller couldn't tell a deliberate refusal from an outage, and would
    // reasonably retry it. 409 matches the DELETE refusal path.
    if (e?.code === "EPERSISTENT") {
      console.warn(`[chromium-host] refused (EPERSISTENT): ${String(e.message).split("\n")[0]}`);
      return send(res, 409, { error: "EPERSISTENT", message: e.message });
    }
    console.error(`[chromium-host] handler error:`, e);
    send(res, 500, { error: e.message });
  }
});

runStartupCleanup();
server.listen(PORT, () => console.log(`[chromium-host] listening on :${PORT}, profiles=${PROFILES_DIR}, extension=${EXTENSION_DIR}`));
