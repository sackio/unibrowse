/**
 * Watch — the authoritative registry.
 *
 * Pure logic, no I/O, so lifetime transitions are unit-testable without a
 * browser or a broker. The server holds one instance; the extension holds its
 * own arming state, and the two are reconciled by re-push on
 * EXTENSION_REGISTER rather than by either trusting the other.
 */

import type { ClearedReason, WatchHome, WatchRecord, WatchSpec, WatchTombstone } from "./types.ts";

export interface ListFilter {
  extensionId?: string;
  tabId?: number | null;
  agent?: string;
}

const MAX_TOMBSTONES = 50;

export class WatchRegistry {
  private watches = new Map<string, WatchRecord>();
  /**
   * Recently-cleared watches, newest last. Bounded — this is an explanation
   * buffer, not a history.
   */
  private tombstones = new Map<string, WatchTombstone>();
  /**
   * When THIS registry came into being. The registry is in memory, so an
   * mcp-server restart takes every watch with it and leaves no tombstone to
   * find. Exposing the start time lets a caller work out that their watch was
   * created before this process existed, which is the only honest answer
   * available for that case.
   */
  readonly startedAt = Date.now();
  /** extensionId -> watchIds. Kept in sync on every create/delete. */
  private byExtension = new Map<string, Set<string>>();
  /** `${extensionId}:${tabId}` -> watchIds, for the tab-detach cascade. */
  private byExtensionTab = new Map<string, Set<string>>();
  private counter = 0;

  /** Deterministic ids — no Math.random, so tests are reproducible. */
  private nextId(): string {
    this.counter += 1;
    return `w-${Date.now().toString(36)}-${this.counter}`;
  }

  private tabKey(extensionId: string, tabId: number): string {
    return `${extensionId}:${tabId}`;
  }

  private index(rec: WatchRecord): void {
    let ext = this.byExtension.get(rec.extensionId);
    if (!ext) {
      ext = new Set();
      this.byExtension.set(rec.extensionId, ext);
    }
    ext.add(rec.watchId);

    if (rec.tabId != null) {
      const key = this.tabKey(rec.extensionId, rec.tabId);
      let tab = this.byExtensionTab.get(key);
      if (!tab) {
        tab = new Set();
        this.byExtensionTab.set(key, tab);
      }
      tab.add(rec.watchId);
    }
  }

  private deindex(rec: WatchRecord): void {
    const ext = this.byExtension.get(rec.extensionId);
    if (ext) {
      ext.delete(rec.watchId);
      if (ext.size === 0) this.byExtension.delete(rec.extensionId);
    }
    if (rec.tabId != null) {
      const key = this.tabKey(rec.extensionId, rec.tabId);
      const tab = this.byExtensionTab.get(key);
      if (tab) {
        tab.delete(rec.watchId);
        if (tab.size === 0) this.byExtensionTab.delete(key);
      }
    }
  }

  create(spec: WatchSpec, home: WatchHome): WatchRecord {
    const rec: WatchRecord = {
      ...spec,
      watchId: this.nextId(),
      home,
      createdAt: Date.now(),
      firedCount: 0,
      droppedCount: 0,
      prefilteredCount: 0,
      lastFiredAt: null,
      // ⛔ null, not true. The server has not heard from the extension yet, and
      // "unknown" is a different state from "armed" — conflating them is the
      // isActive bug (memo 9fb367c0) under a new name.
      armedReportedByExtension: null,
      armedReportedAt: null,
    };
    this.watches.set(rec.watchId, rec);
    // A live watch and a tombstone must never both exist for one id.
    this.tombstones.delete(rec.watchId);
    this.index(rec);
    return rec;
  }

  get(watchId: string): WatchRecord | undefined {
    return this.watches.get(watchId);
  }

  list(filter: ListFilter = {}): WatchRecord[] {
    let out = [...this.watches.values()];
    if (filter.extensionId !== undefined) {
      out = out.filter((w) => w.extensionId === filter.extensionId);
    }
    if (filter.tabId !== undefined) {
      out = out.filter((w) => w.tabId === filter.tabId);
    }
    if (filter.agent !== undefined) {
      out = out.filter((w) => w.agent === filter.agent);
    }
    return out;
  }

  /** Every watch belonging to one extension — what gets re-pushed on register. */
  specsFor(extensionId: string): WatchRecord[] {
    const ids = this.byExtension.get(extensionId);
    if (!ids) return [];
    return [...ids].map((id) => this.watches.get(id)!).filter(Boolean);
  }

  delete(watchId: string, reason: ClearedReason = "deleted"): boolean {
    const rec = this.watches.get(watchId);
    if (!rec) return false;
    this.deindex(rec);
    this.watches.delete(watchId);

    this.tombstones.set(watchId, {
      watchId,
      source: rec.source,
      reason,
      at: Date.now(),
      agent: rec.agent,
      extensionId: rec.extensionId,
      tabId: rec.tabId ?? null,
      firedCount: rec.firedCount,
    });
    while (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === undefined) break;
      this.tombstones.delete(oldest);
    }
    return true;
  }

  /** Why a watch that no longer exists was cleared, if we still know. */
  tombstone(watchId: string): WatchTombstone | undefined {
    return this.tombstones.get(watchId);
  }

  /** Recently-cleared watches, NEWEST FIRST. */
  recentlyCleared(filter: ListFilter = {}): WatchTombstone[] {
    let out = [...this.tombstones.values()].reverse();
    if (filter.extensionId !== undefined) out = out.filter((t) => t.extensionId === filter.extensionId);
    if (filter.tabId !== undefined) out = out.filter((t) => t.tabId === filter.tabId);
    if (filter.agent !== undefined) out = out.filter((t) => t.agent === filter.agent);
    return out;
  }

  /** Cascade for TAB_DETACHED / tab close. Browser-wide watches survive. */
  deleteByTab(extensionId: string, tabId: number): string[] {
    const ids = this.byExtensionTab.get(this.tabKey(extensionId, tabId));
    if (!ids) return [];
    const removed = [...ids];
    for (const id of removed) this.delete(id, "tab-detached");
    return removed;
  }

  /** Cascade for socket close / extension disconnect. Takes everything. */
  deleteByExtension(extensionId: string): string[] {
    const ids = this.byExtension.get(extensionId);
    if (!ids) return [];
    const removed = [...ids];
    for (const id of removed) this.delete(id, "extension-disconnected");
    return removed;
  }

  /** Remove watches whose ttl has elapsed. Returns the removed ids. */
  expire(now: number): string[] {
    const removed: string[] = [];
    for (const rec of [...this.watches.values()]) {
      const ttl = rec.options?.ttlMs;
      if (ttl == null) continue;
      if (now - rec.createdAt >= ttl) {
        this.delete(rec.watchId, "ttl");
        removed.push(rec.watchId);
      }
    }
    return removed;
  }

  recordFired(watchId: string, at: number): void {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.firedCount += 1;
    rec.lastFiredAt = at;
  }

  /**
   * An event passed the extension's prefilter but not the server-side
   * predicate. Tracked separately from droppedCount, which means a DELIVERY
   * failure — conflating "your filter is loose" with "the sink is broken"
   * would hide both.
   */
  recordPrefiltered(watchId: string, count = 1): void {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.prefilteredCount += count;
  }

  recordDropped(watchId: string, count = 1): void {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.droppedCount += count;
  }

  /**
   * Store what the EXTENSION said, verbatim.
   *
   * ⛔ Never call this with a value the server inferred. The whole point of the
   * field is that it distinguishes "the extension confirmed it is armed" from
   * "we have a row for it".
   */
  recordArmed(watchId: string, armed: boolean, at: number): void {
    const rec = this.watches.get(watchId);
    if (!rec) return;
    rec.armedReportedByExtension = armed;
    rec.armedReportedAt = at;
  }
}
