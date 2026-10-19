import { zodToJsonSchema } from "zod-to-json-schema";

import { OpenSlipwayTool, CloseSlipwayTool } from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";
import { publishProxyArtifact, sendBrokerMessage, selfPublicBase, seatReachable } from "@/utils/atc-publish";
import {
  createSlipwaySession,
  getSlipwayById,
  resolveSlipway,
  type SlipwaySession,
} from "@/slipway";

import type { Tool } from "./tool";

/**
 * ⛔ NEITHER TOOL HERE MAY CALL ensureAttachedFromParams(), for the same reason
 * as the captcha tools: these are session-management calls, not page actions.
 * Slipway shows what is ALREADY attached to a browser; auto-attaching would
 * open a tab to satisfy a request that named none.
 */

function view(s: SlipwaySession) {
  return {
    sessionId: s.id,
    label: s.label,
    state: s.state,
    extensionId: s.extensionId,
    tabTarget: s.tabTarget,
    recording: s.recording,
    taps: s.taps,
    typed: s.typed,
    requester: s.requester,
    secondsRemaining: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)),
    expiresAt: new Date(s.expiresAt).toISOString(),
  };
}

export const openSlipway: Tool = {
  schema: {
    name: OpenSlipwayTool.shape.name.value,
    description: OpenSlipwayTool.shape.description.value,
    inputSchema: zodToJsonSchema(OpenSlipwayTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const p = OpenSlipwayTool.shape.arguments.parse(params);

      // ⛔ FAIL LOUDLY ON AN UNKNOWN BROWSER. A session minted against an id
      // that is not connected would serve a page whose tab roster is empty —
      // byte-identical to "that browser has no tabs attached", which is the
      // one reading that stops the holder investigating. Same rule as
      // browser_list_attached_tabs.
      if (!context.getExtension(p.extensionId)) {
        const known = context.listExtensions().map((c) => c.extensionId);
        return errorResponse(
          `No connected extension with id ${p.extensionId}. ` +
            (known.length
              ? `Connected: ${known.join(", ")}. ⛔ This is NOT "no tabs there" — that browser is not connected at all.`
              : `No extensions are connected at all.`),
          false,
          undefined,
          max_tokens,
        );
      }

      const requester = (p as any).agent ? String((p as any).agent) : null;
      const session = createSlipwaySession({
        extensionId: p.extensionId,
        label: p.label,
        tabTarget: p.tabTarget ?? null,
        ttlSeconds: p.ttlSeconds,
        requester,
      });

      const holder = p.notify || "slack:U0NGEHS2J";

      // ⛔ SAME PROBE AS THE CAPTCHA RELAY, AND IT MATTERS MORE HERE. `atc`
      // measured a captcha mint on 2026-10-19 10:24:51Z whose `agent` resolved
      // to nobody: the notice diverted, the operator was never pinged, and the
      // tool returned success. A Slipway link is a LIVE CAPABILITY — it reads
      // and drives every tab in that browser until the TTL expires — so a
      // notice nobody receives leaves one open with no one watching it.
      // ⚠️ The no-`agent` path was never affected: "unibrowse" resolves.
      const reach = requester
        ? await seatReachable(requester)
        : { reachable: null as boolean | null, basis: "no `agent` was passed" };
      const sendAs = requester && reach.reachable !== false ? requester : "unibrowse";

      const target = `${selfPublicBase()}/slipway/${session.token}/`;
      const published = await publishProxyArtifact({
        target,
        owner: holder,
        title: `Slipway — ${session.label}`,
      });
      const url = published.url || target;

      const mins = Math.round((session.expiresAt - Date.now()) / 60000);
      const notified = published.url
        ? await sendBrokerMessage({
            to: holder,
            // ⛔ THE SEAT'S OWN NAME, SO THE BRIDGE POSTS THIS IN #unibrowse
            // RATHER THAN DMing THE OPERATOR. This file briefly did the
            // opposite, on my reasoning that a long-lived browser-driving URL
            // deserves the smaller audience of a DM. Ben overruled it within
            // minutes, twice: #unibrowse 15:32 "don't worry about credentials
            // and stuff that's fine you can put it right here it's fine", and
            // #atc 15:32 (relayed by `atc`, ts 1791833522.490209) "I don't know
            // why these are going to [the ATC bridge] I don't like it it should
            // be going to the unibrow's channel or whatever".
            // ⭐ DO NOT "FIX" THIS BACK. And do not generalise it either:
            // `unibrowse-captcha` deliberately stays on an unbound name and
            // keeps DMing him, because he approved that one at source
            // (#agents 2026-10-09) on the reasoning that a captcha is the one
            // alert no agent can action, so routing it to a seat's channel
            // guarantees nobody solves it.
            // ⛔ `sendAs`, NOT `requester`: an `agent` that resolves to nobody
            // gives the bridge nothing to route on, so it falls back to this
            // seat's own name — which resolves — rather than riding a name
            // measured to divert. The response reports which was used.
            from: sendAs,
            subject: "Slipway is open",
            content:
              `Drive ${session.label} from your phone:\n\n${url}\n\n` +
              `Pick a tab at the top — every tab in that browser is listed, and \u25cf marks one ` +
              `that is not attached yet, which picking it fixes. Then tap the picture where ` +
              `you would tap the page. ` +
              `Hold for a press-and-hold. Expires in ${mins} min.\n\n` +
              `⚠️ This link can read and drive every tab open in that browser until it expires. ` +
              `Treat it like a password and tell me when you are done so I can close it.`,
          })
        : { ok: false, error: "not published" };

      return jsonResponse(
        {
          ...view(session),
          url,
          // The LAN URL, for a caller already inside the network. Same token,
          // so it is no more of a secret than `url`.
          lanUrl: target,
          publishedAsArtifact: Boolean(published.url),
          publishError: published.error,
          notifiedTo: notified.ok ? holder : null,
          notifyError: notified.error,
          // ⚠️ THE RESOLUTION, NOT A GUESS — and `false` is a legitimate answer
          // for a real seat with no channel, never evidence the name is wrong.
          requester,
          requesterReachable: reach.reachable,
          requesterBasis: reach.basis,
          sentAs: sendAs,
          capability:
            "⚠️ The holder of this URL can read and drive EVERY tab OPEN IN " +
            `${p.extensionId} until ${new Date(session.expiresAt).toISOString()}. ` +
            "Bounded to that one browser and that TTL; not single-use.",
          // ⛔ `notified.ok` MEANS THE BROKER ACCEPTED AND FANNED OUT, not that
          // a human saw it. That distinction is the whole 2026-10-19 defect.
          nextStep: !notified.ok
            ? `⚠️ NOBODY WAS NOTIFIED — send this URL to its user yourself, then close it with browser_close_slipway sessionId ${session.id}.`
            : reach.reachable === false
              ? `⚠️ SEND THIS URL TO ITS USER YOURSELF — "${requester}" resolves to nobody (${reach.basis}), so the notice cannot be relied on to have reached anyone. A Slipway left open is a live capability: close it with browser_close_slipway sessionId ${session.id}.`
              : `Close it with browser_close_slipway sessionId ${session.id} when the job is done.`,
        },
        true,
        max_tokens,
      );
    } catch (error: any) {
      return errorResponse(`Failed to open Slipway: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const closeSlipway: Tool = {
  schema: {
    name: CloseSlipwayTool.shape.name.value,
    description: CloseSlipwayTool.shape.description.value,
    inputSchema: zodToJsonSchema(CloseSlipwayTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      const { sessionId } = CloseSlipwayTool.shape.arguments.parse(params);
      const s = getSlipwayById(sessionId);
      if (!s) {
        return errorResponse(
          `No Slipway session ${sessionId}. Sessions live in memory and do not survive an mcp-server restart — ` +
            `if the server was restarted the link is already dead, which is the safe direction.`,
          false,
          undefined,
          max_tokens,
        );
      }
      // Re-resolve through the token path so expiry is applied on read.
      resolveSlipway(s.token);
      if (s.state === "live") {
        s.state = "ended";
        s.endedAt = Date.now();
      }
      // ⚠️ A recording this session started is NOT stopped here — only the HTTP
      // `done` route holds the socket deps that can stop it. Say so rather than
      // leaving the caller to assume: if `recording` comes back true, stop it
      // with browser_stop_session_recording.
      return jsonResponse(
        {
          ...view(s),
          recordingStillRunning: s.recording,
          note: s.recording
            ? "⚠️ The session was recording and closing it here does NOT stop that — stop it with browser_stop_session_recording."
            : null,
        },
        true,
        max_tokens,
      );
    } catch (error: any) {
      return errorResponse(`Failed to close Slipway: ${error.message}`, false, error, max_tokens);
    }
  },
};
