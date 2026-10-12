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
 * Tell the human there is a captcha waiting.
 *
 * ⛔ `from` IS NOT COSMETIC — IT DECIDES WHICH ROOM THIS LANDS IN.
 * A message addressed to `slack:U0NGEHS2J` is REDIRECTED by the Slack bridge
 * into the SENDER's own channel when `from` names a correspondent that has one;
 * an UNBOUND sender falls through to `route.kind === "dm"` and produces a real
 * DM. (Mechanism measured and explained by the `atc` seat 2026-09-12; the
 * resolution itself is `routeFor` in atc slack/src/bridge.mjs, read 2026-10-12.)
 *
 * ⭐ THAT REDIRECT IS NOW THE FEATURE, NOT THE TRAP. Ben, Slack #unibrowse
 * 2026-10-12, verbatim: "get notified about captchas on the channel of the
 * agent or thread requesting it". So we send AS the requesting agent, and the
 * notice appears in that correspondent's channel — or, for a thread carrying
 * its own `slack_channel_id`, in the thread's own channel, which is the branch
 * that makes "or thread" work without us knowing anything about threads.
 * ⚠️ This file used to say the opposite, in a comment that was correct when the
 * only goal was to make the phone buzz. Both behaviours are still here; which
 * one you get is decided by whether the caller identified itself.
 *
 * ⚠️ A REQUESTER WITH NO CHANNEL DEGRADES TO THE OLD BEHAVIOUR, SILENTLY AND
 * CORRECTLY. The bridge's lookup does not CREATE a channel, so a seat that has
 * never had one (a sidecar, `claude-login-auto`) resolves to the human's DM
 * exactly as before. Nothing is lost; the notice simply arrives where it used
 * to. ⇒ Do not read "it went to a DM" as this code having been bypassed.
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
  from: string,
): Promise<{ ok: boolean; error: string | null }> {
  const body = {
    to,
    from,
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

/**
 * Tell the requesting agent its captcha was solved, so it does not have to keep
 * polling to find out. Ben, Slack #unibrowse 2026-10-12: "make sure that the
 * agent or thread requesting is notified once I solve the caption".
 *
 * ⛔ ADDRESSED TO THE REQUESTER, SENT FROM AN UNBOUND NAME. The recipient here
 * is an agent, not a human, so the bridge's sender-channel redirect never
 * applies and `from` is pure provenance — but it must NOT be the requester's
 * own id, or the message is from a seat to itself.
 *
 * ⚠️ This is an ADDITION to polling, not a replacement for it. It fires only on
 * the human pressing Done: an expiry is evaluated lazily when the session is
 * read, so there is no moment at which anything could send that one. An agent
 * that stops polling and waits for mail would hang on a captcha nobody solved.
 * ⇒ browser_check_captcha_solve remains the authority; this is what makes the
 * common case prompt instead of up-to-one-poll-interval late.
 */
export async function notifySolvedToRequester(session: CaptchaSession): Promise<void> {
  if (!session.requester) return;
  const body = {
    to: session.requester,
    from: NOTIFY_FROM,
    subject: "Captcha solved",
    priority: "info",
    content:
      `Captcha solved by the human.\n\n` +
      `sessionId: ${session.id}\n` +
      `tabTarget: ${session.tabTarget}\n` +
      `taps: ${session.taps}, text sent: ${session.typed}` +
      (session.note ? `\nnote: ${session.note}` : "") +
      `\n\nThe tab is yours again — continue. ` +
      `browser_check_captcha_solve remains the authority on the state.`,
  };
  try {
    const resp = await fetch(`${BROKER_BASE}/inbox/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // ⛔ `sent` AGAIN, NOT THE STATUS CODE — same failure shape as notify():
    // a 200 with sent:0 means the requester id matched no subscriber and the
    // message was accepted and dropped. Logged rather than thrown, because by
    // the time this runs the operator has already been answered.
    const data: any = resp.ok ? await resp.json().catch(() => null) : null;
    if (!resp.ok) {
      console.error(`[captcha] solve notice to ${session.requester} failed: HTTP ${resp.status}`);
    } else if (!data || Number(data.sent) < 1) {
      console.error(
        `[captcha] solve notice accepted but delivered to nobody (sent=${data?.sent ?? "?"}) — ` +
          `is "${session.requester}" a real subscriber?`,
      );
    } else {
      console.log(`[captcha] solve notice → ${session.requester} (session ${session.id})`);
    }
  } catch (err: any) {
    console.error(`[captcha] solve notice to ${session.requester} threw: ${err?.message ?? err}`);
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
      // ⭐ `agent` IS THE REQUESTER, AND IT IS THE SAME FIELD THE TAB
      // RESERVATION USES — one identity, not a second one to keep in step. It
      // decides two things now: which channel the human is told in, and who is
      // told when the captcha is solved.
      const requester = (p as any).agent ? String((p as any).agent) : null;
      const session = createCaptchaSession({
        tabTarget: p.tabTarget,
        extensionId: (p as any).extensionId,
        prompt: p.prompt,
        ttlSeconds: p.ttlSeconds,
        rect: p.rect ?? null,
        requester,
      });

      const solver = p.notify || "slack:U0NGEHS2J";
      const published = await publishArtifact(session, solver);
      const url = published.url || `${selfPublicBase()}/captcha/${session.token}/`;
      const notified = published.url
        ? await notify(solver, url, session, requester ?? NOTIFY_FROM)
        : { ok: false, error: "not published" };

      return jsonResponse(
        {
          ...view(session),
          url,
          // ⭐ The LAN URL, for a caller already inside the network. Same token,
          // so it is no more of a secret than `url`.
          // ⚠️ HISTORY, because it shaped the page's design: until 2026-09-12
          // nginx returned 403 on every POST under /f/, so the public link
          // could show the page and the live screenshot but could not relay a
          // tap. The nginx seat then added a narrow $-anchored allowance
          // (commit 2fb447c) for POST /f/up-<32hex>/{tap,text,done} only.
          // ⛔ Those three paths are the entire write surface. GET on them is
          // 403 — they are callbacks, not files — so polling must stay on
          // /state and /shot, and a FOURTH verb needs another nginx change.
          // Body is capped at 64k; the text relay is capped well under that.
          lanUrl: `${selfPublicBase()}/captcha/${session.token}/`,
          expiresAt: new Date(session.expiresAt).toISOString(),
          publishedAsArtifact: Boolean(published.url),
          publishError: published.error,
          notifiedTo: notified.ok ? solver : null,
          notifyError: notified.error,
          // ⚠️ `requester` NULL IS A REAL ANSWER, NOT A MISSING FIELD: it means
          // the call carried no `agent`, so the notice went to the solver's DM
          // and NOBODY will be told when it is solved. Pass `agent` to get
          // both. Said here rather than left to be inferred from two nulls.
          requester,
          notifiedVia: requester
            ? `sent as "${requester}", so it lands in that correspondent's own channel if it has one, else the solver's DM`
            : "the solver's DM (no `agent` was passed)",
          solveNoticeTo: requester ?? null,
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
