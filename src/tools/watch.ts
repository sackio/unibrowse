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
import { watchBuffer, watchRegistry } from "@/watch/service";
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
          sink,
          options: args.options,
          tabId,
          extensionId,
          agent: args.agent,
        },
        descriptor.home,
      );

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
      out += `**predicate**: ${record.predicate ? `\`${record.predicate}\`` : "none — fires on every event"}\n\n`;
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

      if (rows.length === 0) return textResponse(`No watches.`);

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
      out += `\n\`armed\` is the extension's own last answer, recorded verbatim. "unknown" means it\n`;
      out += `has never reported — which is not the same as false. Pass \`refresh: true\` to re-ask.\n`;
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
      if (!rec) return errorResponse(`No watch with id "${args.watchId}".`);

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
      if (!rec) return errorResponse(`No watch with id "${args.watchId}".`);
      if (rec.sink.kind !== "buffer") {
        return errorResponse(
          `Watch "${args.watchId}" has a "${rec.sink.kind}" sink, so its events are delivered ` +
            `rather than buffered. Only a watch created with sink {kind:"buffer"} can be polled.`,
        );
      }

      const res = await watchBuffer.poll(args.watchId, args.timeoutMs ?? 15000);
      if (!res.matched) {
        return textResponse(
          `No events from \`${args.watchId}\` within ${res.timeoutMs}ms. ` +
            `This is an answer, not an error — poll again to keep waiting.`,
        );
      }

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
