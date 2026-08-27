/**
 * Watch — the authoritative registry.
 *
 * Pure logic, no I/O, so lifetime transitions are unit-testable without a
 * browser or a broker. The server holds one instance; the extension holds its
 * own arming state, and the two are reconciled by re-push on
 * EXTENSION_REGISTER rather than by either trusting the other.
 */

import type { WatchHome, WatchRecord, WatchSpec } from "./types.ts";

export interface ListFilter {
  extensionId?: string;
  tabId?: number | null;
  agent?: string;
}

export class WatchRegistry {
  private watches = new Map<string, WatchRecord>();
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
      lastFiredAt: null,
      // ⛔ null, not true. The server has not heard from the extension yet, and
      // "unknown" is a different state from "armed" — conflating them is the
      // isActive bug (memo 9fb367c0) under a new name.
      armedReportedByExtension: null,
      armedReportedAt: null,
    };
    this.watches.set(rec.watchId, rec);
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

  delete(watchId: string): boolean {
    const rec = this.watches.get(watchId);
    if (!rec) return false;
    this.deindex(rec);
    this.watches.delete(watchId);
    return true;
  }

  /** Cascade for TAB_DETACHED / tab close. Browser-wide watches survive. */
  deleteByTab(extensionId: string, tabId: number): string[] {
    const ids = this.byExtensionTab.get(this.tabKey(extensionId, tabId));
    if (!ids) return [];
    const removed = [...ids];
    for (const id of removed) this.delete(id);
    return removed;
  }

  /** Cascade for socket close / extension disconnect. Takes everything. */
  deleteByExtension(extensionId: string): string[] {
    const ids = this.byExtension.get(extensionId);
    if (!ids) return [];
    const removed = [...ids];
    for (const id of removed) this.delete(id);
    return removed;
  }

  /** Remove watches whose ttl has elapsed. Returns the removed ids. */
  expire(now: number): string[] {
    const removed: string[] = [];
    for (const rec of [...this.watches.values()]) {
      const ttl = rec.options?.ttlMs;
      if (ttl == null) continue;
      if (now - rec.createdAt >= ttl) {
        this.delete(rec.watchId);
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
