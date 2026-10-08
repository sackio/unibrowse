import { zodToJsonSchema } from "zod-to-json-schema";

import {
  RealisticMouseMoveTool,
  RealisticClickTool,
  RealisticTypeTool,
} from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * ── REALISTIC MODE, IMPLEMENTED SERVER-SIDE ON PURPOSE ──────────────────────
 *
 * Ben, Slack #unibrowse 2026-10-08: in realistic mode agents must "move to
 * where they need to go, show some randomness in their movement, show some
 * delay and random hesitation like a human would".
 *
 * ⛔ WHY NOT IN THE EXTENSION, WHERE THE BEZIER CODE LIVES: an extension change
 * reaches no running browser without the ↻ on chrome://extensions, which Ben
 * has declined (memo `98c8143f`). Office's desktop Chrome is on 2026-09-17
 * code. Composing the behaviour here out of primitives that build ALREADY
 * accepts — `browser_realistic_mouse_move` takes {x,y,duration,currentX,
 * currentY} and `browser_realistic_click` takes {moveFirst,moveDuration,
 * currentX,currentY} — means it ships on the next :9010 restart and works on
 * every extension build in the fleet.
 *
 * ⛔ THE BUG THIS ALSO FIXES, AND IT WAS THE WORST OF THEM: `currentX`/
 * `currentY` defaulted to 0, so every single "realistic" move began at the
 * viewport's top-left corner. A path that starts at (0,0) every time is not
 * imperfect realism, it is a SIGNATURE — more identifying than not moving at
 * all. The cursor is now tracked per tab and a move starts where the last one
 * ended.
 *
 * ⚠️ AND THE SCHEMA WAS LYING. `moveFirst` is documented "default: true" in
 * tool-schemas.ts while extension/utils/cdp.js defaults it to FALSE (flipped
 * there because a 20-step bezier loop exceeded the 30s WebSocket timeout on
 * Xvfb sidecars). Every caller reading the description believed it was getting
 * movement and was not. The server now passes it explicitly, so the promise
 * and the behaviour agree.
 *
 * ⛔ NO SYNTHETIC TYPOS. `mistakeChance` stays 0 and nothing here raises it. A
 * "realistic" typo that gets corrected is a real-world error in a credential,
 * an address or an order quantity, and the realism it buys is unmeasured.
 * Hesitation is free; wrong characters are not.
 *
 * ⚠️ WHAT THIS DOES NOT DO, so nobody reports it as stealth: the debugger is
 * still attached and Runtime is still enabled, which is independently visible.
 * MEASURED 2026-10-08 (alpaca's memo `5eaf3446`): 11 Alpaca signups passed on
 * office's desktop Chrome using PLAIN calls, and the VPN chromium failed
 * Turnstile running identical code — so profile and IP dominated input
 * realism in the one case we have evidence for. This makes the input human,
 * not the browser anonymous.
 */

/** Where we last left the cursor, per tab. Seeded plausibly, never (0,0). */
const cursorByTab = new Map<string, { x: number; y: number }>();

function tabKey(params: any): string {
  return `${params?.extensionId ?? "default"}:${params?.tabTarget ?? "last"}`;
}

function jitter(base: number, spread: number): number {
  return Math.round(base + (Math.random() * 2 - 1) * spread);
}

function getCursor(key: string): { x: number; y: number } {
  let c = cursorByTab.get(key);
  if (!c) {
    // First move of the session. A human's pointer is somewhere arbitrary, so
    // seed it somewhere arbitrary — and deliberately NOT a constant.
    c = { x: 40 + Math.round(Math.random() * 180), y: 60 + Math.round(Math.random() * 200) };
    cursorByTab.set(key, c);
  }
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Walk the cursor to (x, y) in 1–3 legs with random waypoints and pauses.
 *
 * Legs are what produce HESITATION: a human does not glide to a target in one
 * uninterrupted sweep, they move, stop, adjust. Each leg is its own
 * `browser_realistic_mouse_move`, which the extension already draws as a
 * bezier with random control points — so the within-leg curve is free and the
 * between-leg pause is what we add.
 *
 * ⚠️ LEGS ARE CAPPED AT 3 AND EACH IS ONE CALL. The extension draws 6 Input
 * events per leg, so the worst case is ~18 serialized CDP commands. The 30s
 * WebSocket timeout that forced `moveFirst:false` came from a 20-step loop in
 * ONE call; this stays well inside it. ⛔ Do not raise the cap without
 * re-measuring against an Xvfb sidecar.
 */
async function walkCursorTo(
  context: any,
  params: any,
  x: number,
  y: number,
): Promise<void> {
  const key = tabKey(params);
  const from = getCursor(key);
  const dist = Math.hypot(x - from.x, y - from.y);

  // Short hops get one leg — stopping halfway across 30px is not human either.
  const legs = dist < 120 ? 1 : 1 + Math.floor(Math.random() * 2) + (dist > 600 ? 1 : 0);
  const pass: any = {};
  if (params?.tabTarget !== undefined) pass.tabTarget = params.tabTarget;
  if (params?.extensionId !== undefined) pass.extensionId = params.extensionId;
  if (params?.agent !== undefined) pass.agent = params.agent;

  let cx = from.x;
  let cy = from.y;
  for (let i = 1; i <= legs; i++) {
    const t = i / legs;
    // Aim at an interpolated point, offset perpendicular to the path so the
    // waypoint is off the straight line. Stays between the endpoints, so it
    // cannot wander off a viewport that both ends are inside.
    const perp = i === legs ? 0 : (Math.random() * 2 - 1) * Math.min(60, dist * 0.15);
    const nx = i === legs ? x : Math.round(from.x + (x - from.x) * t - (y - from.y) / (dist || 1) * perp);
    const ny = i === legs ? y : Math.round(from.y + (y - from.y) * t + (x - from.x) / (dist || 1) * perp);

    await context.sendSocketMessage("browser_realistic_mouse_move", {
      ...pass,
      x: nx,
      y: ny,
      // Duration scales with the leg's length, with jitter, floored so a tiny
      // hop still takes human time rather than snapping.
      duration: Math.max(90, jitter(Math.hypot(nx - cx, ny - cy) * 1.6 + 120, 60)),
      currentX: cx,
      currentY: cy,
    });
    cx = nx;
    cy = ny;
    cursorByTab.set(key, { x: cx, y: cy });

    if (i < legs) {
      // Between-leg hesitation. The occasional long pause is the point: a
      // constant 80ms gap is its own tell.
      await sleep(Math.random() < 0.25 ? jitter(420, 180) : jitter(130, 70));
    }
  }

  // Settle before acting, the way a hand does.
  await sleep(jitter(110, 60));
}

/**
 * Move mouse along natural bezier curve path
 * Uses CDP Input domain to generate OS-level mouse events along a smooth curve,
 * simulating natural human mouse movement with randomized timing.
 */
export const realisticMouseMove: Tool = {
  schema: {
    name: RealisticMouseMoveTool.shape.name.value,
    description: RealisticMouseMoveTool.shape.description.value,
    inputSchema: zodToJsonSchema(RealisticMouseMoveTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = RealisticMouseMoveTool.shape.arguments.parse(params);

      // Start from where the cursor actually is unless the caller overrode it.
      const key = tabKey(params);
      const from = getCursor(key);
      const withCursor = {
        ...validatedParams,
        currentX: validatedParams.currentX ?? from.x,
        currentY: validatedParams.currentY ?? from.y,
        duration: validatedParams.duration ?? Math.max(120, jitter(400, 140)),
      };
      const result = await context.sendSocketMessage("browser_realistic_mouse_move", withCursor);
      cursorByTab.set(key, { x: validatedParams.x, y: validatedParams.y });

      return textResponse(result.message || `Moved mouse to (${validatedParams.x}, ${validatedParams.y})`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to move mouse: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Perform realistic click with human-like timing
 * Uses CDP Input domain to generate OS-level click events with natural timing,
 * optionally including realistic mouse movement to the target position.
 */
export const realisticClick: Tool = {
  schema: {
    name: RealisticClickTool.shape.name.value,
    description: RealisticClickTool.shape.description.value,
    inputSchema: zodToJsonSchema(RealisticClickTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = RealisticClickTool.shape.arguments.parse(params);

      // Move to the target with randomness and hesitation, THEN click. The
      // click itself passes moveFirst:false because the journey already
      // happened — letting the extension move again would double it and start
      // that second move from the stale (0,0) default.
      const key = tabKey(params);
      if (validatedParams.moveFirst !== false) {
        await walkCursorTo(context, params, validatedParams.x, validatedParams.y);
      }
      const result = await context.sendSocketMessage("browser_realistic_click", {
        ...validatedParams,
        moveFirst: false,
        currentX: validatedParams.x,
        currentY: validatedParams.y,
      });
      cursorByTab.set(key, { x: validatedParams.x, y: validatedParams.y });

      return textResponse(result.message || `Clicked at (${validatedParams.x}, ${validatedParams.y})`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to click: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Type text with realistic human-like timing
 * Uses CDP Input domain to generate OS-level keyboard events with variable timing
 * between keystrokes. Optionally simulates typos and corrections for more realistic behavior.
 */
export const realisticType: Tool = {
  schema: {
    name: RealisticTypeTool.shape.name.value,
    description: RealisticTypeTool.shape.description.value,
    inputSchema: zodToJsonSchema(RealisticTypeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttachedFromParams(params);
      const validatedParams = RealisticTypeTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_realistic_type", validatedParams);

      const preview = validatedParams.text.substring(0, 50);
      const suffix = validatedParams.text.length > 50 ? '...' : '';
      return textResponse(result.message || `Typed: "${preview}${suffix}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to type: ${error.message}`, false, error, max_tokens);
    }
  },
};
