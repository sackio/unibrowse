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
