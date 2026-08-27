/**
 * Watch — server-side predicate evaluation.
 *
 * ⛔ WHY THIS IS ON THE SERVER.
 *
 * The design called for the caller's arbitrary JS predicate to run in the
 * extension, next to the event. MV3's Content Security Policy forbids it:
 * `new Function` and `eval` both throw in an extension service worker, and no
 * amount of care changes that without a manifest `sandbox` page.
 *
 * Measured 2026-08-27 on the first live arm:
 *   "Evaluating a string as JavaScript violates the following Content Security
 *    Policy directive because 'unsafe-eval' is not an allowed source of script"
 *
 * So the work splits:
 *   - the extension applies a DECLARATIVE prefilter (watch-prefilter.js), which
 *     needs no eval and keeps chatty sources off the WebSocket
 *   - this module applies the caller's JS predicate, in Node, where there is
 *     no CSP
 *
 * ⭐ This also puts predicate execution back on the trust boundary
 * `routine-runner` already occupies — the server's Node runtime — rather than
 * widening it into the browser context that holds every live cookie in the
 * pool. See the security section of docs/WATCH_DESIGN.md.
 *
 * ⚠️ Page-home watches do NOT come through here. Their predicate is injected
 * into the document and evaluated under the page's own CSP, so by the time the
 * server sees the event it is already a true match.
 */

export type CompiledPredicate = (event: unknown) => boolean;

const cache = new Map<string, CompiledPredicate>();

/**
 * Compile a predicate source string.
 *
 * Two failure modes, deliberately different:
 *   - A SYNTAX error throws here, so `browser_watch_create` can refuse the
 *     watch rather than arming one that could never match.
 *   - A RUNTIME throw returns false. One oddly-shaped event must not fire the
 *     watch and must not kill it.
 */
export function compilePredicate(src?: string): CompiledPredicate {
  if (src == null || src === "") return () => true;

  const hit = cache.get(src);
  if (hit) return hit;

  let fn: (e: unknown) => unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function("e", `"use strict"; return (${src})(e);`) as (e: unknown) => unknown;
  } catch (err) {
    throw new Error(
      `Invalid watch predicate: ${(err as Error).message}. ` +
        `Expected a JS arrow function, e.g. "(e) => e.url.includes('done')".`,
    );
  }

  const compiled: CompiledPredicate = (event: unknown) => {
    try {
      return Boolean(fn(event));
    } catch {
      return false;
    }
  };

  // Bounded so a pathological caller cannot grow this without limit.
  if (cache.size > 500) cache.clear();
  cache.set(src, compiled);
  return compiled;
}

/** Verify a predicate compiles, for use at watch-create time. */
export function validatePredicate(src?: string): { ok: true } | { ok: false; error: string } {
  try {
    compilePredicate(src);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
