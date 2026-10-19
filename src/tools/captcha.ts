import { zodToJsonSchema } from "zod-to-json-schema";

import {
  RequestCaptchaSolveTool,
  CheckCaptchaSolveTool,
  CancelCaptchaSolveTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";
import { publishProxyArtifact, sendBrokerMessage, selfPublicBase, seatReachable } from "@/utils/atc-publish";
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

/**
 * ⭐ THE ARTIFACT AND BROKER CALLS LIVE IN @/utils/atc-publish, WITH THEIR
 * TRAPS. Both have a failure mode that returns success — an artifact proxy
 * pointed at an address only this container can resolve, and a broker 200 that
 * delivered to nobody — and both were learned here. They moved when Slipway
 * needed the same two calls, so the lessons have one home rather than two.
 */

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
  return publishProxyArtifact({
    target: `${selfPublicBase()}/captcha/${session.token}/`,
    owner,
    title: "Solve a captcha",
  });
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
  return sendBrokerMessage({
    to,
    from,
    subject: "Captcha needs you",
    content:
      `A browser automation hit a captcha and is waiting.\n\n` +
      `${session.prompt}\n\n` +
      `${url}\n\n` +
      `Tap the picture where you would tap the page. Link expires ` +
      `${new Date(session.expiresAt).toLocaleTimeString()} ` +
      `(${Math.round((session.expiresAt - Date.now()) / 60000)} min).`,
  });
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
  const r = await sendBrokerMessage({
    to: session.requester,
    from: NOTIFY_FROM,
    subject: "Captcha solved",
    content:
      `Captcha solved by the human.\n\n` +
      `sessionId: ${session.id}\n` +
      `tabTarget: ${session.tabTarget}\n` +
      `taps: ${session.taps}, text sent: ${session.typed}` +
      (session.note ? `\nnote: ${session.note}` : "") +
      `\n\nThe tab is yours again — continue. ` +
      `browser_check_captcha_solve remains the authority on the state.`,
  });
  // ⛔ LOGGED, NEVER THROWN. By the time this runs the operator has already
  // been answered by the `done` route, so a failure here must not surface as
  // an error on a captcha that was in fact solved. The agent's own poll still
  // sees `solved`.
  if (r.ok) console.log(`[captcha] solve notice → ${session.requester} (session ${session.id})`);
  else console.error(`[captcha] solve notice to ${session.requester} failed: ${r.error}`);
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

      // ⛔ ASK WHETHER THE REQUESTER CAN BE REACHED *BEFORE* PROMISING IT
      // ANYTHING. Measured on us by `atc` 2026-10-19 10:24:51Z:
      // `agent=alpaca-signup` has no /subscribers row, the notice diverted to
      // the `atc` seat, the operator was never pinged, and this tool returned
      // success with nothing in it to suggest otherwise. One probe removes the
      // whole class — the caller gets the resolution, not a guess.
      // ⚠️ Costs one ~60ms local HTTP call per mint and cannot fail the mint:
      // `seatReachable` answers `null` rather than throwing.
      const reach = requester
        ? await seatReachable(requester)
        : { reachable: null as boolean | null, basis: "no `agent` was passed" };

      // ⛔ DO NOT SEND AS A NAME THAT RESOLVES TO NOBODY. Sending as the
      // requester is what puts the notice in that seat's own channel (Ben,
      // #unibrowse 2026-10-12), and that is kept whenever the name resolves.
      // When it does NOT, the sender-based routing has nothing to route on, so
      // we fall back to the name this tool used before `agent` existed rather
      // than riding an unroutable one.
      // ⚠️ THIS IS MITIGATION, NOT A PROVEN FIX, and the response says so:
      // NOTIFY_FROM is itself `basis: none` as a recipient, and whether the
      // bridge treats an unbound SENDER as a plain DM (what this file recorded
      // from `atc` on 2026-09-12) or diverts it (what `atc` measured on
      // 2026-10-19) is the open question. ⇒ The caller is told to send the URL
      // itself rather than being told the operator was pinged.
      const sendAs = requester && reach.reachable !== false ? requester : NOTIFY_FROM;

      const published = await publishArtifact(session, solver);
      const url = published.url || `${selfPublicBase()}/captcha/${session.token}/`;
      const notified = published.url
        ? await notify(solver, url, session, sendAs)
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
          // ⚠️ THE RESOLUTION, NOT A GUESS. `false` is a legitimate answer for a
          // real seat with no channel (a sidecar, `claude-login-auto`); `null`
          // means the probe itself could not answer. ⛔ Neither value is
          // evidence that the NAME is wrong — absence and deafness are not
          // distinguished by the endpoint, and it says so itself.
          requesterReachable: reach.reachable,
          requesterBasis: reach.basis,
          sentAs: sendAs,
          notifiedVia:
            !requester
              ? "the solver's DM (no `agent` was passed)"
              : reach.reachable === true
                ? `sent as "${requester}", which resolves (${reach.basis}), so it lands in that correspondent's own channel`
                : reach.reachable === false
                  ? `⚠️ "${requester}" resolves to nobody (${reach.basis}), so it was NOT used as the sender — sent as "${NOTIFY_FROM}" instead, and WHERE THAT LANDS IS UNCONFIRMED`
                  : `sent as "${requester}", but its resolution could not be checked (${reach.basis})`,
          // ⚠️ `solveNoticeTo` NULL NOW HAS TWO CAUSES AND THEY ARE DIFFERENT
          // FAULTS: no `agent` was passed, or the `agent` passed cannot be
          // reached. Both mean the same thing operationally — polling is the
          // only way you will learn — so the field reports the operational
          // truth and `requesterBasis` carries the reason.
          solveNoticeTo: reach.reachable === false ? null : (requester ?? null),
          // ⚠️ Say it plainly rather than leaving the caller to infer it from
          // two nulls: if nobody was told, the link is inert until someone is.
          // ⛔ `notified.ok` MEANS THE BROKER ACCEPTED AND FANNED OUT. It is
          // NOT evidence a human saw it, which is exactly how the
          // 2026-10-19 alpaca-signup mint read as a success.
          nextStep: !notified.ok
            ? `⚠️ NOBODY WAS NOTIFIED — send this URL to a human yourself, then poll browser_check_captcha_solve with sessionId ${session.id}.`
            : reach.reachable === false
              ? `⚠️ SEND THIS URL TO A HUMAN YOURSELF. The broker accepted the notice, but "${requester}" resolves to nobody, so neither the channel ping nor the solved-notice can be relied on. Then poll browser_check_captcha_solve with sessionId ${session.id}.`
              : `Poll browser_check_captcha_solve with sessionId ${session.id}.`,
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
