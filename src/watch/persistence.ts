/**
 * Watch — surviving an mcp-server restart.
 *
 * ⛔ WHAT IS PERSISTED, AND WHAT DELIBERATELY IS NOT.
 *
 * Ben's original ruling stands: events are fire-and-forget — no queue, no
 * outbox, no replay. That is what keeps this subsystem small, and persistence
 * does not reopen it. What survives is the SUBSCRIPTION: a standing intention
 * with no size bound and no ordering problem. What does not survive is the
 * EVENT: unbounded state that goes stale the moment the page moves on.
 *
 * ⛔ AND A REHYDRATED WATCH IS NEVER `armed`.
 *
 * A restart closes every extension socket, so on load the server has not
 * spoken to any browser. Reporting those watches as armed would be the server
 * asserting something about a browser it has not contacted — the same
 * false-success shape as an empty error read as success, and worse here,
 * because a caller would be relying on a doorbell nobody had reconnected.
 *
 * So rehydration is two-phase:
 *   1. specs come back from Mongo marked `armedReportedByExtension: null`
 *   2. the EXISTING re-push on EXTENSION_REGISTER arms them, and the
 *      extension's own answer is what sets armed
 *
 * That second phase is not new machinery — it is what already recovers a watch
 * after Chrome evicts a service worker. A restart is the same problem with a
 * wider blast radius.
 */

import type { ClearedReason, WatchRecord } from "./types.ts";

/** The shape stored in Mongo. */
export interface PersistedWatch {
  watchId: string;
  source: string;
  home: string;
  extensionId: string;
  tabId?: number | null;
  agent?: string;
  predicate?: string;
  prefilter?: unknown;
  config?: Record<string, unknown>;
  sink: unknown;
  options?: Record<string, unknown>;
  createdAt: number;
  /**
   * ⛔ For page-home watches only: the URL the watch was armed against.
   *
   * A page watch observes a DOCUMENT, not a tab. If the server is down while
   * the tab navigates, the tab id still resolves — so a naive re-arm would
   * succeed, inject into a completely different page, and report matches from
   * somewhere the caller never asked about, with nothing erroring. The URL is
   * what makes that detectable.
   */
  armedAgainstUrl?: string;
  /** Set when a `once` watch has already delivered; it must not come back. */
  firedBeforeShutdown?: boolean;
}

export interface RehydrationCandidate {
  watchId: string;
  record: WatchRecord;
  /** When set, re-arm ONLY if the tab currently shows this URL. */
  requiresUrl?: string;
}

export interface RehydrationPlan {
  rehydrate: RehydrationCandidate[];
  drop: Array<{ watchId: string; reason: ClearedReason }>;
  /** Buffer-sink watches whose queue did not survive; callers are told. */
  lostBuffers: string[];
  /** Rows that could not be understood. COUNTED, never silently skipped. */
  malformed: number;
}

export function toPersisted(rec: WatchRecord & { armedAgainstUrl?: string }): PersistedWatch {
  return {
    watchId: rec.watchId,
    source: rec.source,
    home: rec.home,
    extensionId: rec.extensionId,
    tabId: rec.tabId ?? null,
    agent: rec.agent,
    predicate: rec.predicate,
    prefilter: rec.prefilter,
    config: rec.config,
    sink: rec.sink,
    options: rec.options as Record<string, unknown> | undefined,
    createdAt: rec.createdAt,
    armedAgainstUrl: rec.armedAgainstUrl,
    firedBeforeShutdown: Boolean(rec.options?.once && rec.firedCount > 0),
  };
}

export function fromPersisted(p: PersistedWatch): WatchRecord {
  return {
    watchId: p.watchId,
    source: p.source,
    home: p.home as WatchRecord["home"],
    extensionId: p.extensionId,
    tabId: p.tabId ?? null,
    agent: p.agent,
    predicate: p.predicate,
    prefilter: p.prefilter,
    config: p.config,
    sink: p.sink as WatchRecord["sink"],
    options: p.options as WatchRecord["options"],
    createdAt: p.createdAt,
    // ⛔ Counters described a process that no longer exists. Carrying them over
    // would make a fresh server claim a history it did not observe.
    firedCount: 0,
    droppedCount: 0,
    prefilteredCount: 0,
    lastFiredAt: null,
    // ⛔ The load-bearing line of this file. See the header.
    armedReportedByExtension: null,
    armedReportedAt: null,
  };
}

function looksLikeAWatch(p: any): p is PersistedWatch {
  return (
    p != null &&
    typeof p === "object" &&
    typeof p.watchId === "string" &&
    typeof p.source === "string" &&
    typeof p.extensionId === "string" &&
    typeof p.createdAt === "number" &&
    p.sink != null
  );
}

/**
 * Decide what comes back, what is dropped, and what the caller must be told.
 * Pure — the I/O lives in service.ts, so the decisions are testable.
 */
export function planRehydration(rows: unknown[], now: number): RehydrationPlan {
  const plan: RehydrationPlan = { rehydrate: [], drop: [], lostBuffers: [], malformed: 0 };

  for (const row of rows) {
    if (!looksLikeAWatch(row)) {
      plan.malformed += 1;
      continue;
    }

    // A once-watch that already delivered must not be resurrected — it would
    // fire a second time for an event the caller already handled.
    if (row.firedBeforeShutdown) {
      plan.drop.push({ watchId: row.watchId, reason: "once" });
      continue;
    }

    // TTL keeps running while the server is down; a watch whose deadline
    // passed in the gap never legitimately existed at load time.
    const ttl = (row.options as any)?.ttlMs;
    if (typeof ttl === "number" && now - row.createdAt >= ttl) {
      plan.drop.push({ watchId: row.watchId, reason: "ttl" });
      continue;
    }

    const record = fromPersisted(row);
    plan.rehydrate.push({
      watchId: row.watchId,
      record,
      // Page-home watches are conditional on the document still being there.
      requiresUrl: row.home === "page" ? row.armedAgainstUrl : undefined,
    });

    if ((row.sink as any)?.kind === "buffer") plan.lostBuffers.push(row.watchId);
  }

  return plan;
}
