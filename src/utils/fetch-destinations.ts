/**
 * Where the NEXT upload for a given URL should land.
 *
 * ⛔ WHY A SERVER-SIDE MAP AND NOT A NEW REQUEST HEADER.
 * The upload leg is a separate HTTP connection opened by the EXTENSION
 * (POST /api/v1/fetched), not a reply on the tool's WebSocket, so the route
 * that writes the file cannot see the tool call's arguments. The obvious fix —
 * have the extension echo a destination header — requires shipping extension
 * code to every browser, and ⛔ there is no automated path to update an
 * off-LAN browser's extension (measured 2026-09-13): it reaches a browser only
 * at that browser's next manual ↻. A destination that silently does nothing on
 * exactly the remote browsers this tool exists for is worse than no feature.
 *
 * ⭐ Same precedent as the label percent-encoding in tools/downloads.ts, and
 * for the same reason: done server-side, it works on browsers already in the
 * field today.
 *
 * ⚠️ Keyed on URL, so two concurrent fetches of the SAME url with DIFFERENT
 * destinations would collide — last writer wins. Accepted deliberately: the
 * alternative is a correlation token the extension would have to echo, which
 * is the extension change this design exists to avoid. Rare by construction
 * (the concurrency ceiling is per-extension — one WebSocket, one MV3 worker).
 *
 * Entries are consumed on first read and expire on their own, so a fetch that
 * never lands cannot silently redirect an unrelated fetch of the same URL
 * hours later.
 */

/** Just over the 180s WS response window in tools/downloads.ts, so an entry
 *  outlives the slowest transfer that can still succeed and no longer. */
const TTL_MS = 200_000;

const pending = new Map<string, { destination: string; expiresAt: number }>();

const sweep = (now: number): void => {
  for (const [url, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(url);
  }
};

/** Record where the upload for `url` should land. Overwrites any live entry. */
export const setFetchDestination = (url: string, destination: string): void => {
  const now = Date.now();
  sweep(now);
  pending.set(url, { destination, expiresAt: now + TTL_MS });
};

/** Read and CONSUME the destination for `url`, or null if none is live. */
export const takeFetchDestination = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const now = Date.now();
  sweep(now);
  const entry = pending.get(url);
  if (!entry) return null;
  pending.delete(url);
  return entry.destination;
};

/**
 * Validate a caller-supplied destination.
 *
 * ⛔ RELATIVE SUBPATH ONLY — never an absolute path. An unconstrained
 * destination is an arbitrary-write primitive on a server that also exposes
 * /mcp, whose REMOTE/LOCAL classification is itself a security control that
 * fails toward OPEN (memo 33ff3f8b). "The caller is trusted" is not a property
 * this route can check.
 *
 * Returns the cleaned relative path, or throws with the reason.
 */
export const validateDestination = (destination: string): string => {
  if (typeof destination !== "string" || destination.length === 0) {
    throw new Error("destination must be a non-empty string");
  }
  if (destination.length > 200) {
    throw new Error("destination is too long (max 200 characters)");
  }
  if (destination.startsWith("/") || /^[A-Za-z]:/.test(destination)) {
    throw new Error("destination must be RELATIVE to the fetched store — absolute paths are refused");
  }
  const segments = destination.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("destination must name at least one directory");
  }
  if (segments.length > 4) {
    throw new Error("destination may be at most 4 levels deep");
  }
  for (const segment of segments) {
    // Whitelist, not a blacklist: this rejects "..", NUL, newlines, backslashes
    // and every shell/quoting hazard in one rule rather than enumerating them.
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new Error(
        `destination segment ${JSON.stringify(segment)} is invalid — use only letters, digits, dot, underscore and hyphen`,
      );
    }
    if (segment === "." || segment === "..") {
      throw new Error("destination may not contain . or .. segments");
    }
  }
  return segments.join("/");
};
