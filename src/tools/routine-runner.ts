/**
 * Routine runner — host-side execution model for kind:'routine' macros.
 *
 * A routine macro's code is an async function body. We compile it via
 * AsyncFunction(params, ctx, body) and invoke with `params` from the caller
 * plus a `ctx` handle whose methods proxy to the browser tool surface via
 * Context.sendSocketMessage — same routing path an external agent uses,
 * so multi-extension + tab-reservation semantics are preserved automatically.
 *
 * Tab targeting: the routine inherits the caller's tabTarget / extensionId /
 * agent for every ctx.* call by default. Per-call override is supported via
 * an opts arg (e.g. ctx.navigate(url, {tabTarget, extensionId})).
 *
 * Error model: each ctx.* method rejects with a typed Error carrying
 *   { code: string, cause: unknown }
 * where `code` is one of: 'tool-error', 'tab-gone', 'nav-timeout',
 * 'element-not-found', 'wait-timeout'. Routine try/catch can branch on
 * err.code for retry / fallback logic.
 *
 * SECURITY: AsyncFunction(body)() executes arbitrary JS in the mcp-server
 * Node runtime — full filesystem / process / network access. Routines are
 * admin-trust code. Stored via browser_store_macro which gates on ownership.
 */

import type { Context } from "@/context";
import { mongodb } from "@/utils/mongodb";

/** Typed error class for ctx.* failures. */
export class RoutineError extends Error {
  code: string;
  cause: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "RoutineError";
    this.code = code;
    this.cause = cause;
  }
}

interface CtxBaseOpts {
  tabTarget?: number | string;
  extensionId?: string;
  agent?: string;
  takeover?: boolean;
  timeoutMs?: number;
}

/**
 * Build a `ctx` handle bound to a Context + inherited tab/extension targeting.
 * Each method is a thin wrapper around context.sendSocketMessage with the
 * right message type, merging caller-supplied per-call opts over the inherited
 * defaults so a routine can pin most calls to one tab and occasionally swap.
 */
export function buildCtx(context: Context, defaults: CtxBaseOpts) {
  const mergeTarget = (opts?: CtxBaseOpts) => ({
    tabTarget: opts?.tabTarget ?? defaults.tabTarget,
    extensionId: opts?.extensionId ?? defaults.extensionId,
    agent: opts?.agent ?? defaults.agent,
    takeover: opts?.takeover ?? defaults.takeover,
    timeoutMs: opts?.timeoutMs,
  });

  const wrapErr = (code: string, op: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return new RoutineError(code, `ctx.${op} failed: ${msg}`, err);
  };

  const callTool = async (op: string, type: string, payload: any, opts: CtxBaseOpts) => {
    try {
      return await context.sendSocketMessage(type as any, payload, opts as any);
    } catch (e) {
      // Default error code is 'tool-error'. Specific wrappers below can
      // upgrade to nav-timeout / tab-gone / etc.
      throw wrapErr("tool-error", op, e);
    }
  };

  return {
    /** Navigate the current tab to `url`. Pass {focus:true} to bring the tab to front. */
    async navigate(url: string, opts: CtxBaseOpts & { focus?: boolean } = {}) {
      return await callTool("navigate", "browser_navigate",
        { url, focus: opts.focus, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /**
     * Evaluate JS in the page's MAIN world. Accepts either:
     *   - a function: serialized via .toString() and called with `args` injected as JSON
     *   - a string: used as-is (legacy `expression` shape; an implicit IIFE wraps it)
     * The function form lets routines write `await ctx.evaluate(() => document.title)`.
     */
    async evaluate(fnOrExpr: ((...args: any[]) => any) | string, args?: any[], opts: CtxBaseOpts = {}) {
      let expression: string;
      if (typeof fnOrExpr === "function") {
        const argsJson = JSON.stringify(args ?? []);
        expression = `(${fnOrExpr.toString()}).apply(null, ${argsJson})`;
      } else {
        expression = fnOrExpr;
      }
      return await callTool("evaluate", "browser_evaluate",
        { expression, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /** OS-level click via CDP Input. moveFirst false by default (see cdp.js). */
    async realisticClick(x: number, y: number, opts: CtxBaseOpts & {
      button?: "left" | "right" | "middle"; clickCount?: number;
      moveFirst?: boolean; moveDuration?: number; currentX?: number; currentY?: number;
    } = {}) {
      return await callTool("realisticClick", "browser_realistic_click",
        { x, y, button: opts.button, clickCount: opts.clickCount,
          moveFirst: opts.moveFirst, moveDuration: opts.moveDuration,
          currentX: opts.currentX, currentY: opts.currentY,
          ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /** OS-level mouse move along a bezier (5 steps default after the cdp.js fix). */
    async realisticMouseMove(x: number, y: number, opts: CtxBaseOpts & {
      duration?: number; currentX?: number; currentY?: number;
    } = {}) {
      return await callTool("realisticMouseMove", "browser_realistic_mouse_move",
        { x, y, duration: opts.duration, currentX: opts.currentX, currentY: opts.currentY,
          ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /** OS-level keystrokes via CDP Input — supports pressEnter, mistakes, timing. */
    async realisticType(text: string, opts: CtxBaseOpts & {
      pressEnter?: boolean; mistakeChance?: number; minDelay?: number; maxDelay?: number;
    } = {}) {
      return await callTool("realisticType", "browser_realistic_type",
        { text, pressEnter: opts.pressEnter, mistakeChance: opts.mistakeChance,
          minDelay: opts.minDelay, maxDelay: opts.maxDelay, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /** Press a single keyboard key (e.g. 'Enter', 'Tab', 'Escape', 'a'). */
    async pressKey(key: string, opts: CtxBaseOpts = {}) {
      return await callTool("pressKey", "browser_press_key",
        { key, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /** Pure server-side sleep — no round-trip, but exposed for uniform API. */
    async wait(ms: number) {
      await new Promise((r) => setTimeout(r, Math.max(0, ms)));
    },

    /**
     * Poll location.href in the page until it matches `pattern` (string substring
     * or RegExp). Default 15s deadline, 200ms polling. Throws RoutineError
     * code='wait-timeout' when the deadline expires. Returns the matching URL.
     */
    async waitForUrl(pattern: string | RegExp, opts: CtxBaseOpts & {
      timeoutMs?: number; pollMs?: number;
    } = {}) {
      const deadline = Date.now() + (opts.timeoutMs ?? 15000);
      const pollMs = opts.pollMs ?? 200;
      const reStr = pattern instanceof RegExp ? pattern.source : null;
      const reFlags = pattern instanceof RegExp ? pattern.flags : null;
      const subStr = typeof pattern === "string" ? pattern : null;
      while (Date.now() < deadline) {
        try {
          const href: string = await this.evaluate(() => location.href, [], opts);
          if (reStr) {
            const re = new RegExp(reStr, reFlags || "");
            if (re.test(href)) return href;
          } else if (subStr && href.includes(subStr)) {
            return href;
          }
        } catch (e) {
          // tab navigated away mid-eval — that's actually the signal we're
          // waiting for. Loop again and the next eval should succeed.
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new RoutineError(
        "wait-timeout",
        `ctx.waitForUrl(${String(pattern)}) timed out after ${opts.timeoutMs ?? 15000}ms`,
      );
    },

    /** Capture a tab screenshot. Returns {dataUrl}. */
    async screenshot(opts: CtxBaseOpts & { fullPage?: boolean; quality?: number } = {}) {
      return await callTool("screenshot", "browser_screenshot",
        { fullPage: opts.fullPage, quality: opts.quality, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /** Get the visible text of the page (or a selector). */
    async getVisibleText(opts: CtxBaseOpts & { selector?: string } = {}) {
      return await callTool("getVisibleText", "browser_get_visible_text",
        { selector: opts.selector, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /**
     * Bring the targeted tab to front via CDP Page.bringToFront — useful when
     * the routine needs to ensure focus before a subsequent realistic input
     * (cdp.js already prepends bringToFront on realisticClick/move, but this
     * exposes the primitive for explicit use).
     */
    async bringToFront(opts: CtxBaseOpts = {}) {
      // We don't have a dedicated browser_bring_to_front tool yet; use evaluate
      // to invoke the CDP target via a no-op runtime call. Actually the
      // realistic* tools already do this internally — for now this is a stub
      // that resolves immediately so routines can include it without breaking.
      // Phase 2: add a dedicated tool message.
      return;
    },

    /**
     * Arm a navigation observer on the inherited (or overridden) tab. Returns
     * an object with `first({timeoutMs?})` and `dispose()` methods. The
     * observer captures webNavigation.onCommitted events whose top-frame URL
     * matches `pattern` from arm-time onward — so the routine can call this
     * BEFORE a click that triggers a transient redirect (e.g. OAuth callback
     * that auto-bounces in <50ms) and reliably retrieve the matched URL.
     *
     * Usage:
     *   const sub = await ctx.observeNavigations({ pattern: /callback/ });
     *   await ctx.realisticClick(x, y);
     *   const { url } = await sub.first({ timeoutMs: 8000 });
     *   await sub.dispose();
     *
     * `pattern` may be a string (treated as a regex source) or a RegExp.
     */
    async observeNavigations(opts: CtxBaseOpts & { pattern: string | RegExp } = { pattern: '' }) {
      const pattern = opts.pattern;
      if (!pattern) throw new RoutineError('bad-args', 'ctx.observeNavigations requires opts.pattern');
      const patternStr = pattern instanceof RegExp ? pattern.source : String(pattern);
      const flagsStr = pattern instanceof RegExp ? pattern.flags : '';
      const targetOpts = mergeTarget(opts);
      const startRes: any = await callTool(
        'observeNavigations.start',
        'browser_observe_navigations_start',
        { pattern: patternStr, flags: flagsStr, ...targetOpts },
        targetOpts,
      );
      const subId = startRes.subscriptionId;
      let disposed = false;
      return {
        subscriptionId: subId,
        /** Resolve with the first matched navigation, or reject on timeout. */
        async first(firstOpts: { timeoutMs?: number } = {}) {
          if (disposed) throw new RoutineError('disposed', 'observeNavigations: already disposed');
          const res: any = await callTool(
            'observeNavigations.first',
            'browser_observe_navigations_first',
            { subscriptionId: subId, timeoutMs: firstOpts.timeoutMs },
            { ...targetOpts, timeoutMs: (firstOpts.timeoutMs ?? 15000) + 2000 },
          );
          if (res?.matched) return { url: res.url, timestamp: res.timestamp, transitionType: res.transitionType };
          throw new RoutineError(
            'wait-timeout',
            `observeNavigations.first timed out after ${res?.timeoutMs ?? '?'}ms (no match for ${patternStr})`,
          );
        },
        /** Tear down the subscription. Safe to call multiple times. */
        async dispose() {
          if (disposed) return;
          disposed = true;
          try {
            await callTool(
              'observeNavigations.dispose',
              'browser_observe_navigations_dispose',
              { subscriptionId: subId },
              targetOpts,
            );
          } catch {/* best-effort */}
        },
      };
    },

    /**
     * Search browser history (chrome.history.search) for `text`, returned
     * NEWEST-FIRST as [{ url, title, lastVisitTime, visitCount }]. This is a
     * RELIABLE fallback for capturing a transient navigation the tab has already
     * bounced away from — e.g. an OAuth callback URL that flashes through in <1s
     * and forwards to the app. observeNavigations can miss such a cross-origin
     * main-frame swap (the frame target is torn down mid-redirect), but history
     * records the visit durably. `text` is a free-text query matched against URL
     * + title substrings (e.g. "oauth/code/callback"). Pass {startTime} (epoch
     * ms) to only return visits at/after a moment you stamped before the click,
     * so a stale code from a prior run can't be mistaken for the fresh one. NOTE:
     * history is browser-wide, not tab-scoped — filter/parse in the routine.
     */
    async searchHistory(text: string, opts: CtxBaseOpts & { maxResults?: number; startTime?: number } = {}) {
      const targetOpts = mergeTarget(opts);
      const res: any = await callTool(
        "searchHistory",
        "browser_search_history",
        { text, maxResults: opts.maxResults ?? 20, startTime: opts.startTime, ...targetOpts },
        targetOpts,
      );
      const items = (res?.results ?? []) as Array<{ url: string; title?: string; lastVisitTime?: number; visitCount?: number }>;
      return items.slice().sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0));
    },

    /**
     * Scroll the page by a pixel delta (wraps browser_scroll).
     * `y` is required (positive = down, negative = up); `x` optional (default 0).
     */
    async scroll(y: number, opts: CtxBaseOpts & { x?: number } = {}) {
      return await callTool("scroll", "browser_scroll",
        { x: opts.x ?? 0, y, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /**
     * Put local file paths into a file input, without a native file dialog.
     *
     * ⛔ THE PATHS MUST EXIST ON THE BROWSER'S OWN HOST, not on this server's.
     * For a container sidecar that means /app/.chrome-profiles/... (bind-mounted
     * from <repo>/chrome-profiles); the sidecar cannot see /mnt/nas at all. A
     * host-side path produces a file input that looks accepted and uploads
     * nothing, which is the failure this comment exists to prevent.
     * ⭐ For an upload, the NETWORK LOG is the instrument — not the page's own
     * uploads panel, which lags and lies. Measured on Zazzle 2026-10-12: three
     * uploads returned HTTP 200 while the panel showed nothing.
     */
    async setFileInput(selector: string, paths: string[], opts: CtxBaseOpts = {}) {
      return await callTool("setFileInput", "browser_set_file_input",
        { selector, paths, ...mergeTarget(opts) }, mergeTarget(opts));
    },

    /**
     * Run `action`, then wait for a NEW tab to appear in the same browser,
     * attach it, and return its tab id.
     *
     * ⭐ WHY A ROUTINE NEEDS THIS AT ALL: some flows only continue in a tab the
     * site opens itself. Zazzle's "Personalize this design" is one — the
     * customizer is a new tab, and without capturing it a routine is stranded
     * on a page that will never change again.
     *
     * ⛔ `browser_list_tabs` RETURNS A BARE ARRAY, not { tabs }. Reading
     * `.tabs` off it yields undefined, which an "any new tabs?" diff reads as
     * "no new tabs" — indistinguishable from the site not having opened one.
     * Cost the all-tabs picker a wasted deploy on 2026-10-12.
     *
     * ⚠️ It diffs tab IDS, not counts: a flow that closes one tab while opening
     * another leaves the count unchanged, and a count check would miss it.
     */
    async captureNewTab(
      action: () => Promise<any>,
      opts: CtxBaseOpts & { timeoutMs?: number; pollMs?: number } = {},
    ) {
      const target = mergeTarget(opts);
      const ids = async (): Promise<number[]> => {
        const raw: any = await callTool("captureNewTab", "browser_list_tabs",
          { ...(target.extensionId ? { extensionId: target.extensionId } : {}) }, target);
        const rows: any[] = Array.isArray(raw) ? raw : (raw?.tabs ?? []);
        return rows.map((t) => Number(t?.tabId)).filter((n) => Number.isFinite(n));
      };
      const before = new Set(await ids());
      const actionResult = await action();
      const deadline = Date.now() + (opts.timeoutMs ?? 30000);
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 750));
        const fresh = (await ids()).filter((id) => !before.has(id));
        if (fresh.length) {
          // Newest id last: Chrome hands out ascending ids within a session.
          const tabId = fresh.sort((a, b) => a - b)[fresh.length - 1];
          await callTool("captureNewTab", "browser_ensure_attached",
            { tabId, label: null, autoOpenUrl: null, ...target }, target);
          return { tabId, actionResult };
        }
      }
      throw new RoutineError(
        "tab-gone",
        `ctx.captureNewTab: no new tab appeared within ${opts.timeoutMs ?? 30000}ms`,
      );
    },

    /**
     * Execute a stored macro by id from within this routine and return its
     * result — lets a routine COMPOSE existing extraction/util macros instead
     * of inlining their code. `page`-kind macros are wrapped + evaluated in the
     * routine's target tab (identical path to browser_execute_macro's page
     * branch, so the macro sees `params` and returns its normal value).
     * `routine`-kind macros run nested via runRoutine, sharing this Context +
     * target binding. NOTE: nested routine-kind calls are unguarded against
     * self-recursion — don't have a routine executeMacro itself.
     */
    async executeMacro(id: string, macroParams: Record<string, any> = {}, opts: CtxBaseOpts = {}) {
      if (!mongodb.isConnected()) await mongodb.connect();
      const macro: any = await mongodb.getMacrosCollection().findOne({ id });
      if (!macro) throw new RoutineError("macro-not-found", `ctx.executeMacro: no macro with id "${id}"`);
      const targetOpts = mergeTarget(opts);
      if (macro.kind === "routine") {
        return await runRoutine(macro.code as string, macroParams, context, {
          tabTarget: targetOpts.tabTarget, extensionId: targetOpts.extensionId,
          agent: targetOpts.agent, takeover: targetOpts.takeover,
        });
      }
      // page-kind: wrap + eval in the page, mirroring executeMacro's legacy IIFE path.
      const wrapped = `
        return (async function() {
          const macroFunction = ${macro.code};
          const params = ${JSON.stringify(macroParams || {})};
          const result = typeof macroFunction === 'function' ? await macroFunction(params) : await macroFunction;
          return result;
        })()
      `;
      try {
        return await context.sendSocketMessage(
          "browser_evaluate",
          { expression: wrapped } as any,
          targetOpts as any,
        );
      } catch (e) {
        throw wrapErr("macro-eval-error", "executeMacro", e);
      }
    },
  };
}

/** Caller-supplied bindings passed into the routine via ctx defaults. */
export interface RoutineCallContext {
  tabTarget?: number | string;
  extensionId?: string;
  agent?: string;
  takeover?: boolean;
}

/**
 * Compile + invoke a routine-kind macro.
 *
 * @param code   macro body — should be an async function literal:
 *               `async (params, ctx) => { ... return result; }`
 * @param params params dict supplied by the execute_macro caller
 * @param context the Context the executeMacro tool handler was called with
 * @param bind   target inheritance: tabTarget/extensionId/agent passed by caller
 */
export async function runRoutine(
  code: string,
  params: Record<string, unknown>,
  context: Context,
  bind: RoutineCallContext,
): Promise<unknown> {
  const ctx = buildCtx(context, bind);

  // The macro source is expected to be an async function expression. Compile
  // it with `new Function('params', 'ctx', 'return (CODE)(params, ctx);')`.
  // That tolerates both shapes:
  //   async (params, ctx) => { ... }      ← lambda
  //   async function(params, ctx) { ... } ← function expr
  // and surfaces a clean SyntaxError if the body is malformed.
  let macroFn: (p: any, c: any) => Promise<any>;
  try {
    const wrapped = `return (${code});`;
    const factory = new Function("params", "ctx", wrapped) as any;
    macroFn = factory(params, ctx);
  } catch (e) {
    throw new RoutineError(
      "syntax-error",
      `Failed to compile routine: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
  if (typeof macroFn !== "function") {
    throw new RoutineError(
      "syntax-error",
      `Routine code must evaluate to a function; got ${typeof macroFn}`,
    );
  }

  return await macroFn(params, ctx);
}
