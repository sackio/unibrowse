import { zodToJsonSchema } from "zod-to-json-schema";

import {
  RequestCaptchaSolveTool,
  CheckCaptchaSolveTool,
  CancelCaptchaSolveTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";
import {
  createCaptchaSession,
  getSessionById,
  resolveSession,
  type CaptchaSession,
} from "@/captcha";

import type { Tool } from "./tool";

/**
 * ⛔ NO TOOL HERE MAY CALL ensureAttachedFromParams(), for the same reason as
 * downloads.ts: these are session-management calls, not page actions. The tab
 * must ALREADY be attached — that is the caller's job and it is why tabTarget is
 * required rather than optional. Auto-attaching here would open a tab to satisfy
 * a captcha request that names a different one.
 */

const ARTIFACT_BASE = process.env.ATC_FILES_URL || "http://192.168.1.168:3031";
const BROKER_BASE = process.env.ATC_BROKER_URL || "http://192.168.1.168:3030";

/**
 * The URL the ARTIFACT PROXY will fetch. It must be an address the atc-files
 * host can reach, not one that only resolves inside our container.
 *
 * ⛔ Not `localhost`, and not the compose service name `mcp-server` — both
 * resolve here and NOWHERE else, so the proxy would 502 while everything on our
 * side looked correct. Same trap UNIBROWSE_PUBLIC_URL exists to avoid; reuse it.
 * ⚠️ The artifact proxy also refuses loopback outright, so a localhost value
 * fails at publish time rather than silently — but only for loopback, and the
 * service-name case would sail through.
 */
function selfPublicBase(): string {
  return (process.env.UNIBROWSE_PUBLIC_URL || "http://192.168.1.199:9010").replace(/\/$/, "");
}

/**
 * Publish the solver page as an ATC artifact that PROXIES us.
 *
 * ⛔ Proxy, not `html`. An artifact serving its own HTML is locked to the
 * artifact origin by CSP (`connect-src 'self'`) and could not poll unibrowse for
 * screenshots at all. Proxying mounts OUR page under the artifact's origin, so
 * the page's relative fetches are same-origin and work.
 */
async function publishArtifact(
  session: CaptchaSession,
  owner: string,
): Promise<{ url: string | null; error: string | null }> {
  const target = `${selfPublicBase()}/captcha/${session.token}/`;
  try {
    const resp = await fetch(`${ARTIFACT_BASE}/artifact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proxy: target,
        owner,
        title: "Solve a captcha",
      }),
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
 * DM the link to whoever is solving.
 *
 * ⛔ `from` IS NOT COSMETIC — IT DECIDES WHETHER THIS IS A DM AT ALL.
 * A message addressed to `slack:U0NGEHS2J` is REDIRECTED into the SENDER's own
 * Slack channel when `from` names a seat with a bound channel. So
 * `from: "unibrowse"` would post the captcha link to #unibrowse instead of
 * DMing Ben — it would look delivered, and the phone would never buzz, which is
 * the entire feature. An UNBOUND sender falls through to `route.kind === "dm"`
 * and produces a real DM. Hence the deliberately channel-less name below.
 * (Measured and explained by the `atc` seat, 2026-09-12; broker log line says
 * which path was taken.)
 *
 * ⚠️ BEST EFFORT, AND THE CALLER IS TOLD WHEN IT FAILS. A captcha nobody is told
 * about blocks an agent until timeout, so a failure here must never be
 * swallowed. It is not fatal either: the URL is still returned.
 */
const NOTIFY_FROM = "unibrowse-captcha";

async function notify(
  to: string,
  url: string,
  session: CaptchaSession,
): Promise<{ ok: boolean; error: string | null }> {
  const body = {
    to,
    from: NOTIFY_FROM,
    subject: "Captcha needs you",
    priority: "info",
    content:
      `A browser automation hit a captcha and is waiting.\n\n` +
      `${session.prompt}\n\n` +
      `${url}\n\n` +
      `Tap the picture where you would tap the page. Link expires ` +
      `${new Date(session.expiresAt).toLocaleTimeString()} ` +
      `(${Math.round((session.expiresAt - Date.now()) / 60000)} min).`,
  };
  try {
    // ⛔ /inbox/send, NOT /messages. sse-mcp also registers POST /messages as
    // the legacy MCP transport and falls through, so /messages is ambiguous.
    const resp = await fetch(`${BROKER_BASE}/inbox/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return { ok: false, error: `broker /inbox/send returned HTTP ${resp.status}` };
    }
    // ⛔ READ `sent`, NOT THE STATUS CODE. A 200 with sent:0 means the address
    // matched no subscriber and the message was accepted and dropped — the
    // failure shape this whole feature cannot afford to report as success.
    const data: any = await resp.json();
    if (!data || Number(data.sent) < 1) {
      return { ok: false, error: `broker accepted but delivered to nobody (sent=${data?.sent ?? "?"}) — is "${to}" a real subscriber?` };
    }
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function view(s: CaptchaSession) {
  return {
    sessionId: s.id,
    state: s.state,
    prompt: s.prompt,
    tabTarget: s.tabTarget,
    taps: s.taps,
    typed: s.typed,
    secondsRemaining: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)),
    solvedAt: s.solvedAt ? new Date(s.solvedAt).toISOString() : null,
    note: s.note,
  };
}

export const requestCaptchaSolve: Tool = {
  schema: {
    name: RequestCaptchaSolveTool.shape.name.value,
    description: RequestCaptchaSolveTool.shape.description.value,
    inputSchema: zodToJsonSchema(RequestCaptchaSolveTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const p = RequestCaptchaSolveTool.shape.arguments.parse(params);
      if (p.tabTarget === undefined || p.tabTarget === null) {
        return errorResponse(
          "browser_request_captcha_solve requires tabTarget — the session is bound to one tab, " +
            "and binding it to 'whichever tab was last used' is how a link ends up pointed at the wrong page.",
          false,
          undefined,
          max_tokens,
        );
      }
      const session = createCaptchaSession({
        tabTarget: p.tabTarget,
        extensionId: (p as any).extensionId,
        prompt: p.prompt,
        ttlSeconds: p.ttlSeconds,
        rect: p.rect ?? null,
      });

      const solver = p.notify || "slack:U0NGEHS2J";
      const published = await publishArtifact(session, solver);
      const url = published.url || `${selfPublicBase()}/captcha/${session.token}/`;
      const notified = published.url ? await notify(solver, url, session) : { ok: false, error: "not published" };

      return jsonResponse(
        {
          ...view(session),
          url,
          // ⭐ The LAN URL, for a caller already inside the network. Same token,
          // so it is no more of a secret than `url` — and it is the ONLY one
          // that accepts taps today: nginx proxies /f/ for READING and returns
          // 403 on POST, so the public link can show the page and the live
          // screenshot but cannot relay a tap. Measured 2026-09-12.
          lanUrl: `${selfPublicBase()}/captcha/${session.token}/`,
          expiresAt: new Date(session.expiresAt).toISOString(),
          publishedAsArtifact: Boolean(published.url),
          publishError: published.error,
          notifiedTo: notified.ok ? solver : null,
          notifyError: notified.error,
          // ⚠️ Say it plainly rather than leaving the caller to infer it from
          // two nulls: if nobody was told, the link is inert until someone is.
          nextStep: notified.ok
            ? `Poll browser_check_captcha_solve with sessionId ${session.id}.`
            : `⚠️ NOBODY WAS NOTIFIED — send this URL to a human yourself, then poll browser_check_captcha_solve with sessionId ${session.id}.`,
        },
        true,
        max_tokens,
      );
    } catch (error: any) {
      return errorResponse(`Failed to request captcha solve: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const checkCaptchaSolve: Tool = {
  schema: {
    name: CheckCaptchaSolveTool.shape.name.value,
    description: CheckCaptchaSolveTool.shape.description.value,
    inputSchema: zodToJsonSchema(CheckCaptchaSolveTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const { sessionId } = CheckCaptchaSolveTool.shape.arguments.parse(params);
      const s = getSessionById(sessionId);
      if (!s) {
        return errorResponse(
          `No captcha session ${sessionId}. Sessions live in memory and do not survive an mcp-server restart — ` +
            `if the server was restarted, the link is dead and a new request is needed.`,
          false,
          undefined,
          max_tokens,
        );
      }
      // Re-resolve through the token path so expiry is applied on read.
      resolveSession(s.token);
      return jsonResponse(view(s), true, max_tokens);
    } catch (error: any) {
      return errorResponse(`Failed to check captcha solve: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const cancelCaptchaSolve: Tool = {
  schema: {
    name: CancelCaptchaSolveTool.shape.name.value,
    description: CancelCaptchaSolveTool.shape.description.value,
    inputSchema: zodToJsonSchema(CancelCaptchaSolveTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const { sessionId } = CancelCaptchaSolveTool.shape.arguments.parse(params);
      const s = getSessionById(sessionId);
      if (!s) {
        return errorResponse(`No captcha session ${sessionId}.`, false, undefined, max_tokens);
      }
      if (s.state === "pending") s.state = "cancelled";
      return jsonResponse(view(s), true, max_tokens);
    } catch (error: any) {
      return errorResponse(`Failed to cancel captcha solve: ${error.message}`, false, error, max_tokens);
    }
  },
};
