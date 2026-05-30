// Default unibrowse extension config.
// When the extension is downloaded via /install/extension.zip on a unibrowse
// server, the server REPLACES this file with values pre-baked for that server.
// When the extension is loaded directly from source, these defaults trigger
// the localhost / chrome.storage fallback in background.js.
//
// At runtime the user can override these via chrome.runtime.openOptionsPage().
self.UNIBROWSE_CONFIG = {
  SERVER_URL: "",              // http(s)://host:port — empty falls back to localhost
  WS_URL: "",                  // ws(s)://host:port/ws — derived from SERVER_URL when empty
  API_KEY: "",                 // Bearer key (empty = no auth header sent)
  INSTALLED_FROM: "",          // populated by server during /install/extension.zip
  INSTALLED_AT: "",            // ISO timestamp populated by server
};
