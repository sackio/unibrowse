/**
 * The two ATC calls that a phone-facing relay needs, with their traps recorded
 * ONCE instead of per caller.
 *
 * ⭐ WHY THIS FILE EXISTS. Both of these have a failure mode that returns
 * success, and both were learned the expensive way by the captcha relay. When
 * Slipway needed the same two calls, copying them would have meant two places
 * to keep the lessons in step — and the lesson is the valuable part, not the
 * fetch.
 */

const ARTIFACT_BASE = process.env.ATC_FILES_URL || "http://192.168.1.168:3031";
const BROKER_BASE = process.env.ATC_BROKER_URL || "http://192.168.1.168:3030";

/**
 * The URL an artifact PROXY will fetch. It must be an address the atc-files
 * host can reach, not one that only resolves inside our container.
 *
 * ⛔ Not `localhost`, and not the compose service name `mcp-server` — both
 * resolve here and NOWHERE else, so the proxy would 502 while everything on
 * our side looked correct. ⚠️ The proxy refuses loopback outright, so a
 * localhost value fails at publish time rather than silently — but only for
 * loopback; the service-name case would sail through.
 */
export function selfPublicBase(): string {
  return (process.env.UNIBROWSE_PUBLIC_URL || "http://192.168.1.199:9010").replace(/\/$/, "");
}

/**
 * Publish a page of ours as an ATC artifact that PROXIES us.
 *
 * ⛔ Proxy, not `html`. An artifact serving its own HTML is locked to the
 * artifact origin by CSP (`connect-src 'self'`) and could not poll us for
 * screenshots at all. Proxying mounts OUR page under the artifact's origin, so
 * the page's relative fetches are same-origin and work.
 */
export async function publishProxyArtifact(opts: {
  target: string;
  owner: string;
  title: string;
}): Promise<{ url: string | null; error: string | null }> {
  try {
    const resp = await fetch(`${ARTIFACT_BASE}/artifact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proxy: opts.target, owner: opts.owner, title: opts.title }),
    });
    if (!resp.ok) {
      return { url: null, error: `artifact publish returned HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    return { url: data.url_public || data.url || null, error: null };
  } catch (err: any) {
    return { url: null, error: err.message };
  }
}

/**
 * Send one ATC message.
 *
 * ⛔ `from` IS NOT COSMETIC — IT DECIDES WHICH ROOM A MESSAGE TO A HUMAN LANDS
 * IN. The Slack bridge resolves `from` and redirects a message addressed to a
 * human into THAT SENDER's own channel when the sender has one (a seat, or a
 * thread carrying its own channel id); an UNBOUND sender name falls through to
 * a real DM. So:
 *   · want the phone to buzz  → send as an unbound name
 *   · want it in the agent's own room → send as that agent
 * (Mechanism: `routeFor` in atc slack/src/bridge.mjs. Measured by the `atc`
 * seat 2026-09-12; made load-bearing on purpose by Ben's 2026-10-12 ask.)
 *
 * ⛔ READ `sent`, NOT THE STATUS CODE. A 200 with sent:0 means the address
 * matched no subscriber and the message was accepted and dropped — the failure
 * shape a notification feature cannot afford to report as success.
 */
/**
 * Can a DM to this seat id actually be DRAINED by anybody?
 *
 * ⭐ WHY A RELAY NEEDS THIS AT REQUEST TIME. `sendBrokerMessage` reports
 * `sent >= 1`, which means the BROKER accepted and fanned out — it is not
 * evidence that a human or an agent will ever read it. The `atc` seat measured
 * the gap on us 2026-10-19 10:24:51Z: `browser_request_captcha_solve` took
 * `agent=alpaca-signup`, a name with no /subscribers row and no conv registry
 * entry, returned a link and a success, the notice diverted to `atc`, and the
 * operator was never pinged. ⇒ The requester could not tell a notifiable name
 * from an unnotifiable one, and nothing in the response said so.
 *
 * ⚠️ `reachable: false` IS NOT AN ERROR AND MUST NOT BE TREATED AS ONE. Real
 * seats legitimately read false: a container sidecar, or `claude-login-auto`,
 * which has no channel by design. It means "nobody is draining this inbox", so
 * the right response is to stop PROMISING a notice to that name — not to
 * refuse the work.
 *
 * ⛔ `basis: "none"` DOES NOT MEAN THE SEAT DOES NOT EXIST. The endpoint's own
 * note says so: absence and deafness are not distinguished. Never report a name
 * as wrong on this evidence; report that nothing would read it.
 *
 * ⚠️ A `null` ANSWER IS THE THIRD CASE AND IS DELIBERATE. If the probe itself
 * fails — broker down, timeout — we know NEITHER way, and collapsing that into
 * `false` would invent a defect, while collapsing it into `true` would restore
 * exactly the false promise this function exists to remove.
 */
/**
 * The Slack @-mention for a notice addressed to a human, or "" for anything else.
 *
 * ⛔⛔ A SLACK CHANNEL MESSAGE WITH NO MENTION RAISES NO PUSH ON HIS PHONE. A DM
 * always does. That one sentence is why three captcha relays expired at 0 taps
 * on 2026-10-19 while the operator was demonstrably present — he wrote "you can
 * send me captchas to solve" in #alpaca at 06:13 EDT (ts 1792404792.025369) and
 * a notice posted into that same channel still expired untouched 35 minutes
 * later. Diagnosed by the `atc` seat; I had measured the 0-tap pattern and
 * attributed it to the WRONG variable (time of day).
 *
 * ⚠️ THE NOTICE BEING DELIVERED AND THE NOTICE RINGING ARE DIFFERENT CLAIMS,
 * and the broker can only report the first. `sent: 1` was true for every one of
 * those three.
 *
 * ⭐ KEYED ON THE RECIPIENT, NOT ON A HARDCODED OPERATOR, which is what keeps it
 * self-limiting: it fires only when the notice is addressed to a Slack human —
 * who by definition has to act, since that is the only reason to address one —
 * and stays silent for every seat-to-seat message. ⚠️ `atc`'s caution is real
 * and this is the mechanism that honours it: a mention on every seat notice is
 * how he ends up muting the channel.
 *
 * ⛔ DO NOT ADD THIS TO A NOTICE THAT DOES NOT NEED HIM. The value of a mention
 * is entirely that it is rare.
 */
export function slackMention(to: string): string {
  const m = /^slack:(U[A-Z0-9]{4,})$/.exec((to || "").trim());
  return m ? `<@${m[1]}>` : "";
}

export async function seatReachable(
  id: string,
): Promise<{ reachable: boolean | null; basis: string }> {
  try {
    const resp = await fetch(`${BROKER_BASE}/reachable/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return { reachable: null, basis: `probe returned HTTP ${resp.status}` };
    const data: any = await resp.json();
    const seat = Array.isArray(data?.seats) ? data.seats[0] : null;
    if (!seat || typeof seat.reachable !== "boolean") {
      return { reachable: null, basis: "probe returned no verdict" };
    }
    return { reachable: seat.reachable, basis: String(seat.basis ?? "unknown") };
  } catch (err: any) {
    // ⛔ NEVER let this throw into a caller's happy path. A captcha that cannot
    // be minted because a DIAGNOSTIC failed would be a worse bug than the one
    // this function reports.
    return { reachable: null, basis: `probe failed: ${err?.message ?? "unknown"}` };
  }
}

export async function sendBrokerMessage(msg: {
  to: string;
  from: string;
  subject: string;
  content: string;
  priority?: string;
}): Promise<{ ok: boolean; error: string | null }> {
  try {
    // ⛔ /inbox/send, NOT /messages. sse-mcp also registers POST /messages as
    // the legacy MCP transport and falls through, so /messages is ambiguous.
    const resp = await fetch(`${BROKER_BASE}/inbox/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "info", ...msg }),
    });
    if (!resp.ok) {
      return { ok: false, error: `broker /inbox/send returned HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    if (!data || Number(data.sent) < 1) {
      return {
        ok: false,
        error:
          `broker accepted but delivered to nobody (sent=${data?.sent ?? "?"}) — ` +
          `is "${msg.to}" a real subscriber?`,
      };
    }
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
