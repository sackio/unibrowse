/**
 * Watch — sink dispatch.
 *
 * ⛔ THE ONLY PLACE IN THIS SUBSYSTEM THAT MAKES AN OUTBOUND REQUEST, and it
 * runs on the server. The extension never holds a webhook credential and never
 * calls a third party: it holds every live cookie and session in the pool, and
 * the server is already the identity and auth plane (src/utils/auth.ts, memo
 * 33ff3f8b).
 *
 * `fetchImpl` is injected so the ATC contract is testable without messaging
 * the live broker.
 */

import type { WatchBuffer } from "./buffer.ts";
import type { WatchEvent, WatchRecord } from "./types.ts";

export interface DeliveryResult {
  ok: boolean;
  sink: string;
  detail?: string;
}

/** Minimal shape we need from fetch — keeps the injected stub small. */
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text?: () => Promise<string> }>;

export interface SinkDispatcherOpts {
  fetchImpl: FetchLike;
  buffer: WatchBuffer;
  /**
   * ⛔ The LITERAL broker host. `$ATC_URL` is unset in several execution
   * contexts, and a bare `curl "$ATC_URL/..."` fails in a way that reads
   * exactly like "nothing armed".
   */
  atcUrl: string;
  /** Who the broker sees as the sender. */
  atcFrom?: string;
}

/**
 * ⛔ MUST BE A REGISTERED ATC SUBSCRIBER.
 *
 * This was "unibrowse-watch", which is not in the registry: recipients could
 * receive a watch event but not reply to it — atc_reply returned sent:0 with
 * drop_reason "no_resolution", so an ack or a "stop sending me this" went
 * nowhere. Reported by `shopping` 2026-08-27 after their sink probe arrived
 * intact and the reply path did not.
 *
 * `unibrowse` is the seat that owns this subsystem, so a reply reaches
 * somebody who can actually disarm the watch.
 */
const DEFAULT_ATC_FROM = "unibrowse";

/** A compact, human-readable summary plus the raw payload. */
function renderContent(record: WatchRecord, event: WatchEvent): string {
  const head = event.breakerTripped
    ? `⛔ WATCH DISARMED — ${event.breakerTripped.reason}\n` +
      `watch ${record.watchId} on ${record.source} fired ` +
      `${event.breakerTripped.firedInWindow} times in one minute against a cap of ` +
      `${event.breakerTripped.cap}. It is no longer armed; re-create it with a ` +
      `narrower predicate or a higher maxPerMin.`
    : `watch ${record.watchId} fired — ${record.source}` +
      (record.tabId != null ? ` (tab ${record.tabId})` : "");

  let payload: string;
  try {
    payload = JSON.stringify(event.payload, null, 2);
  } catch {
    payload = String(event.payload);
  }
  // Keep a runaway payload from becoming a runaway message.
  if (payload.length > 4000) payload = payload.slice(0, 4000) + "\n… truncated";

  // A one-way notification that does not say how to stop it is a nuisance the
  // recipient cannot end. Replies reach `unibrowse` (see DEFAULT_ATC_FROM).
  const foot = event.breakerTripped
    ? ""
    : `\n\nStop this watch: browser_watch_delete({watchId: "${record.watchId}"}) — or reply to this message.`;

  return `${head}\n\n${payload}${foot}`;
}

export function createSinkDispatcher(opts: SinkDispatcherOpts) {
  const { fetchImpl, buffer, atcUrl, atcFrom = DEFAULT_ATC_FROM } = opts;

  async function post(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
    sink = "webhook",
  ): Promise<DeliveryResult> {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        if (res.text) {
          try {
            const t = await res.text();
            if (t) detail += `: ${t.slice(0, 200)}`;
          } catch {
            /* the status alone is enough */
          }
        }
        return { ok: false, sink, detail };
      }
      return { ok: true, sink };
    } catch (e) {
      return { ok: false, sink, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    async deliver(record: WatchRecord, event: WatchEvent): Promise<DeliveryResult> {
      const sink = record.sink;

      if (sink.kind === "buffer") {
        // A breaker event must reach a poller too, not only a push sink.
        buffer.push(record.watchId, event);
        return { ok: true, sink: "buffer" };
      }

      if (sink.kind === "webhook") {
        return post(
          sink.url,
          {
            watchId: record.watchId,
            source: record.source,
            tabId: record.tabId,
            extensionId: record.extensionId,
            firedAt: event.firedAt,
            payload: event.payload,
            breakerTripped: event.breakerTripped,
          },
          sink.headers ?? {},
          "webhook",
        );
      }

      // atc
      const to = sink.to ?? record.agent;
      if (!to) {
        // ⛔ NEVER guess a recipient. A watch delivered to the wrong seat is
        // worse than one that fails visibly, and the caller can fix this in
        // one edit once they are told which field is missing.
        return {
          ok: false,
          sink: "atc",
          detail:
            `atc sink has no recipient: sink.to was not set and the watch has no \`agent\`. ` +
            `Pass \`agent\` when creating the watch so events reach your own session, ` +
            `or set sink.to explicitly.`,
        };
      }

      return post(
        `${atcUrl}/messages`,
        {
          to,
          from: atcFrom,
          subject: sink.subject ?? `watch ${record.source}`,
          content: renderContent(record, event),
          priority: event.breakerTripped ? "warning" : (sink.priority ?? "info"),
        },
        {},
        "atc",
      );
    },
  };
}
