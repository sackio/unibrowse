/**
 * Watch — the process-wide service.
 *
 * Holds the one registry, buffer and sink dispatcher, and owns the reactions
 * to extension lifecycle events. Both src/server.ts (WebSocket ingress) and
 * src/tools/watch.ts (MCP tools) talk to this, so there is exactly one
 * authoritative registry per process.
 */

import { WatchBuffer } from "./buffer.ts";
import { WatchRegistry } from "./registry.ts";
import { createSinkDispatcher } from "./sinks.ts";
import type { WatchEvent, WatchRecord } from "./types.ts";

/**
 * ⛔ LITERAL host, not `$ATC_URL`. That variable is unset in several execution
 * contexts and the resulting failure reads exactly like "nothing armed" —
 * which for a push system is the worst possible way to fail.
 * Override with UNIBROWSE_ATC_URL if the broker ever moves.
 */
const DEFAULT_ATC_URL = "http://192.168.1.168:3030";

export const watchRegistry = new WatchRegistry();
export const watchBuffer = new WatchBuffer();

const dispatcher = createSinkDispatcher({
  fetchImpl: ((url: string, init: any) => fetch(url, init)) as any,
  buffer: watchBuffer,
  atcUrl: process.env.UNIBROWSE_ATC_URL || DEFAULT_ATC_URL,
});

/** Timer that reaps ttl-expired watches. Started by startWatchExpiry(). */
let expiryTimer: NodeJS.Timeout | null = null;

/**
 * Handle a WATCH_FIRED message from an extension.
 *
 * @param disarmInExtension called when the server has no record of the watch —
 *   the extension is holding a leak the server cannot otherwise clear.
 */
export async function handleWatchFired(
  payload: Record<string, unknown>,
  disarmInExtension: (watchId: string) => void,
): Promise<void> {
  const watchId = String(payload?.watchId ?? "");
  if (!watchId) return;

  const record = watchRegistry.get(watchId);
  if (!record) {
    // Drift: the extension is armed for something the server has forgotten.
    // Tell it to stop rather than silently discarding events forever — an
    // orphaned watch is a slow leak that nothing else would ever surface.
    console.log(`[Watch] WATCH_FIRED for unknown watch ${watchId}; disarming in extension`);
    try {
      disarmInExtension(watchId);
    } catch {
      /* best-effort */
    }
    return;
  }

  const event: WatchEvent = {
    watchId,
    source: String(payload.source ?? record.source),
    firedAt: Number(payload.firedAt ?? Date.now()),
    payload: payload.payload,
    breakerTripped: payload.breakerTripped as WatchEvent["breakerTripped"],
  };

  watchRegistry.recordFired(watchId, event.firedAt);

  const result = await dispatcher.deliver(record, event);
  if (!result.ok) {
    watchRegistry.recordDropped(watchId);
    console.log(
      `[Watch] delivery failed for ${watchId} via ${result.sink}: ${result.detail ?? "unknown"}`,
    );
  }

  // The breaker already disarmed this watch in the extension; drop the
  // server's record so browser_watch_list stops advertising it.
  if (event.breakerTripped) {
    watchRegistry.delete(watchId);
    watchBuffer.drop(watchId);
    return;
  }

  if (record.options?.once) {
    watchRegistry.delete(watchId);
    // The buffer is NOT dropped here: a once-watch's whole point is that
    // somebody polls for the single event, and they may not have polled yet.
  }
}

/** Deliver an event straight to a sink, bypassing the extension. Used by tests. */
export async function deliverForTest(record: WatchRecord, event: WatchEvent) {
  return dispatcher.deliver(record, event);
}

/** Cascade: a tab detached or closed. */
export function onTabGone(extensionId: string, tabId: number): string[] {
  const removed = watchRegistry.deleteByTab(extensionId, tabId);
  for (const id of removed) watchBuffer.drop(id);
  if (removed.length > 0) {
    console.log(`[Watch] tab ${tabId} gone: cleared ${removed.length} watch(es)`);
  }
  return removed;
}

/** Cascade: an extension disconnected. */
export function onExtensionGone(extensionId: string): string[] {
  const removed = watchRegistry.deleteByExtension(extensionId);
  for (const id of removed) watchBuffer.drop(id);
  if (removed.length > 0) {
    console.log(`[Watch] extension ${extensionId} gone: cleared ${removed.length} watch(es)`);
  }
  return removed;
}

/**
 * The specs to re-push when an extension registers.
 *
 * This is the same repair `6e8a186` performs for tab ownership, and it has the
 * same useful property: it fixes drift that predates its own deploy, because
 * it runs against whatever the extension is currently holding.
 */
export function specsToRearm(extensionId: string) {
  return watchRegistry.specsFor(extensionId).map((w) => ({
    watchId: w.watchId,
    source: w.source,
    predicate: w.predicate,
    options: w.options,
    tabId: w.tabId ?? null,
    extensionId: w.extensionId,
  }));
}

/** Reap ttl-expired watches on an interval. */
export function startWatchExpiry(intervalMs = 30_000): void {
  if (expiryTimer) return;
  expiryTimer = setInterval(() => {
    const removed = watchRegistry.expire(Date.now());
    for (const id of removed) watchBuffer.drop(id);
    if (removed.length > 0) console.log(`[Watch] expired ${removed.length} watch(es)`);
  }, intervalMs);
  // Do not hold the process open for this.
  if (typeof expiryTimer.unref === "function") expiryTimer.unref();
}

export function stopWatchExpiry(): void {
  if (!expiryTimer) return;
  clearInterval(expiryTimer);
  expiryTimer = null;
}
