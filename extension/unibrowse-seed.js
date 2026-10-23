// Content script — seeds the extension's default server config from URL
// params on a one-time bootstrap page. Loaded by the chromium-host sidecar
// as the first tab when it spawns a new chromium, e.g.:
//   http://mcp-server:9010/__unibrowse_seed?ws=ws%3A%2F%2Fmcp-server%3A9010%2Fws
// The mcp-server's /__unibrowse_seed route serves a one-line HTML page that
// this script runs on; we read the URL params and persist them to
// chrome.storage.local so the background's resolveServerConfig() finds a
// non-localhost default on the very first connect.
//
// Idempotent: if the legacy override already exists in storage, we skip.
// Run-time: document_start, so we beat the background's auto-connect race.
(async () => {
  try {
    const u = new URL(location.href);
    const wsUrl = u.searchParams.get("ws");
    const httpUrl = u.searchParams.get("http")
      || (wsUrl ? wsUrl.replace(/^ws/, "http").replace(/\/ws$/, "") : null);
    const apiKey = u.searchParams.get("key") || "";

    // ── Stable identity ──────────────────────────────────────────────────
    // The launcher passes a per-profile extensionId that it persists OUTSIDE
    // the profile's wiped dirs. Adopt it before the background registers,
    // otherwise this chromium mints a fresh UUID on every relaunch — which is
    // how ha's ecobee-broker produced 1,329 distinct ids in 26h and could
    // never converge, since the relaunch it did to find the id was the thing
    // destroying it.
    //
    // Written unconditionally: after a profile wipe the SW may already have
    // minted its own id, and the seeded one has to win. The SW re-reads
    // storage on ADOPT_EXTENSION_ID, so the later registration uses this.
    const seededId = u.searchParams.get("eid");
    if (seededId) {
      try {
        const cur = await chrome.storage.local.get(["__unibrowseExtensionId"]);
        if (cur.__unibrowseExtensionId !== seededId) {
          await chrome.storage.local.set({ __unibrowseExtensionId: seededId });
          console.log(`[unibrowse-seed] adopted stable extensionId ${seededId}`);
        }
        chrome.runtime.sendMessage({ type: "ADOPT_EXTENSION_ID", extensionId: seededId }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {
        console.warn(`[unibrowse-seed] could not adopt extensionId:`, e?.message || e);
      }
    }

    // ── Proxy credentials ────────────────────────────────────────────────
    // ⛔ The password is NOT on this URL — `pa` is a single-use nonce we
    // exchange for it, body-only, over the LAN. A password in a URL would land
    // in this profile's history and in the server's access log.
    // ⚠️ Fetched from HERE rather than from the background, because this page is
    // same-origin with mcp-server and the server host is in chrome's proxy
    // bypass list, so this request cannot itself hit the 407 we are trying to
    // answer. A background fetch would race the first proxied navigation.
    const pa = u.searchParams.get("pa");
    // ⛔ `par=1` REPLACES credentials this profile already holds. Without it the
    // skip below is a trap for a browser that is being moved to a NEW lease
    // while running: the server replaces its staged entry, the extension keeps
    // the OLD password, and every request 407s against the new exit while both
    // sides report success. A relaunch never hit this because the profile wipe
    // takes Default/Local Extension Settings with it; staging into a LIVE
    // browser does not wipe anything, so the caller has to say so.
    const paReplace = u.searchParams.get("par") === "1";
    if (pa && seededId && httpUrl) {
      try {
        const have = await chrome.storage.local.get(["unibrowse_proxy_auth"]);
        if (have.unibrowse_proxy_auth?.password && !paReplace) {
          // The nonce is single use, so a seed-page reload must not spend it.
          console.log("[unibrowse-seed] proxy credentials already stored; not re-collecting");
        } else {
          const r = await fetch(
            `${httpUrl}/__unibrowse_proxy_auth?eid=${encodeURIComponent(seededId)}&pa=${encodeURIComponent(pa)}`,
            { cache: "no-store" },
          );
          if (!r.ok) throw new Error(`collect returned ${r.status}`);
          const auth = await r.json();
          if (!auth?.username || !auth?.password) throw new Error("collect returned no credentials");
          await chrome.storage.local.set({ unibrowse_proxy_auth: auth });
          // ⛔ Log the proxy, never the credentials.
          console.log(`[unibrowse-seed] stored proxy credentials for ${auth.proxy}`);
          chrome.runtime.sendMessage({ type: "PROXY_AUTH_READY" }, () => {
            void chrome.runtime.lastError;
          });
        }
      } catch (e) {
        // ⚠️ Loud: without credentials every proxied request 407s, and the
        // symptom is a browser that loads nothing while looking healthy.
        console.error(`[unibrowse-seed] PROXY CREDENTIALS NOT COLLECTED — every proxied request will 407: ${e?.message || e}`);
      }
    }

    if (!wsUrl) return;
    const existing = await chrome.storage.local.get(["unibrowse_server_config"]);
    if (existing.unibrowse_server_config?.WS_URL) {
      // User already has a default; respect it.
      return;
    }
    await chrome.storage.local.set({
      unibrowse_server_config: {
        SERVER_URL: httpUrl || "",
        WS_URL: wsUrl,
        API_KEY: apiKey,
      },
    });
    document.body && (document.body.textContent = `seeded ws=${wsUrl}`);
    console.log(`[unibrowse-seed] Seeded default server: ${wsUrl}`);
    // Critical: background's WSManager resolves the server URL ONCE at
    // connect() time and then auto-reconnects to that URL forever. If the
    // background already started connecting to localhost (because seed
    // hadn't written yet), it'll never pick up the new config. Send the
    // RECONNECT_WS message so background re-resolves + reconnects to the
    // newly-seeded URL. Without this, the sidecar chromium's extension
    // gets stuck retrying localhost:9010 (which has nothing listening).
    try {
      chrome.runtime.sendMessage({ type: "RECONNECT_WS" }, () => {
        // Swallow lastError — message may fail if SW is still spinning up
        // (the SW will resolve config itself on its initial connect anyway).
        void chrome.runtime.lastError;
      });
      console.log(`[unibrowse-seed] sent RECONNECT_WS to background`);
    } catch (e) {
      console.warn(`[unibrowse-seed] RECONNECT_WS dispatch failed:`, e?.message || e);
    }
  } catch (e) {
    console.warn(`[unibrowse-seed] Failed:`, e?.message || e);
  }
})();
