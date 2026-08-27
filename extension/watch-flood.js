/**
 * Watch — flood control.
 *
 * Pure arithmetic over an injected clock. No Chrome APIs, which is what makes
 * it unit-testable without a browser.
 *
 * This is layer 2-4 of the spec's four-layer flood control. Layer 1 — running
 * the predicate at the source so non-matches never cross the WebSocket — is
 * not here; it lives in watch-engine.js and does most of the work for free.
 *
 * ⛔ THE BREAKER MUST ANNOUNCE ITS OWN DEATH. A watch that silently stops is
 * indistinguishable from a quiet page, which is the exact failure this whole
 * subsystem exists to remove. `offer()` returns a `breaker` payload once, and
 * the caller is obliged to deliver it.
 */

const WINDOW_MS = 60_000;
/** The breaker trips at this multiple of the rate cap within one window. */
const BREAKER_MULTIPLE = 10;

/**
 * @param {object} opts
 * @param {number} [opts.maxPerMin]  deliveries allowed per sliding minute
 * @param {{windowMs: number, mode: "last"|"batch"|"count"}} [opts.coalesce]
 * @param {() => number} [opts.now]  injected clock, defaults to Date.now
 */
function createFloodGate({ maxPerMin, coalesce, now = Date.now } = {}) {
  /** Delivery timestamps inside the current sliding window. */
  let stamps = [];
  /** Events held by the coalescer, awaiting flush(). */
  let held = [];
  let heldSince = null;
  let delivered = 0;
  let dropped = 0;
  let broken = false;
  let brokenReported = false;
  /** Offers seen in the window, including dropped ones — this is what trips
   *  the breaker. A cap alone would let a firehose spin forever at the cap. */
  let offersInWindow = [];

  const prune = (t) => {
    const cutoff = t - WINDOW_MS;
    stamps = stamps.filter((s) => s > cutoff);
    offersInWindow = offersInWindow.filter((s) => s > cutoff);
  };

  return {
    /**
     * Offer an event to the gate.
     * @returns {{action: "deliver"|"hold"|"drop", breaker?: {reason: string, firedInWindow: number, cap: number}}}
     */
    offer(event) {
      const t = now();
      prune(t);

      if (broken) {
        dropped++;
        return { action: "drop" };
      }

      offersInWindow.push(t);

      // Breaker: sustained abuse well past the cap. Trips once, latches, and
      // reports itself exactly once so the caller can deliver the notice.
      if (maxPerMin != null && offersInWindow.length > maxPerMin * BREAKER_MULTIPLE) {
        broken = true;
        dropped++;
        if (!brokenReported) {
          brokenReported = true;
          return {
            action: "drop",
            breaker: {
              reason:
                `watch exceeded ${BREAKER_MULTIPLE}x its rate cap within one minute and was disarmed`,
              firedInWindow: offersInWindow.length,
              cap: maxPerMin,
            },
          };
        }
        return { action: "drop" };
      }

      // Rate cap. Applied BEFORE coalescing so a firehose cannot fill the
      // coalesce buffer without bound.
      if (maxPerMin != null && stamps.length >= maxPerMin) {
        dropped++;
        return { action: "drop" };
      }

      stamps.push(t);

      if (coalesce) {
        if (heldSince == null) heldSince = t;
        held.push(event);
        return { action: "hold" };
      }

      delivered++;
      return { action: "deliver" };
    },

    /**
     * Drain the coalescer if its window has elapsed. Returns [] otherwise, so
     * a caller can flush optimistically on a timer without checking the clock.
     */
    flush() {
      if (!coalesce || heldSince == null) return [];
      const t = now();
      if (t - heldSince < coalesce.windowMs) return [];

      const batch = held;
      held = [];
      heldSince = null;
      if (batch.length === 0) return [];

      delivered++;
      if (coalesce.mode === "last") return [batch[batch.length - 1]];
      if (coalesce.mode === "count") return [{ count: batch.length, coalesced: true }];
      return batch;
    },

    state() {
      return { delivered, dropped, broken, held: held.length };
    },
  };
}

// ⛔ background.js is a CLASSIC service worker (no "type":"module" in the
// manifest) and loads this via importScripts, where `export` is a syntax
// error. A top-level declaration is already global there; this assignment is
// a harmless no-op. Under Node's ESM loader — which the unit tests use — the
// declaration is module-scoped, so the assignment is what publishes it.
globalThis.createFloodGate = createFloodGate;
