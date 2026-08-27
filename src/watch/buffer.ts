/**
 * Watch — the `buffer` sink and its long-poll.
 *
 * This is `observeNavigations.first()` generalised to any source. It stays,
 * rather than being replaced by push, because "block until X happens" is still
 * the right shape when an agent is actively waiting rather than going away.
 * Push and long-poll answer different questions.
 *
 * The waiter bookkeeping mirrors handleObserveNavFirst in background.js, which
 * already gets the important part right: a timed-out waiter splices itself out
 * of the queue so a later event cannot resolve a promise nobody is holding.
 */

import type { WatchEvent } from "./types.ts";

export interface PollResult {
  matched: boolean;
  events?: WatchEvent[];
  timeoutMs?: number;
}

type Waiter = (result: PollResult) => void;

interface Slot {
  queue: WatchEvent[];
  waiters: Waiter[];
}

const DEFAULT_MAX_BUFFERED = 100;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 10;

export class WatchBuffer {
  private slots = new Map<string, Slot>();
  private maxBuffered: number;

  // ⛔ NOT a TypeScript parameter property (`constructor(private x: T)`).
  // Node's --experimental-strip-types rejects those outright, and the unit
  // tests import this module directly rather than through tsup.
  constructor(maxBuffered: number = DEFAULT_MAX_BUFFERED) {
    this.maxBuffered = maxBuffered;
  }

  private slot(watchId: string): Slot {
    let s = this.slots.get(watchId);
    if (!s) {
      s = { queue: [], waiters: [] };
      this.slots.set(watchId, s);
    }
    return s;
  }

  /** Deliver an event. Wakes one waiter if any, else buffers. */
  push(watchId: string, event: WatchEvent): void {
    const s = this.slot(watchId);
    const waiter = s.waiters.shift();
    if (waiter) {
      waiter({ matched: true, events: [event] });
      return;
    }
    s.queue.push(event);
    // Bounded: drop OLDEST first. A full buffer means nobody is draining, and
    // the newest state is the one worth keeping.
    if (s.queue.length > this.maxBuffered) {
      s.queue.splice(0, s.queue.length - this.maxBuffered);
    }
  }

  /**
   * Drain everything buffered, or block until the next event or the timeout.
   * Returns `{matched:false}` on timeout rather than throwing — a timeout is
   * an answer ("nothing yet"), not an error.
   */
  poll(watchId: string, timeoutMs = 15_000): Promise<PollResult> {
    const s = this.slot(watchId);
    if (s.queue.length > 0) {
      const events = s.queue;
      s.queue = [];
      return Promise.resolve({ matched: true, events });
    }

    const deadline = Math.max(MIN_TIMEOUT_MS, Math.min(timeoutMs, MAX_TIMEOUT_MS));
    return new Promise<PollResult>((resolve) => {
      let settled = false;
      const settle = (r: PollResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const waiter: Waiter = (r) => settle(r);
      s.waiters.push(waiter);

      setTimeout(() => {
        // ⛔ Pull the waiter back out before settling, or a later push resolves
        // an already-settled promise and the event is consumed by nobody.
        const idx = s.waiters.indexOf(waiter);
        if (idx >= 0) s.waiters.splice(idx, 1);
        settle({ matched: false, timeoutMs: deadline });
      }, deadline);
    });
  }

  /** Tear down a watch's slot; pending waiters resolve as unmatched. */
  drop(watchId: string): void {
    const s = this.slots.get(watchId);
    if (!s) return;
    const waiters = s.waiters.splice(0);
    for (const w of waiters) w({ matched: false });
    this.slots.delete(watchId);
  }
}
