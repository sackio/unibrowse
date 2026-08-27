/**
 * Watch — the process-wide service.
 *
 * Holds the one registry, buffer and sink dispatcher, and owns the reactions
 * to extension lifecycle events. Both src/server.ts (WebSocket ingress) and
 * src/tools/watch.ts (MCP tools) talk to this, so there is exactly one
 * authoritative registry per process.
 */

import { mongodb } from "@/utils/mongodb";

import { WatchBuffer } from "./buffer.ts";
import { planRehydration, toPersisted } from "./persistence.ts";
import { compilePredicate } from "./predicate.ts";
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
 * Watches whose buffers were lost to a restart, so browser_watch_poll can say
 * so instead of returning an empty queue a caller cannot interpret.
 */
export const buffersLostToRestart = new Set<string>();

/** Page-home watches awaiting a URL check before re-arming. watchId -> url. */
export const pendingUrlVerification = new Map<string, string>();

/**
 * Persist a subscription. Best-effort: a Mongo failure must never break a
 * working watch, it only costs durability across the next restart.
 */
export async function persistWatch(rec: any): Promise<void> {
  try {
    // Connect lazily, as every other Mongo consumer in this codebase does.
    // ⚠️ Checking isConnected() alone silently no-ops forever: nothing connects
    // eagerly at startup, so a bare check means NOTHING is ever persisted and
    // the failure is invisible until a restart loses everything.
    if (!mongodb.isConnected()) await mongodb.connect();
    await mongodb
      .getWatchesCollection()
      .updateOne({ watchId: rec.watchId }, { $set: toPersisted(rec) }, { upsert: true });
  } catch (e) {
    console.log(`[Watch] persist failed for ${rec.watchId} (non-fatal): ${(e as Error)?.message}`);
  }
}

async function unpersistWatch(watchId: string): Promise<void> {
  try {
    if (!mongodb.isConnected()) return; // nothing was persisted either
    await mongodb.getWatchesCollection().deleteOne({ watchId });
  } catch (e) {
    console.log(`[Watch] unpersist failed for ${watchId} (non-fatal): ${(e as Error)?.message}`);
  }
}

/** Forget several at once, after a cascade. */
async function unpersistMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    if (!mongodb.isConnected()) return;
    await mongodb.getWatchesCollection().deleteMany({ watchId: { $in: ids } });
  } catch (e) {
    console.log(`[Watch] bulk unpersist failed (non-fatal): ${(e as Error)?.message}`);
  }
}

/**
 * Load persisted subscriptions back into the registry after a restart.
 *
 * ⛔ Everything loaded is marked armed:unknown. Nothing here contacts a
 * browser — the existing re-push on EXTENSION_REGISTER does that, and the
 * extension's own answer is what makes a watch armed.
 */
export async function rehydrateWatches(): Promise<void> {
  try {
    if (!mongodb.isConnected()) await mongodb.connect();
    if (!mongodb.isConnected()) {
      console.log("[Watch] no MongoDB connection; watches did NOT survive this restart");
      return;
    }
    const rows = await mongodb.getWatchesCollection().find({}).toArray();
    if (rows.length === 0) return;

    const plan = planRehydration(rows, Date.now());

    for (const c of plan.rehydrate) {
      if (c.requiresUrl) (c.record as any).armedAgainstUrl = c.requiresUrl;
      watchRegistry.restore(c.record);
      if (c.requiresUrl) pendingUrlVerification.set(c.watchId, c.requiresUrl);
    }
    console.log(
      `[Watch] ${pendingUrlVerification.size} page watch(es) pending URL verification before re-arm`,
    );
    for (const id of plan.lostBuffers) buffersLostToRestart.add(id);

    if (plan.drop.length > 0) {
      await unpersistMany(plan.drop.map((d) => d.watchId));
    }

    console.log(
      `[Watch] rehydrated ${plan.rehydrate.length} watch(es) as armed:unknown` +
        `${plan.drop.length ? `, dropped ${plan.drop.length} (${plan.drop.map((d) => d.reason).join(",")})` : ""}` +
        `${plan.lostBuffers.length ? `, ${plan.lostBuffers.length} buffer(s) lost` : ""}` +
        `${plan.malformed ? `, ⚠️ ${plan.malformed} MALFORMED row(s) skipped` : ""}`,
    );
  } catch (e) {
    console.log(`[Watch] rehydration failed (non-fatal): ${(e as Error)?.message}`);
  }
}

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

  // ⛔ THE PREDICATE RUNS HERE, not in the extension — MV3's CSP forbids
  // evaluating a string as JS in a service worker. The extension applied only
  // the cheap declarative prefilter, so this event has passed a coarse test,
  // not the caller's actual condition.
  //
  // A breaker notice bypasses the predicate deliberately: it is the watch
  // reporting its own death, and a predicate that does not match it would
  // suppress exactly the message the caller most needs.
  //
  // Page-home watches also bypass it — their predicate already ran inside the
  // document, which is the only place its DOM references resolve.
  if (!event.breakerTripped && record.home !== "page") {
    let matched: boolean;
    try {
      matched = compilePredicate(record.predicate)(event.payload);
    } catch {
      matched = false;
    }
    if (!matched) {
      // Not a delivery failure — a non-match. Counted so a caller can tell
      // "my prefilter is too loose" from "nothing is happening".
      watchRegistry.recordPrefiltered(watchId);
      return;
    }
  }

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
    watchRegistry.delete(watchId, "breaker");
    watchBuffer.drop(watchId);
    void unpersistWatch(watchId);
    return;
  }

  if (record.options?.once) {
    watchRegistry.delete(watchId, "once");
    void unpersistWatch(watchId);
    // The buffer is NOT dropped here: a once-watch's whole point is that
    // somebody polls for the single event, and they may not have polled yet.
  }
}

/**
 * The extension reports that it refused to re-inject a page watch because the
 * tab no longer shows the document the watch was created against.
 *
 * ⛔ This is the LIVE-navigation case, and it is far more common than a
 * restart. Found by shopping-27, 2026-08-27: a dom.* watch created against an
 * order page silently re-attached to a contact-us page and kept firing, same
 * watchId, still reporting armed:true.
 */
export function onWatchDocumentChanged(
  watchId: string,
  detail: { was?: string; now?: string },
): void {
  const rec = watchRegistry.get(watchId);
  if (!rec) return;
  watchRegistry.delete(watchId, "document-changed");
  watchBuffer.drop(watchId);
  void unpersistWatch(watchId);
  console.log(
    `[Watch] ${watchId} cleared as document-changed: was ${detail.was ?? "?"}, now ${detail.now ?? "?"}`,
  );
}

/** Deliver an event straight to a sink, bypassing the extension. Used by tests. */
export async function deliverForTest(record: WatchRecord, event: WatchEvent) {
  return dispatcher.deliver(record, event);
}

/** Cascade: a tab detached or closed. */
export function onTabGone(extensionId: string, tabId: number): string[] {
  const removed = watchRegistry.deleteByTab(extensionId, tabId);
  for (const id of removed) watchBuffer.drop(id);
  void unpersistMany(removed);
  if (removed.length > 0) {
    console.log(`[Watch] tab ${tabId} gone: cleared ${removed.length} watch(es)`);
  }
  return removed;
}

/** Cascade: an extension disconnected. */
export function onExtensionGone(extensionId: string): string[] {
  const removed = watchRegistry.deleteByExtension(extensionId);
  for (const id of removed) watchBuffer.drop(id);
  // ⛔ DELIBERATELY NOT unpersisted. A server restart closes every extension
  // socket, so treating a disconnect as "forget this watch forever" would
  // erase, on the way down, exactly the subscriptions this feature exists to
  // bring back. The persisted copy outlives the socket; rehydration decides.
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
/**
 * Re-arm one extension's watches, verifying page-home ones first.
 *
 * ⛔ A page watch is armed against a DOCUMENT, not a tab. After a restart the
 * tab id still resolves even if the page navigated, so a naive re-arm would
 * succeed, inject into a different page, and start reporting matches from
 * somewhere the caller never asked about — silently. Verifying the URL is what
 * turns that into an explicit `document-changed` clear.
 *
 * @param listTabs fetches the extension's attached tabs (injected so this is
 *   testable and so service.ts does not reach into the socket layer).
 */
export async function rearmForExtension(
  extensionId: string,
  liveUrlOf: (tabId: number) => Promise<string | undefined>,
): Promise<{ specs: any[]; dropped: Array<{ watchId: string; reason: string }> }> {
  const specs = specsToRearm(extensionId);
  const dropped: Array<{ watchId: string; reason: string }> = [];

  const needsCheck = specs.filter((s) => pendingUrlVerification.has(s.watchId));
  if (needsCheck.length === 0) return { specs, dropped };

  const survivors: any[] = [];
  for (const s of specs) {
    const wanted = pendingUrlVerification.get(s.watchId);
    if (!wanted) {
      survivors.push(s);
      continue;
    }
    pendingUrlVerification.delete(s.watchId);

    // ⛔ THE LIVE URL, NOT THE TAB RECORD.
    //
    // browser_list_attached_tabs reports the URL captured when the tab was
    // ATTACHED and never updates it on navigation. Verifying against it
    // compared two copies of the same stale value, so this guard could never
    // detect the very thing it exists to detect — it passed a test where the
    // tab had demonstrably navigated (shopping-27, 2026-08-27). Ask the page.
    let actual: string | undefined;
    try {
      actual = s.tabId != null ? await liveUrlOf(s.tabId) : undefined;
    } catch {
      actual = undefined; // tab gone, or unreachable — treated as changed
    }

    if (typeof actual === "string" && actual === wanted) {
      survivors.push(s);
      continue;
    }

    watchRegistry.delete(s.watchId, "document-changed");
    watchBuffer.drop(s.watchId);
    void unpersistWatch(s.watchId);
    dropped.push({ watchId: s.watchId, reason: "document-changed" });
    console.log(
      `[Watch] ${s.watchId} NOT re-armed: created against ${wanted}, tab ${s.tabId} now shows ${actual ?? "(unreachable/gone)"}`,
    );
  }
  return { specs: survivors, dropped };
}

/**
 * Ask an extension which watches it is actually holding, and record the answer.
 *
 * ⛔ The answer is stored VERBATIM. This is the only thing that may set
 * `armed` — never the server's own intention, and never an inference from a
 * successful send.
 */
export async function recordArmedFromExtension(
  extensionId: string,
  listArmed: () => Promise<Array<{ watchId: string; armed: boolean }>>,
): Promise<void> {
  try {
    const rows = await listArmed();
    const live = new Set(rows.filter((r) => r.armed).map((r) => r.watchId));
    const now = Date.now();
    for (const rec of watchRegistry.list({ extensionId })) {
      watchRegistry.recordArmed(rec.watchId, live.has(rec.watchId), now);
    }
    console.log(`[Watch] ${extensionId} confirms ${live.size} watch(es) armed`);
  } catch (e) {
    // Leave the stored answer alone. An unreachable extension is not evidence
    // that a watch is disarmed, and writing false here would be exactly the
    // inference this field exists to prevent.
    console.log(`[Watch] armed-state confirmation for ${extensionId} failed (non-fatal): ${(e as Error)?.message}`);
  }
}

export function specsToRearm(extensionId: string) {
  return watchRegistry.specsFor(extensionId).map((w) => ({
    watchId: w.watchId,
    source: w.source,
    // The prefilter is what the extension applies; the predicate stays here.
    // A page-home watch is the exception — its predicate is injected into the
    // document, so it must travel.
    prefilter: w.prefilter,
    predicate: w.home === "page" ? w.predicate : undefined,
    config: w.config,
    // The document a page watch belongs to. The extension re-injects on every
    // navigation of that tab, and without this it would attach to whatever
    // page is now there — the live-navigation twin of the restart case.
    armedAgainstUrl: (w as any).armedAgainstUrl,
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
    void unpersistMany(removed);
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


/** Explicit delete from the tool layer, including the durable copy. */
export async function forgetWatch(watchId: string): Promise<void> {
  await unpersistWatch(watchId);
}
