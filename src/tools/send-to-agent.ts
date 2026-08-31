/**
 * Send a page — or a selection from one — to an agent.
 *
 * ⛔ THIS RUNS ON THE SERVER, never in the extension. Same rule as the watch
 * sinks (src/watch/sinks.ts): the extension holds every live cookie and
 * session in the pool, so it must not make outbound calls to third parties.
 * The server is the auth plane.
 *
 * Modelled on how `ha` built scanfile's send-to-agent (asked 2026-08-31).
 * Two things they got right and paid for getting wrong first:
 *
 *  ⛔ THE RECIPIENT STRING IS AN ADDRESS, NOT A LABEL. A name that is not a
 *    real subscriber is ACCEPTED by the broker and NEVER DELIVERED — a typo
 *    is indistinguishable from an agent ignoring you, with no error anywhere.
 *    So we validate against the broker's own /destinations before sending,
 *    and report `sent: 0` back to the caller rather than swallowing it.
 *
 *  ⭐ SIZE: scanfile never sends content, it sends a PATH. We measured the
 *    broker's ingest cap at 1 MB (accepted 512 KB, HTTP 413 "request body too
 *    large (limit 1mb)" at 1024 KB, 2026-08-31). Prose selections are far
 *    under that; a full page's HTML often is not. So content goes inline only
 *    while it is comfortably small, and otherwise is parked on this server and
 *    sent as a URL the recipient can fetch.
 */

const DEFAULT_ATC_URL = "http://192.168.1.168:3030";
export const ATC_URL = process.env.UNIBROWSE_ATC_URL || DEFAULT_ATC_URL;

/**
 * ⛔ Well under the measured 1 MB ingest cap, not near it. The cap applies to
 * the whole JSON body — subject, envelope and JSON-escaping of the content all
 * count, and escaping can nearly double HTML full of quotes. 200 KB of content
 * cannot push the body past the limit no matter how badly it escapes.
 */
export const INLINE_CONTENT_LIMIT = 200 * 1024;

export interface SendToAgentInput {
  to: string;
  url: string;
  title?: string;
  content: string;
  format: "markdown" | "html" | "text";
  /** "selection" or "page" — shown to the recipient so they know what they got. */
  scope: string;
  from?: string;
}

export interface SendToAgentResult {
  ok: boolean;
  sent: number;
  detail?: string;
  /** Set when the body was too big to inline and was parked instead. */
  parkedUrl?: string;
}

/** Parked bodies, keyed by id. In-memory and deliberately short-lived. */
const parked = new Map<string, { body: string; format: string; title: string; url: string; at: number }>();
const PARK_TTL_MS = 6 * 60 * 60 * 1000;

export function parkContent(id: string, entry: { body: string; format: string; title: string; url: string }) {
  parked.set(id, { ...entry, at: Date.now() });
  // Opportunistic sweep — no timer, so this cannot hold the process open.
  const cutoff = Date.now() - PARK_TTL_MS;
  for (const [k, v] of parked) if (v.at < cutoff) parked.delete(k);
}

export function getParked(id: string) {
  const e = parked.get(id);
  if (!e) return null;
  if (Date.now() - e.at > PARK_TTL_MS) { parked.delete(id); return null; }
  return e;
}

/**
 * The broker's live seat list. Used to validate a recipient before sending and
 * to populate the popup's picker, so the two can never disagree.
 */
export async function fetchDestinations(
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ id: string; label?: string; hostname?: string }>> {
  const res = await fetchImpl(`${ATC_URL}/destinations`);
  if (!res.ok) throw new Error(`ATC /destinations returned HTTP ${res.status}`);
  const body = (await res.json()) as { destinations?: Array<{ id: string; label?: string; hostname?: string }> };
  return body.destinations ?? [];
}

function renderContent(input: SendToAgentInput, parkedUrl?: string): string {
  const head =
    `This is from unibrowse — ${input.scope === "selection" ? "a selection from" : "the page at"}:\n` +
    `${input.url}\n` +
    (input.title ? `Title: ${input.title}\n` : "");

  if (parkedUrl) {
    return (
      `${head}\n` +
      `The content was too large to send inline (${input.content.length} bytes as ${input.format}).\n` +
      `Fetch it here — plain GET, no auth:\n${parkedUrl}\n\n` +
      `⚠️ That URL is served from unibrowse's mcp-server and expires in 6 hours.`
    );
  }

  return `${head}\n--- ${input.format} ---\n${input.content}`;
}

export function createSender(opts: { fetchImpl?: typeof fetch; selfBaseUrl?: string } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async function sendToAgent(input: SendToAgentInput): Promise<SendToAgentResult> {
    const to = (input.to || "").trim();
    if (!to) return { ok: false, sent: 0, detail: "No recipient given." };

    // ⛔ Validate the address. See the header — an unroutable name is accepted
    // by the broker and silently dropped, so checking here is the only place a
    // typo can still be turned into an error the sender actually sees.
    try {
      const dests = await fetchDestinations(fetchImpl);
      if (dests.length && !dests.some((d) => d.id === to)) {
        const near = dests
          .map((d) => d.id)
          .filter((id) => id.startsWith(to.slice(0, 3)))
          .slice(0, 5);
        return {
          ok: false,
          sent: 0,
          detail:
            `"${to}" is not a registered ATC subscriber, so the broker would accept this ` +
            `message and never deliver it.` + (near.length ? ` Did you mean: ${near.join(", ")}?` : ""),
        };
      }
    } catch (e) {
      // A validation outage must not block a send to a name that is probably
      // fine — but the caller is told the check did not happen.
      console.warn(`[SendToAgent] destination check skipped: ${(e as Error).message}`);
    }

    let parkedUrl: string | undefined;
    if (input.content.length > INLINE_CONTENT_LIMIT && opts.selfBaseUrl) {
      const id = `park-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      parkContent(id, {
        body: input.content,
        format: input.format,
        title: input.title ?? "",
        url: input.url,
      });
      parkedUrl = `${opts.selfBaseUrl.replace(/\/$/, "")}/shared/${id}`;
    }

    const body = {
      to,
      from: input.from || "unibrowse",
      subject: `From unibrowse: ${input.title || input.url}`.slice(0, 200),
      content: renderContent(input, parkedUrl),
    };

    try {
      const res = await fetchImpl(`${ATC_URL}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `ATC returned HTTP ${res.status}`;
        try {
          const t = await res.text();
          if (t) detail += `: ${t.slice(0, 200)}`;
        } catch { /* status alone is enough */ }
        return { ok: false, sent: 0, detail, parkedUrl };
      }
      const out = (await res.json()) as { sent?: number; drop_reason?: string };
      const sent = out.sent ?? 0;
      if (sent === 0) {
        return {
          ok: false,
          sent: 0,
          detail:
            `The broker accepted the message but delivered it to nobody` +
            (out.drop_reason ? ` (drop_reason: ${out.drop_reason})` : "") +
            `. Routing is not delivery — check the recipient id.`,
          parkedUrl,
        };
      }
      return { ok: true, sent, parkedUrl };
    } catch (e) {
      return { ok: false, sent: 0, detail: (e as Error).message, parkedUrl };
    }
  };
}
