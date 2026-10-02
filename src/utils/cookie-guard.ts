/**
 * Default-profile guard for destructive cookie operations.
 *
 * Its own module so `node --test` can import it: cookies.ts pulls in the
 * "@/types" path alias, which the bare test runner cannot resolve.
 *
 * ⛔ WHY THIS EXISTS. `browser_clear_cookies` with no `tabTarget` resolves to
 * the DEFAULT cookie store — i.e. Ben's real browsing session on office — and
 * returns a cheerful "Cleared N cookie(s)". `d773bb4` made a WRONG tabTarget
 * throw instead of silently falling back, which was the loud half of the
 * problem; an OMITTED tabTarget was left meaning "the default store" for
 * backwards compatibility, and that is the half that logs him out of eBay.
 * Measured 2026-10-02: the omission path is still live for every seat.
 *
 * ⇒ The omission now has to be stated out loud. A caller who genuinely means
 * the real profile says so; a caller who forgot gets an error naming the fix,
 * instead of a success message and a destroyed session.
 *
 * ⚠️ THIS GUARD IS SERVER-SIDE ON PURPOSE, and that is not a style choice.
 * The equivalent check in the extension would be unreachable: an extension
 * edit only takes effect when someone presses ↻ on chrome://extensions, which
 * only Ben can do on his own browser and which has not happened since
 * 2026-09-17. A guard that needs his ↻ to protect him from a wipe he did not
 * ask for would protect nothing. mcp-server redeploys on a restart, so this is
 * the only layer that can defend the profile today.
 */

export interface CookieScopeRequest {
  tabTarget?: string | number | null;
  includeDefaultProfile?: boolean;
  url?: string;
  domain?: string;
}

export interface CookieGuardVerdict {
  allowed: boolean;
  /** Operator-facing reason, naming the remedy. Empty when allowed. */
  reason: string;
}

/**
 * Decide whether a clear-cookies call may proceed.
 *
 * Allowed when EITHER a tab scopes it (the normal case — an incognito or
 * launched-profile tab) OR the caller explicitly opted into the default
 * profile. Refused otherwise, whether or not a url/domain filter narrows it:
 * "clear ebay.com from the real profile" is exactly the damaging call.
 */
export function guardCookieClear(req: CookieScopeRequest | null | undefined): CookieGuardVerdict {
  const r = req || {};
  const scopedByTab = r.tabTarget !== undefined && r.tabTarget !== null && r.tabTarget !== "";
  if (scopedByTab) return { allowed: true, reason: "" };
  if (r.includeDefaultProfile === true) return { allowed: true, reason: "" };

  const filter = r.domain
    ? `domain "${r.domain}"`
    : r.url
      ? `url "${r.url}"`
      : "EVERY cookie in the profile";
  return {
    allowed: false,
    reason:
      `Refusing to clear ${filter} from the DEFAULT profile. No tabTarget was passed, and without one ` +
      `this clears the real browsing session on that browser — the operator's own logins (eBay, Amazon, ` +
      `banking), not the tab you had in mind. ` +
      `⇒ If you meant an incognito or launched-profile tab, pass its tabTarget (browser_list_attached_tabs ` +
      `lists them; verify the store first with browser_get_cookies and check "storeId" is not null). ` +
      `⇒ If you genuinely mean the operator's own profile, pass includeDefaultProfile: true and say why in ` +
      `your own logs. Nothing has been deleted.`,
  };
}
