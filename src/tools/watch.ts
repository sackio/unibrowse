import { zodToJsonSchema } from "zod-to-json-schema";

import {
  WatchCreateTool,
  WatchDeleteTool,
  WatchListTool,
  WatchPollTool,
  WatchSourcesTool,
} from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";
import { validatePredicate } from "@/watch/predicate";
import { SOURCES, validateSourceId } from "@/watch/sources";
import {
  buffersLostToRestart,
  forgetWatch,
  persistWatch,
  watchBuffer,
  watchRegistry,
} from "@/watch/service";
import type { WatchTombstone } from "@/watch/types";
import type { SinkSpec } from "@/watch/types";

import type { Tool } from "./tool";

/**
 * Watch tools — arm a push subscription on a browser event source.
 *
 * ⛔ browser_watch_list reports the extension's raw `armed` answer and never
 * repairs on read. See the note on WatchRecord.armedReportedByExtension and
 * memo 9fb367c0: repairing the state you publish hides the condition being
 * published, and an external consumer already depends on that discipline for
 * browser_list_attached_tabs.
 */

/** Render the tri-state honestly. null is NOT false. */
function renderArmed(rec: {
  armedReportedByExtension: boolean | null;
  armedReportedAt: number | null;
}): string {
  if (rec.armedReportedByExtension === null) return "unknown — extension has never reported";
  const when = rec.armedReportedAt ? new Date(rec.armedReportedAt).toISOString() : "?";
  return `${rec.armedReportedByExtension} (as of ${when})`;
}

export const watchSources: Tool = {
  schema: {
    name: WatchSourcesTool.shape.name.value,
    description: WatchSourcesTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchSourcesTool.shape.arguments),
  },
  handle: (async (_context, params) => {
    const { filter } = WatchSourcesTool.shape.arguments.parse(params ?? {});
    const list = filter
      ? SOURCES.filter((s) => s.id.toLowerCase().includes(filter.toLowerCase()))
      : SOURCES;

    if (list.length === 0) {
      return textResponse(
        `No watch source matches "${filter}". Call browser_watch_sources with no filter to see all ${SOURCES.length}.`,
      );
    }

    let out = `# Watch sources (${list.length}${filter ? ` matching "${filter}"` : ""})\n\n`;
    out += `The predicate argument differs per source. Copy the shape below rather than guessing —\n`;
    out += `a predicate written against the wrong shape simply never matches, which looks exactly\n`;
    out += `like a quiet page.\n\n`;

    let currentGroup = "";
    for (const s of list) {
      const group = s.id.split(".")[0];
      if (group !== currentGroup) {
        currentGroup = group;
        const heading =
          group === "cdp"
            ? "CDP — per attached tab"
            : group === "chrome"
              ? "chrome.* — browser-wide APIs"
              : "unibrowse — the automation plane itself";
        out += `\n## ${heading}\n\n`;
      }
      out += `**\`${s.id}\`**  ·  ${s.scope}-scoped  ·  volume: ${s.cost}\n`;
      out += `${s.description}\n`;
      out += `predicate: \`${s.predicateArg}\`\n\n`;
    }
    return textResponse(out);
  }) as Tool["handle"],
};

export const watchCreate: Tool = {
  schema: {
    name: WatchCreateTool.shape.name.value,
    description: WatchCreateTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchCreateTool.shape.arguments),
  },
  handle: (async (context, params) => {
    try {
      const args = WatchCreateTool.shape.arguments.parse(params ?? {});

      // Name the near miss rather than failing bare — a mistyped source that
      // returned "unknown source" would leave the caller believing they armed
      // something.
      const check = validateSourceId(args.source);
      if (!check.ok) return errorResponse(check.error);
      const descriptor = check.source;

      // Compile the predicate NOW so a syntax error is refused at create time
      // rather than arming a watch that could never match.
      const pred = validatePredicate(args.predicate);
      if (!pred.ok) return errorResponse(pred.error);

      // Page sources that need a selector must get one at CREATE time. The
      // injected observer does report the mistake, but only after arming — and
      // "armed, fires one error, then nothing" is a worse thing to hand back
      // than a refusal.
      const NEEDS_SELECTOR = ["dom.mutation", "dom.elementText", "dom.intersection"];
      if (NEEDS_SELECTOR.includes(args.source) && args.source !== "dom.mutation" && !args.config?.selector) {
        return errorResponse(
          `Source "${args.source}" requires config.selector, e.g. config: {selector: "#status"}.`,
        );
      }
      if (args.source === "page.event" && !args.config?.eventName) {
        return errorResponse(
          `Source "page.event" requires config.eventName, e.g. config: {eventName: "my-app-ready"}.`,
        );
      }

      const sink = (args.sink ?? { kind: "atc" }) as SinkSpec;

      // Fail at CREATE time, not at fire time. An atc sink with nowhere to go
      // would otherwise arm cleanly and then discard every match.
      if (sink.kind === "atc" && !sink.to && !args.agent) {
        return errorResponse(
          `This watch would have nowhere to deliver: sink.kind is "atc" but neither sink.to ` +
            `nor \`agent\` was set. Pass \`agent\` with your identifier so events reach your own ` +
            `session, or set sink.to explicitly.`,
        );
      }
      if (sink.kind === "webhook" && !sink.url) {
        return errorResponse(`sink.kind is "webhook" but sink.url was not set.`);
      }

      // Resolve the tab only for a tab-scoped source. A browser-wide source
      // does not need an attachment and must not be gated on one.
      let tabId: number | null = null;
      let extensionId = args.extensionId;
      if (descriptor.scope === "tab") {
        const attached = await context.ensureAttachedFromParams(args);
        tabId = attached.tabId;
        if (!extensionId) {
          extensionId = context.extensionIdForTab(attached.tabId);
        }
      }
      if (!extensionId) {
        const exts = context.listExtensions();
        if (exts.length === 1) extensionId = exts[0].extensionId;
        else if (exts.length > 1) {
          return errorResponse(
            `Multiple extensions are connected (${exts.length}); pass extensionId to say which ` +
              `browser to arm the watch in. Connected: ${exts.map((e) => e.extensionId).join(", ")}`,
          );
        } else {
          return errorResponse(`No extension is connected, so there is nothing to arm a watch in.`);
        }
      }

      const record = watchRegistry.create(
        {
          source: args.source,
          prefilter: args.prefilter,
          predicate: args.predicate,
          config: args.config,
          sink,
          options: args.options,
          tabId,
          extensionId,
          agent: args.agent,
        },
        descriptor.home,
      );

      // Resolve the document a page watch belongs to BEFORE arming, so the
      // extension can guard its own re-inject path with it.
      let armedAgainstUrl: string | undefined;
      if (descriptor.home === "page" && tabId != null) {
        try {
          // ⛔ Live URL, not the tab record: browser_list_attached_tabs reports
          // the URL from ATTACH time and never updates it on navigation, so a
          // tab that had already moved would be recorded against the wrong
          // document and cleared on its very next navigation.
          // ⛔ location.href, not getUrl / list_attached_tabs — both of those
          // report the URL from ATTACH time and never update on navigation.
          const u: any = await context.sendSocketMessage(
            "browser_evaluate",
            { expression: "location.href", tabTarget: tabId },
            { extensionId, tabTarget: tabId, timeoutMs: 5000 },
          );
          const raw = typeof u === "string" ? u : (u?.result ?? u?.value);
          armedAgainstUrl = typeof raw === "string" ? raw.replace(/^"|"$/g, "") : undefined;
        } catch {
          // Without a URL the watch is armed but not URL-guarded, and will not
          // be rehydrated after a restart. Safe direction, and stated below.
        }
      }

      // Arm it in the extension, and record what the extension actually said.
      let armed: boolean;
      try {
        const res: any = await context.sendSocketMessage(
          "browser_watch_arm",
          {
            watchId: record.watchId,
            source: record.source,
            // ⛔ The extension gets the PREFILTER, not the predicate: MV3's CSP
            // forbids evaluating a string as JS in a service worker. A page
            // watch is the exception — its predicate is injected into the
            // document and runs under the page's CSP.
            prefilter: record.prefilter,
            predicate: descriptor.home === "page" ? record.predicate : undefined,
            config: record.config,
            armedAgainstUrl,
            options: record.options as Record<string, unknown> | undefined,
            tabId: record.tabId,
            extensionId,
          },
          { extensionId },
        );
        armed = res?.armed === true;
        watchRegistry.recordArmed(record.watchId, armed, Date.now());
      } catch (e) {
        // The extension refused or is unreachable. Do NOT keep a registry row
        // claiming a watch exists — that is the drift this design is built to
        // avoid, and here we can simply not create it.
        watchRegistry.delete(record.watchId);
        return errorResponse(
          `Failed to arm the watch in extension ${extensionId}: ${(e as Error)?.message ?? e}. ` +
            `No watch was created.`,
        );
      }

      if (!armed) {
        watchRegistry.delete(record.watchId);
        return errorResponse(
          `Extension ${extensionId} did not confirm the watch as armed. No watch was created.`,
        );
      }

      // Honour sink.maxBuffered. Set after the arm succeeds so a refused arm
      // leaves no capacity entry behind.
      if (sink.kind === "buffer") {
        watchBuffer.setCapacity(record.watchId, sink.maxBuffered);
      }

      // Persist only a CONFIRMED arm, so a refused one leaves nothing to
      // rehydrate.
      void persistWatch({ ...record, armedAgainstUrl });

      let out = `# Watch armed\n\n`;
      out += `**watchId**: \`${record.watchId}\`\n`;
      out += `**source**: \`${record.source}\` (${descriptor.scope}-scoped, volume ${descriptor.cost})\n`;
      out += `**home**: ${record.home}\n`;
      if (tabId != null) out += `**tab**: ${tabId}\n`;
      out += `**extension**: ${extensionId}\n`;
      out += `**sink**: ${sink.kind}`;
      if (sink.kind === "atc") out += ` → ${sink.to ?? args.agent}`;
      if (sink.kind === "webhook") out += ` → ${sink.url}`;
      out += `\n`;
      out += `**predicate**: ${record.predicate ? `\`${record.predicate}\`` : "none — fires on every event"}\n`;
      if (descriptor.home === "page") {
        out += armedAgainstUrl
          ? `**document**: ${armedAgainstUrl}\n  (if this tab navigates elsewhere the watch is cleared as \`document-changed\` rather than re-attached to the new page)\n`
          : `⚠️ **document**: could not be read, so this watch is NOT url-guarded — if the tab navigates it may re-attach to a different page, and it will not survive a server restart.\n`;
      }
      out += `\n`;
      out += `Events are dropped if nothing is listening when they fire; they are never queued.\n`;
      out += `This watch is cleared when the tab detaches, the extension disconnects`;
      if (record.options?.ttlMs) out += `, after ${record.options.ttlMs}ms`;
      if (record.options?.once) out += `, or after its first match`;
      out += `, or when you call browser_watch_delete.\n`;
      if (sink.kind === "buffer") {
        out += `\nDrain it with \`browser_watch_poll({watchId: "${record.watchId}"})\`.\n`;
      }
      return textResponse(out);
    } catch (e) {
      return errorResponse(`browser_watch_create failed: ${(e as Error)?.message ?? e}`);
    }
  }) as Tool["handle"],
};

export const watchList: Tool = {
  schema: {
    name: WatchListTool.shape.name.value,
    description: WatchListTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchListTool.shape.arguments),
  },
  handle: (async (context, params) => {
    try {
      const args = WatchListTool.shape.arguments.parse(params ?? {});
      const tabId =
        typeof args.tabTarget === "number" ? args.tabTarget : undefined;

      // Opt-in refresh. Listing is side-effect-free by default so a caller
      // cannot accidentally make "check what is armed" perturb what is armed.
      if (args.refresh) {
        const targets = new Set(
          watchRegistry
            .list({ extensionId: args.extensionId })
            .map((w) => w.extensionId),
        );
        for (const ext of targets) {
          try {
            const res: any = await context.sendSocketMessage(
              "browser_watch_list_armed",
              {},
              { extensionId: ext },
            );
            const live = new Set(
              (res?.watches ?? [])
                .filter((w: any) => w.armed)
                .map((w: any) => w.watchId),
            );
            const now = Date.now();
            for (const rec of watchRegistry.list({ extensionId: ext })) {
              watchRegistry.recordArmed(rec.watchId, live.has(rec.watchId), now);
            }
          } catch {
            // Leave the stored answer alone. An unreachable extension is not
            // evidence that a watch is disarmed, and overwriting with false
            // here would be exactly the inference this field exists to prevent.
          }
        }
      }

      const rows = watchRegistry.list({
        extensionId: args.extensionId,
        ...(tabId !== undefined ? { tabId } : {}),
        agent: args.agent,
      });

      const cleared = watchRegistry.recentlyCleared({
        extensionId: args.extensionId,
        ...(tabId !== undefined ? { tabId } : {}),
        agent: args.agent,
      });

      // ⛔ "No watches" used to mean BOTH "you never armed one" and "yours was
      // cleared out from under you". Those are opposite situations and they
      // rendered identically, which during a live conversation looks exactly
      // like nothing happening (shopping-27, 2026-08-27).
      if (rows.length === 0) {
        let out = `No live watches.\n`;
        if (cleared.length > 0) {
          out += `\n⚠️ But ${cleared.length} watch(es) were CLEARED recently — this is not the same\n`;
          out += `as never having armed one:\n\n`;
          out += renderCleared(cleared);
        } else {
          out += `\nNo recently-cleared watches either.\n`;
        }
        out += `\n${restartNote()}`;
        return textResponse(out);
      }

      let out = `# Watches (${rows.length})\n\n`;
      for (const r of rows) {
        out += `**\`${r.watchId}\`** — \`${r.source}\`\n`;
        out += `- armed (per extension): ${renderArmed(r)}\n`;
        out += `- sink: ${r.sink.kind}`;
        if (r.sink.kind === "atc") out += ` → ${r.sink.to ?? r.agent ?? "?"}`;
        out += `\n`;
        out += `- extension: ${r.extensionId}${r.tabId != null ? `, tab ${r.tabId}` : ", browser-wide"}\n`;
        out += `- fired: ${r.firedCount}`;
        if (r.lastFiredAt) out += ` (last ${new Date(r.lastFiredAt).toISOString()})`;
        if (r.prefilteredCount) out += `, passed prefilter but not predicate: ${r.prefilteredCount}`;
        if (r.droppedCount) out += `, delivery failures: ${r.droppedCount}`;
        out += `\n`;
        if (r.predicate) out += `- predicate: \`${r.predicate}\`\n`;
        out += `\n`;
      }
      if (cleared.length > 0) {
        out += `\n## Recently cleared (${cleared.length})\n\n`;
        out += renderCleared(cleared);
      }

      out += `\n\`armed\` is the extension's own last answer, recorded verbatim. "unknown" means it\n`;
      out += `has never reported — which is not the same as false. Pass \`refresh: true\` to re-ask.\n`;
      out += `\n${restartNote()}`;
      return textResponse(out);
    } catch (e) {
      return errorResponse(`browser_watch_list failed: ${(e as Error)?.message ?? e}`);
    }
  }) as Tool["handle"],
};

export const watchDelete: Tool = {
  schema: {
    name: WatchDeleteTool.shape.name.value,
    description: WatchDeleteTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchDeleteTool.shape.arguments),
  },
  handle: (async (context, params) => {
    try {
      const args = WatchDeleteTool.shape.arguments.parse(params ?? {});
      const rec = watchRegistry.get(args.watchId);
      if (!rec) return errorResponse(explainMissing(args.watchId));

      let disarmNote = "";
      try {
        await context.sendSocketMessage(
          "browser_watch_disarm",
          { watchId: args.watchId },
          { extensionId: args.extensionId ?? rec.extensionId },
        );
      } catch (e) {
        // Still drop the server record — but say so, rather than reporting a
        // clean delete while the extension may still be firing.
        disarmNote =
          `\n⚠️ The extension did not confirm the disarm (${(e as Error)?.message ?? e}). ` +
          `The server record is gone, so any further events from it will be discarded and the ` +
          `extension told to disarm on the next one.\n`;
      }

      watchRegistry.delete(args.watchId);
      watchBuffer.drop(args.watchId);
      buffersLostToRestart.delete(args.watchId);
      await forgetWatch(args.watchId);
      return textResponse(`Deleted watch \`${args.watchId}\` (\`${rec.source}\`).${disarmNote}`);
    } catch (e) {
      return errorResponse(`browser_watch_delete failed: ${(e as Error)?.message ?? e}`);
    }
  }) as Tool["handle"],
};

export const watchPoll: Tool = {
  schema: {
    name: WatchPollTool.shape.name.value,
    description: WatchPollTool.shape.description.value,
    inputSchema: zodToJsonSchema(WatchPollTool.shape.arguments),
  },
  handle: (async (_context, params) => {
    try {
      const args = WatchPollTool.shape.arguments.parse(params ?? {});
      const rec = watchRegistry.get(args.watchId);
      if (!rec) return errorResponse(explainMissing(args.watchId));
      if (rec.sink.kind !== "buffer") {
        return errorResponse(
          `Watch "${args.watchId}" has a "${rec.sink.kind}" sink, so its events are delivered ` +
            `rather than buffered. Only a watch created with sink {kind:"buffer"} can be polled.`,
        );
      }

      const res = await watchBuffer.poll(args.watchId, args.timeoutMs ?? 15000);
      if (!res.matched) {
        // ⛔ An empty queue after a restart is NOT the same as a quiet page.
        const lost = buffersLostToRestart.has(args.watchId);
        return textResponse(
          `No events from \`${args.watchId}\` within ${res.timeoutMs}ms. ` +
            `This is an answer, not an error — poll again to keep waiting.` +
            (lost
              ? `\n\n⚠️ NOTE: this watch survived an mcp-server restart, but its BUFFER did not. ` +
                `Anything it captured before the restart is gone and will not be replayed. ` +
                `The watch itself is re-armed and will deliver new events normally.`
              : ""),
        );
      }
      // The caller has now drained at least once; the restart caveat no longer
      // applies to what they are seeing.
      buffersLostToRestart.delete(args.watchId);

      let out = `# ${res.events!.length} event(s) from \`${args.watchId}\`\n\n`;
      for (const ev of res.events!) {
        out += `**${new Date(ev.firedAt).toISOString()}** — \`${ev.source}\`\n`;
        if (ev.breakerTripped) {
          out += `⛔ WATCH DISARMED: ${ev.breakerTripped.reason} ` +
            `(${ev.breakerTripped.firedInWindow} fires against a cap of ${ev.breakerTripped.cap})\n`;
        }
        out += "```json\n" + JSON.stringify(ev.payload, null, 2).slice(0, 4000) + "\n```\n\n";
      }
      return textResponse(out);
    } catch (e) {
      return errorResponse(`browser_watch_poll failed: ${(e as Error)?.message ?? e}`);
    }
  }) as Tool["handle"],
};


const CLEARED_EXPLANATION: Record<string, string> = {
  deleted: "you deleted it",
  "tab-detached": "its tab detached or closed",
  "extension-disconnected":
    "its extension's WebSocket closed — note that an mcp-server restart closes every extension socket at once, so this can affect every watch in the fleet simultaneously",
  ttl: "its ttlMs elapsed",
  once: "it was created with once:true and has fired",
  breaker: "the rate-cap breaker tripped and disarmed it",
  "document-changed":
    "its tab navigated away from the document it was created against — re-arming would have attached your observer to a different page",
};

function renderCleared(cleared: WatchTombstone[]): string {
  let out = "";
  for (const t of cleared) {
    out += `- **\`${t.watchId}\`** \`${t.source}\` — cleared ${new Date(t.at).toISOString()}: `;
    out += `**${t.reason}** (${CLEARED_EXPLANATION[t.reason] ?? "reason not recorded"}), `;
    out += `after firing ${t.firedCount} time(s)\n`;
  }
  return out;
}

/**
 * The registry lives in memory, so a restart takes every watch with it and
 * leaves NO tombstone behind. Naming the process start time is the only honest
 * answer available for that case — a caller can see their watch predates this
 * server and stop looking for a reason that was never recorded.
 */
function restartNote(): string {
  const started = new Date(watchRegistry.startedAt).toISOString();
  return (
    `Watches are persisted and DO survive an mcp-server restart: subscriptions are reloaded and ` +
    `re-armed when each extension reconnects, arriving as \`armed: unknown\` until the extension ` +
    `confirms. ⚠️ What does NOT survive: buffered events (the queue starts empty and a poll says ` +
    `so), and any page watch whose tab navigated while the server was down — those are cleared as ` +
    `\`document-changed\` rather than re-armed onto a different document. This server started at ` +
    `${started}.\n`
  );
}

/** Explain a watchId that is not live, distinguishing cleared from never-existed. */
function explainMissing(watchId: string): string {
  const t = watchRegistry.tombstone(watchId);
  if (t) {
    return (
      `Watch \`${watchId}\` was CLEARED at ${new Date(t.at).toISOString()} — reason: ` +
      `**${t.reason}** (${CLEARED_EXPLANATION[t.reason] ?? "reason not recorded"}). ` +
      `It fired ${t.firedCount} time(s) before that. It is not armed and will deliver nothing; ` +
      `re-create it with browser_watch_create.`
    );
  }
  return (
    `No watch with id "${watchId}", and no record of one having been cleared — ` +
    `it was never created here, or it was cleared long enough ago that its tombstone aged out.\n\n` +
    `${restartNote()}`
  );
}
