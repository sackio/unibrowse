/**
 * Browser-family detection + browser-internal URL guards.
 *
 * unibrowse is a Chromium extension, and every Chromium fork — Edge, Opera,
 * Vivaldi, Brave — runs it unmodified. MV3, the `chrome.*` namespace and
 * `chrome.debugger` are identical across all of them, so there is no porting
 * work in the automation path itself.
 *
 * What is NOT identical is the surface a HUMAN or an agent reads back: the
 * internal-pages scheme (`edge://` vs `chrome://`), the address of the
 * extensions page, and what the browser calls private browsing — Edge says
 * "InPrivate", not "Incognito".
 *
 * Those differences leak out only through strings we hand to somebody, which
 * is exactly why they survived unnoticed: nothing throws. The guidance is
 * simply unfollowable, because it names a page the browser does not have.
 *
 * ⚠️ The scheme guards below are deliberately browser-INDEPENDENT — they list
 * every fork's internal scheme regardless of which browser we detect. Gating a
 * guard on detection would turn a detection miss into an attach failure, and
 * detection is the least reliable thing in this file (Brave, by design, is
 * indistinguishable from Chrome by user-agent). A guard costs one string
 * compare; only the branded label needs to know who we are, and a wrong label
 * is a worse message rather than a broken tab.
 */
self.BrowserEnv = (function () {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';

  // Every Chromium fork carries `Chrome/<ver>` in its user-agent. That token
  // identifies the ENGINE and never the browser, so a fork token has to be
  // tested FIRST or everything reads as Chrome — which is precisely how
  // browser_get_browser_info came to report `browserName: 'Chrome'` while
  // running on Edge, and hand agents the Chromium version as the browser's.
  const FORKS = [
    { name: 'Edge',    re: /\bEdgA?\/([0-9.]+)/,    scheme: 'edge',    privateMode: 'InPrivate' },
    { name: 'Opera',   re: /\bOPR\/([0-9.]+)/,      scheme: 'opera',   privateMode: 'private' },
    { name: 'Vivaldi', re: /\bVivaldi\/([0-9.]+)/,  scheme: 'vivaldi', privateMode: 'private' },
  ];

  const chromiumVersion = /\bChrome\/([0-9.]+)/.exec(ua)?.[1] || null;

  let detected = null;
  for (const fork of FORKS) {
    const m = fork.re.exec(ua);
    if (m) { detected = { ...fork, version: m[1] }; break; }
  }

  const name = detected?.name || 'Chrome';
  const scheme = detected?.scheme || 'chrome';
  const privateMode = detected?.privateMode || 'incognito';

  // Internal pages across the Chromium family. Kept flat and exhaustive rather
  // than derived from `scheme`, for the reason in the header: a tab can be
  // showing an internal page of a browser we failed to identify, and the guard
  // must still hold.
  const INTERNAL_URL_PREFIXES = [
    'chrome://', 'chrome-search://', 'chrome-untrusted://', 'chrome-error://',
    'edge://', 'edge-untrusted://',
    'brave://',
    'opera://',
    'vivaldi://',
    'devtools://',
    // ⚠️ `view-source:` has NO slashes — the real form is
    // `view-source:https://example.com`. Several guards in this codebase
    // tested `view-source://`, which can never match anything.
    'view-source:',
  ];

  const isInternalUrl = (url) =>
    !!url && INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p));

  return {
    name,
    version: detected?.version || chromiumVersion || 'Unknown',
    chromiumVersion: chromiumVersion || 'Unknown',
    isFork: !!detected,

    INTERNAL_URL_PREFIXES,
    isInternalUrl,

    /** e.g. "edge://" — this browser's own internal-pages scheme, for messages. */
    internalScheme: `${scheme}://`,

    /** e.g. "edge://extensions" — where a human goes to manage extensions. */
    extensionsPage: `${scheme}://extensions`,

    /** e.g. "InPrivate" — this browser's name for private browsing. */
    privateModeLabel: privateMode,

    /**
     * The per-extension toggle's own label, verbatim, because a user hunting
     * for "Allow in incognito" on Edge will not find it — the control is
     * called "Allow in InPrivate" there.
     */
    allowInPrivateLabel: `Allow in ${privateMode}`,

    /**
     * The full remedy sentence for "extension is not enabled in private
     * browsing". Built here rather than at each throw site so the three call
     * sites cannot drift apart — which is how they came to hardcode Chrome's
     * wording in the first place.
     */
    privateAccessHint(extensionName = 'unibrowse') {
      return `Go to ${scheme}://extensions, find ${extensionName}, and enable "Allow in ${privateMode}".`;
    },
  };
})();
