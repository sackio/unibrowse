/**
 * describeError — turn anything that was thrown into a non-empty description.
 *
 * ⛔ WHY THIS EXISTS. The handler error paths sent `error: error.message`, which
 * is `undefined` for every throw that is not an Error: a thrown string, a
 * thrown object, a rejected promise with no reason, a DOMException whose
 * message is empty. The server then received a falsy `error` and, because it
 * tested `if (error)`, took the SUCCESS branch — so a failed call resolved
 * with `undefined` instead of rejecting.
 *
 * That is how `agents` got "⛔ could not open an incognito tab:" with nothing
 * after the colon, and could not tell "permission revoked" from "browser gone"
 * from "extension wedged" (2026-08-27). Three failures that want opposite
 * responses, rendered identically.
 *
 * ⭐ The contract: this NEVER returns an empty string. When there is genuinely
 * nothing to report it says so in words, because "no detail available" is
 * information and "" is not.
 *
 * ⛔ Classic script — loaded via importScripts, no `export`.
 */

const ERROR_DETAIL_MAX = 1000;

function describeError(err) {
  const parts = [];

  const push = (v) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s && !parts.includes(s)) parts.push(s);
  };

  if (err == null) {
    return `no error detail available (the throw was ${err === null ? "null" : "undefined"})`;
  }

  if (typeof err === "string") {
    const s = err.trim();
    return s || "no error detail available (empty string thrown)";
  }

  if (typeof err !== "object") {
    const s = String(err).trim();
    return s || `no error detail available (${typeof err} thrown)`;
  }

  push(err.message);

  // A name is the last useful thing left when the message is empty —
  // "NotAllowedError" alone still separates a permission refusal from a crash.
  if (parts.length === 0 && err.name) push(err.name);
  else if (err.name && err.name !== "Error") push(`(${err.name})`);

  if (err.code) push(`[code ${err.code}]`);

  // Nothing recognisable: serialise the object rather than let String() render
  // it "[object Object]", which is the same non-answer in a different costume.
  if (parts.length === 0) {
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") push(json);
    } catch {
      /* circular or unserialisable */
    }
  }

  if (parts.length === 0) {
    const ctor = err.constructor && err.constructor.name;
    return `no error detail available (${ctor || "object"} with no message, name, or code)`;
  }

  const out = parts.join(" ");
  return out.length > ERROR_DETAIL_MAX ? out.slice(0, ERROR_DETAIL_MAX) + "… (truncated)" : out;
}

globalThis.describeError = describeError;
