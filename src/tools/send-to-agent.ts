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

/**
 * ⛔ A SHARE IS NOT ALWAYS A COPY. Three kinds travel this one path:
 *
 *   "content"   — a page or selection, copied into the message. What it says
 *                 is all the recipient gets; the tab may be gone by the time
 *                 they read it.
 *   "tab"       — a HANDLE to a live attached tab, so the sender and the
 *                 recipient can work the same tab at the same time.
 *   "recording" — a HANDLE to a saved session recording on this server.
 *
 * They share the delivery machinery (destination validation, sent:0 detection)
 * because every one of them fails the same silent way if the address is wrong.
 * They do NOT share an envelope: a handle whose body reads like a copy invites
 * the recipient to act on a stale snapshot of something still moving.
 */
export type ShareKind = "content" | "tab" | "recording";

interface ShareBase {
  to: string;
  from?: string;
}

export interface ContentShare extends ShareBase {
  kind?: "content";
  url: string;
  title?: string;
  content: string;
  format: "markdown" | "html" | "text";
  /** "selection" or "page" — shown to the recipient so they know what they got. */
  scope: string;
}

export interface TabShare extends ShareBase {
  kind: "tab";
  /**
   * ⛔ THE HANDLE. Not decoration — this is the only field the recipient can
   * still address the tab by tomorrow. See renderTabShare for why.
   */
  label: string;
  url: string;
  title?: string;
  /** Diagnostics only. Both are bindings that go stale; never the address. */
  tabId?: number;
  extensionId?: string;
  extensionLabel?: string;
}

export interface RecordingShare extends ShareBase {
  kind: "recording";
  recordingId: string;
  title?: string;
  startUrl?: string;
  durationMs?: number;
  reviewUrl?: string;
  pageCount?: number;
}

export type SendToAgentInput = ContentShare | TabShare | RecordingShare;

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

/** Every envelope opens the same way, so a recipient can tell at a glance. */
function head(what: string): string {
  return `This is from unibrowse — ${what}\n`;
}

function renderContentShare(input: ContentShare, parkedUrl?: string): string {
  const h =
    head(input.scope === "selection" ? "a selection from:" : "the page at:") +
    `${input.url}\n` +
    (input.title ? `Title: ${input.title}\n` : "");

  if (parkedUrl) {
    return (
      `${h}\n` +
      `The content was too large to send inline (${input.content.length} bytes as ${input.format}).\n` +
      `Fetch it here — plain GET, no auth:\n${parkedUrl}\n\n` +
      `⚠️ That URL is served from unibrowse's mcp-server and expires in 6 hours.`
    );
  }

  return `${h}\n--- ${input.format} ---\n${input.content}`;
}

/**
 * ⛔ THE LABEL IS THE ADDRESS, AND THIS ENVELOPE HAS TO SAY SO.
 *
 * A recipient handed a tabId and an extensionId will use them — they look like
 * identity and they work on the first call. Both are BINDINGS:
 *
 *   · extensionId is reminted whenever Chrome restarts that extension's
 *     service worker. Measured 2026-08-31: one browser produced four distinct
 *     ids across a single day, and the disconnect that retires an id is not
 *     announced to anyone holding it.
 *   · tabIds do not survive a browser restart, and Chrome reuses them.
 *
 * A label survives both, and the router refuses to guess when one is ambiguous
 * across browsers (it errors and names the candidates) rather than silently
 * driving the wrong tab. So the envelope names the label, shows the bindings
 * only as diagnostics, and says which is which — a recipient who picks wrong
 * gets no error until they have already acted on someone else's page.
 */
function renderTabShare(input: TabShare): string {
  const t = JSON.stringify(input.label);
  return (
    head("a LIVE browser tab has been shared with you.") +
    `\n` +
    `  Tab      ${input.label}\n` +
    `  URL      ${input.url}\n` +
    (input.title ? `  Title    ${input.title}\n` : "") +
    (input.extensionLabel ? `  Browser  ${input.extensionLabel}\n` : "") +
    `\n` +
    `It is already attached — you do NOT need browser_attach_tab. Confirm with\n` +
    `browser_list_attached_tabs(), then drive it:\n` +
    `\n` +
    `  browser_snapshot({ tabTarget: ${t} })\n` +
    `  browser_click({ tabTarget: ${t}, ... })\n` +
    `\n` +
    `⭐ ADDRESS IT BY THAT LABEL, on every call.\n` +
    `⛔ Not by tabId${input.tabId != null ? ` (${input.tabId})` : ""}` +
    `${input.extensionId ? ` or extensionId (${input.extensionId})` : ""} — those are\n` +
    `   bindings, not identity. Chrome remints the extensionId every time it\n` +
    `   restarts the extension's service worker, and tabIds do not survive a\n` +
    `   browser restart. They are printed here for diagnosis only. The label\n` +
    `   survives both, and routing refuses to guess when one is ambiguous.\n` +
    `\n` +
    `⚠️ SHARED, NOT HANDED OVER. The sender is working this tab too.\n` +
    `   Nobody has reserved it — do not call browser_reserve_tab on it, do not\n` +
    `   detach it, and do not close it. If you need it to yourself for a few\n` +
    `   steps, ask them first.`
  );
}

function humanDuration(ms?: number): string {
  if (!ms || ms < 0) return "unknown";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function renderRecordingShare(input: RecordingShare): string {
  const id = JSON.stringify(input.recordingId);
  return (
    head("a session recording has been shared with you.") +
    `\n` +
    (input.title ? `  Title    ${input.title}\n` : "") +
    `  Id       ${input.recordingId}\n` +
    (input.startUrl ? `  Start    ${input.startUrl}\n` : "") +
    `  Length   ${humanDuration(input.durationMs)}\n` +
    (input.pageCount ? `  Pages    ${input.pageCount}\n` : "") +
    `\n` +
    `  browser_get_recording({ recordingId: ${id} })\n` +
    `\n` +
    (input.reviewUrl ? `Human-viewable replay: ${input.reviewUrl}\n\n` : "") +
    `⚠️ Recordings hold rrweb frames, network entries and interactions, and a\n` +
    `   long session runs to megabytes. The call above returns metadata only;\n` +
    `   pass includeEvents:true — and a filter — when you actually need the\n` +
    `   stream, or it will fill your context with replay frames.`
  );
}

function renderContent(input: SendToAgentInput, parkedUrl?: string): string {
  if (input.kind === "tab") return renderTabShare(input);
  if (input.kind === "recording") return renderRecordingShare(input);
  return renderContentShare(input, parkedUrl);
}

function subjectFor(input: SendToAgentInput): string {
  if (input.kind === "tab") return `unibrowse: shared tab "${input.label}"`;
  if (input.kind === "recording") {
    return `unibrowse: shared recording ${input.title || input.recordingId}`;
  }
  return `From unibrowse: ${input.title || input.url}`;
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

    // ⛔ A HANDLE SHARE WITH NO HANDLE IS UNDELIVERABLE ON ARRIVAL. The
    // recipient would get a message telling them to address a tab by a label
    // that is the empty string — which routes to nothing, at the far end,
    // minutes later, as their problem. Refuse it here where the sender is
    // still watching.
    if (input.kind === "tab" && !(input.label || "").trim()) {
      return {
        ok: false,
        sent: 0,
        detail:
          "This tab has no label, and the label is the only handle that survives " +
          "a service-worker restart. Give it one before sharing.",
      };
    }
    if (input.kind === "recording" && !(input.recordingId || "").trim()) {
      return { ok: false, sent: 0, detail: "No recordingId — nothing for the recipient to fetch." };
    }

    // Parking applies to COPIED content only. A handle share is a few hundred
    // bytes by construction and must never be parked: the whole point is that
    // the recipient reads the address, not a body.
    let parkedUrl: string | undefined;
    if (
      (input.kind ?? "content") === "content" &&
      (input as ContentShare).content.length > INLINE_CONTENT_LIMIT &&
      opts.selfBaseUrl
    ) {
      const c = input as ContentShare;
      const id = `park-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      parkContent(id, {
        body: c.content,
        format: c.format,
        title: c.title ?? "",
        url: c.url,
      });
      parkedUrl = `${opts.selfBaseUrl.replace(/\/$/, "")}/shared/${id}`;
    }

    // ⛔ THE REPLAY LINK IS BUILT HERE, from selfBaseUrl — the one setting that
    // knows what URL is reachable from OUTSIDE this container. The extension
    // cannot know it: it builds URLs from its own server config, which is
    // `localhost:9010` for the host browser and `mcp-server:9010` for a
    // sidecar. Both are correct for the sender and dead for every recipient,
    // and the message delivers cleanly either way. Measured 2026-09-01: a real
    // share went out carrying `http://localhost:9010/review/...`.
    const share: SendToAgentInput =
      input.kind === "recording" && !input.reviewUrl && opts.selfBaseUrl
        ? { ...input, reviewUrl: `${opts.selfBaseUrl.replace(/\/$/, "")}/review/${input.recordingId}` }
        : input;

    const body = {
      to,
      from: input.from || "unibrowse",
      subject: subjectFor(share).slice(0, 200),
      content: renderContent(share, parkedUrl),
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
