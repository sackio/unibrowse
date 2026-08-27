/**
 * Watch — the declarative pre-filter.
 *
 * ⛔ WHY THIS EXISTS, AND WHY IT IS NOT JUST A JS PREDICATE.
 *
 * MV3's extension CSP forbids evaluating a string as JavaScript. `new Function`
 * and `eval` both throw in the service worker:
 *
 *   "Evaluating a string as JavaScript violates the following Content Security
 *    Policy directive because 'unsafe-eval' is not an allowed source of script"
 *
 * So the caller's arbitrary JS predicate cannot run here. It runs on the
 * SERVER instead, where Node has no such restriction.
 *
 * That alone would send every event of a subscribed type across the
 * WebSocket, which is exactly the firehose the design set out to avoid. This
 * module restores that property with a structured matcher that needs no eval:
 * cheap field tests evaluated at the source, so a chatty source can be
 * narrowed before anything leaves the browser.
 *
 * The division of labour:
 *   prefilter (here, no eval)  — cheap, structured, keeps the wire quiet
 *   predicate (server, JS)     — fully general, decides whether to fire
 *
 * ⛔ Classic script — loaded via importScripts, no `export`.
 */

const PREFILTER_OPS = [
  "includes",
  "equals",
  "notEquals",
  "regex",
  "startsWith",
  "endsWith",
  "exists",
  "missing",
  "gt",
  "lt",
];

/**
 * Read a dotted path out of an object. Returns undefined for any miss, and
 * never throws on a null/undefined mid-path.
 */
function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of String(path).split(".")) {
    if (cur == null) return undefined;
    if (typeof cur !== "object" && typeof cur !== "string") return undefined;
    cur = cur[part];
  }
  return cur;
}

function compileClause(spec) {
  if (spec.all) {
    const subs = spec.all.map(compileClause);
    return (e) => subs.every((f) => f(e));
  }
  if (spec.any) {
    const subs = spec.any.map(compileClause);
    return (e) => subs.some((f) => f(e));
  }
  if (spec.not) {
    const sub = compileClause(spec.not);
    return (e) => !sub(e);
  }

  const { path, op, value } = spec;
  if (!op) {
    throw new Error(
      `Invalid prefilter clause: no "op". Use one of ${PREFILTER_OPS.join(", ")}, or all/any/not.`,
    );
  }
  if (!PREFILTER_OPS.includes(op)) {
    // ⛔ Reject rather than never-match. An unrecognised op that quietly
    // matched nothing would look exactly like a quiet page.
    throw new Error(
      `Invalid prefilter op "${op}". Valid ops: ${PREFILTER_OPS.join(", ")} (plus all/any/not).`,
    );
  }

  let re = null;
  if (op === "regex") {
    try {
      re = new RegExp(value);
    } catch (e) {
      // RegExp compiles a pattern, it does not evaluate JS — CSP-safe. But a
      // bad pattern must fail at arm time, not silently never match.
      throw new Error(`Invalid prefilter regex ${JSON.stringify(value)}: ${e.message}`);
    }
  }

  return (event) => {
    let actual;
    try {
      actual = getPath(event, path);
    } catch {
      return false;
    }

    if (op === "exists") return actual !== undefined;
    if (op === "missing") return actual === undefined;
    if (actual === undefined) return false;

    try {
      switch (op) {
        case "includes":
          return typeof actual === "string" && actual.includes(String(value));
        case "equals":
          return actual === value;
        case "notEquals":
          return actual !== value;
        case "regex":
          return typeof actual === "string" && re.test(actual);
        case "startsWith":
          return typeof actual === "string" && actual.startsWith(String(value));
        case "endsWith":
          return typeof actual === "string" && actual.endsWith(String(value));
        case "gt":
          return typeof actual === "number" && actual > Number(value);
        case "lt":
          return typeof actual === "number" && actual < Number(value);
        default:
          return false;
      }
    } catch {
      // A value of an unexpected shape must not take the watch down.
      return false;
    }
  };
}

/**
 * Compile a prefilter spec into a matcher. No spec means "match everything",
 * which is correct for a low-volume source where the server-side predicate can
 * do all the work.
 */
function compilePrefilter(spec) {
  if (spec == null) return () => true;
  if (typeof spec !== "object") {
    throw new Error(`Invalid prefilter: expected an object, got ${typeof spec}.`);
  }
  return compileClause(spec);
}

globalThis.getPath = getPath;
globalThis.compilePrefilter = compilePrefilter;
globalThis.PREFILTER_OPS = PREFILTER_OPS;
