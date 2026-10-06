/**
 * Redact query-string VALUES and fragments from a URL, keeping origin, path and
 * parameter NAMES.
 *
 * ⭐ ONE DEFINITION, DELIBERATELY. Extracted 2026-10-06 from
 * src/tools/multi-tab-management.ts when it gained a second caller (the
 * recording store). Copying it would have repeated the defect behind the
 * frame-evaluate bug: `c781885` fixed one copy of a wrapper and left its
 * sibling, and nothing surfaces a sibling.
 *
 * ⛔ WHY IT EXISTS. A URL's query string routinely IS the credential. Measured
 * in the recording store 2026-10-06: a complete JWT in
 * `messenger.usw.ivastudio.ai/store?token=eyJ…`, an Amazon
 * `passkeyClaimVerificationToken`, and a Stripe `apiKey=pk_live_…`. Earlier, on
 * the tab listing: an attached payment-vault receipt whose query string carried
 * a person's full billing identity, which every caller of
 * browser_list_attached_tabs received. `finance` names two more cases where the
 * URL alone grants access with no login behind it — the ABridge portal, and ATC
 * artifact links (128 unguessable bits, no ACL).
 *
 * Origin, path and parameter NAMES are kept: that is what answers "which
 * request is this?", which is what the data is for. Values carry the payload.
 *
 * ⚠️ NOT SUFFICIENT ALONE. Path segments carry identifiers too
 * (/receipt/<email>), and a DOM snapshot embeds hrefs that cannot be scrubbed
 * without corrupting the snapshot it is a diff against. This closes the widest
 * channel; it does not make the data PII-free.
 */
/**
 * Redact credential-bearing PATH segments.
 *
 * ⛔ `atc` 2026-10-06: ATC file and artifact links put the secret in the PATH,
 * not the query string — `atc.sack.io/f/up-<32 hex>/<name>`,
 * `:3030/files/<id>/<name>`, `:3031/artifact/<id>/data`. 128 unguessable bits,
 * no login, no ACL: possession of the link IS the authorization, and
 * `/artifact/<id>/data` returns every response ever submitted against it.
 * ⇒ A query-string-only redaction misses these completely, so a captured page
 * URL would be a working credential for whoever reads the capture.
 */
function redactPathSecrets(raw: string): string {
  return raw
    // ATC upload ids, wherever they appear in a path.
    .replace(/up-[0-9a-f]{32}/gi, "up-…")
    // /f/<id>/, /files/<id>/, /artifact/<id> — hex or uuid-shaped ids.
    .replace(
      /(\/(?:f|files|artifact|artifacts)\/)([0-9a-f]{16,}|[0-9a-f-]{32,})/gi,
      (_m, pfx) => `${pfx}…`,
    );
}

export function redactUrl(url: unknown): string {
  const raw = typeof url === "string" ? url : "";
  if (!raw) return raw;
  const q = raw.indexOf("?");
  const h = raw.indexOf("#");
  // ⚠️ Even with no query or fragment, the PATH may be the secret.
  if (q === -1 && h === -1) return redactPathSecrets(raw);
  try {
    const u = new URL(raw);
    let changed = false;
    for (const key of Array.from(u.searchParams.keys())) {
      u.searchParams.set(key, "…");
      changed = true;
    }
    // Fragments are opaque and routinely carry tokens; keep the marker only.
    if (u.hash && u.hash.length > 1) {
      u.hash = "#…";
      changed = true;
    }
    // URL.toString() percent-encodes the ellipsis. Decode it back so the
    // output is readable — a caller scanning a list should see `?name=…`, not
    // `?name=%E2%80%A6`, which reads like a real (and alarming) value.
    // ⚠️ Match the bare sequence, not `=%E2%80%A6`: the first version did the
    // latter and left the FRAGMENT as `#%E2%80%A6`, because a hash has no `=`.
    const out = changed ? u.toString().replace(/%E2%80%A6/g, "…") : raw;
    return redactPathSecrets(out);
  } catch {
    // Non-parseable (chrome://, about:, malformed). Truncate at the first
    // separator rather than returning it whole — failing open here would keep
    // exactly the payload this exists to withhold.
    const cut = Math.min(...[q, h].filter((i) => i >= 0));
    return raw.slice(0, cut) + (raw[cut] === "#" ? "#…" : "?…");
  }
}
