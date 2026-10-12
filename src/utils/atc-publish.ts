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
