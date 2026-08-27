/**
 * Watch — shared types for the browser push/observation subsystem.
 *
 * Design: docs/WATCH_DESIGN.md. Plan: docs/WATCH_PLAN.md.
 *
 * Types only, no logic, so both the server and the tool layer can import
 * these without pulling in the registry or the sinks.
 */

export type WatchHome = "worker" | "page" | "server";

export interface SourceDescriptor {
  /** Namespaced id, e.g. "cdp.Network.eventSourceMessageReceived". The prefix
   *  determines the execution home; the caller never has to know that. */
  id: string;
  home: WatchHome;
  /** FREE = the stream already flows in unibrowse today.
   *  GRANTED = permission is already in manifest.json, listener not yet written.
   *  Nothing NEEDS_PERM ships in Phase 1 — a permission change forces a
   *  pool-wide extension RE-INSTALL, not a reload. */
  permission: "FREE" | "GRANTED";
  /**
   * The exact shape the predicate is handed. This is the field that stops the
   * differing-sandbox problem from becoming the confusing part of the system:
   * a cdp.* predicate gets the CDP event object and no DOM, a unibrowse.*
   * predicate gets the internal event record. Callers read this, not the docs.
   */
  predicateArg: string;
  /** Rough event volume, so a caller can see a firehose BEFORE arming one. */
  cost: "low" | "medium" | "high";
  description: string;
  /** Whether the source is scoped to one tab or is browser-wide. Decides
   *  which cascade delete removes it. */
  scope: "tab" | "browser";
}

export type SinkSpec =
  | {
      kind: "atc";
      /** Defaults to the CALLING AGENT. See sinks.ts — it never guesses. */
      to?: string;
      subject?: string;
      priority?: "info" | "warning" | "critical";
    }
  | { kind: "webhook"; url: string; headers?: Record<string, string> }
  | { kind: "buffer"; maxBuffered?: number };

export interface CoalesceSpec {
  windowMs: number;
  /** last  = deliver only the newest event in the window
   *  batch = deliver every held event, in arrival order
   *  count = deliver a single {count} summary */
  mode: "last" | "batch" | "count";
}

export interface WatchOptions {
  once?: boolean;
  ttlMs?: number;
  coalesce?: CoalesceSpec;
  maxPerMin?: number;
}

export interface WatchSpec {
  source: string;
  /**
   * Declarative, eval-free matcher applied IN THE EXTENSION, so a chatty
   * source is narrowed before anything crosses the WebSocket. Optional, but
   * strongly wanted on high-volume sources. See extension/watch-prefilter.js.
   */
  prefilter?: unknown;
  /** Arbitrary JS. Omitted = fire on every event from the source.
   *  ⛔ Admin-trust code — see the security section of WATCH_DESIGN.md. */
  predicate?: string;
  sink: SinkSpec;
  options?: WatchOptions;
  /** null for a browser-wide source. */
  tabId?: number | null;
  extensionId: string;
  /** Caller identity, as used elsewhere in this codebase for tab
   *  reservations. The atc sink delivers here by default. */
  agent?: string;
}

export interface WatchRecord extends WatchSpec {
  watchId: string;
  home: WatchHome;
  createdAt: number;
  firedCount: number;
  /** Delivery failures — the sink refused or was unreachable. */
  droppedCount: number;
  /**
   * Events that passed the extension's cheap prefilter but not the caller's
   * server-side predicate. Distinct from droppedCount: this one says "your
   * prefilter is looser than your predicate", which is normal and sometimes
   * worth tightening, not a failure.
   */
  prefilteredCount: number;
  lastFiredAt: number | null;
  /**
   * ⛔ THE EXTENSION'S RAW ANSWER — never inferred from server state, and
   * never repaired on read.
   *
   * null means "the extension has not told us", which is a DIFFERENT thing
   * from false. browser_list_attached_tabs learned this the hard way with
   * `isActive`: repairing the state you publish hides the condition being
   * published, and an external consumer (claude-login-auto, owned by `agents`)
   * depends on the raw value. See memo 9fb367c0.
   */
  armedReportedByExtension: boolean | null;
  armedReportedAt: number | null;
}

export interface WatchEvent {
  watchId: string;
  source: string;
  firedAt: number;
  payload: unknown;
  /**
   * Set when the circuit breaker disarmed the watch. This event is ALWAYS
   * delivered: a watch that stops silently is indistinguishable from a quiet
   * page, which is the failure this whole subsystem exists to remove.
   */
  breakerTripped?: { reason: string; firedInWindow: number; cap: number };
}
