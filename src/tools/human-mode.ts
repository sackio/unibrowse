import * as fs from "node:fs";
import * as path from "node:path";

import { profileNameForExtensionId } from "../utils/profile-identity.ts";
import { listSidecars } from "../utils/sidecars.ts";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  HumanModeTool,
  HumanClickTool,
  HumanMoveTool,
  HumanTypeTool,
  HumanDragTool,
  HumanScrollTool,
  HumanKeyTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * ── HUMAN MODE ──────────────────────────────────────────────────────────────
 *
 * Ben, Slack #unibrowse 2026-10-23: "in human mode the unibrowse combination
 * extension/ui-eye app should prevent scripted manipulation to fill out things
 * and force the agents to do human like movements". Earlier the same day, on
 * why the input cannot come from inside the browser: "the key is we really
 * need it to not be in the browser that it gets solved it needs to be mouse
 * and keyboard automation that's made to look realistic".
 *
 * Default OFF, flipped per profile — also his call, same thread.
 *
 * ⛔ THIS IS A GUARD RAIL, NOT A SANDBOX, and the difference matters when
 * someone later reports it as security. The evaluate check is pattern-based,
 * so an agent that wanted to could write around it. What it buys is that the
 * scripted path stops being the path of least resistance: you have to
 * deliberately defeat it, which is the behaviour change that was asked for.
 *
 * ⛔ AND IT ONLY REACHES A SIDECAR PROFILE. Human input is delivered by
 * xdotool against that profile's Xvfb display, which exists only for chromes
 * the chromium-host sidecar launched. Office's desktop Chrome has no display
 * we may drive (Ben's standing rule: never coordinate-click :0; use ui-eye's
 * AXPress there), so turning human mode on for it would refuse every input
 * tool and offer nothing in their place. browser_human_mode refuses that.
 *
 * ⚠️ WHAT THE GATE CANNOT SEE. It keys on `extensionId`, because that is what
 * identifies a profile. A call that omits it is not gated. In practice the
 * server already requires extensionId whenever more than one extension is
 * connected — which is the only situation where human mode is interesting —
 * but this is the hole, and it is a hole by construction rather than an
 * oversight to be fixed by guessing which profile was meant.
 */

// --------------------------------------------------------------------------- //
// state
// --------------------------------------------------------------------------- //

const PROFILES_DIR = process.env.PROFILES_DIR || "/app/.chrome-profiles";
const STATE_FILE = path.join(PROFILES_DIR, "_human-mode.json");

type State = { extensions: Record<string, { since: string; by?: string }> };

let cached: State | null = null;
let cachedAt = 0;
const CACHE_MS = 2000;

function readState(): State {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
    if (!cached || typeof cached !== "object" || !cached.extensions) cached = { extensions: {} };
  } catch {
    // ⚠️ Missing or unreadable means OFF, deliberately. Human mode failing
    // open is a lane that quietly uses scripted input; human mode failing
    // closed is every tool in the fleet refusing because one file went away.
    cached = { extensions: {} };
  }
  cachedAt = now;
  return cached;
}

function writeState(s: State): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  cached = s;
  cachedAt = Date.now();
}

export function isHumanMode(extensionId?: string | null): boolean {
  if (!extensionId) return false;
  return !!readState().extensions[extensionId];
}

// --------------------------------------------------------------------------- //
// the gate
// --------------------------------------------------------------------------- //

/** Input tools that dispatch inside the browser. All refused in human mode. */
const SCRIPTED_INPUT_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_press_key",
  "browser_submit_form",
  "browser_drag",
  "browser_hover",
  "browser_set_clipboard",
  // ⛔ These three are refused too, and that is the point rather than an
  // oversight: "realistic" here means a bezier path dispatched through CDP
  // Input, which is still the browser typing into itself.
  "browser_realistic_click",
  "browser_realistic_type",
  "browser_realistic_mouse_move",
]);

const REPLACEMENT: Record<string, string> = {
  browser_click: "browser_human_click",
  browser_realistic_click: "browser_human_click",
  browser_type: "browser_human_type",
  browser_realistic_type: "browser_human_type",
  browser_fill_form: "browser_human_click + browser_human_type per field",
  browser_select_option: "browser_human_click the select, then browser_human_key with Down/Return",
  browser_press_key: "browser_human_key",
  browser_submit_form: "browser_human_click the submit control, or browser_human_key Return",
  browser_drag: "browser_human_drag",
  browser_hover: "browser_human_move",
  browser_realistic_mouse_move: "browser_human_move",
  browser_set_clipboard: "type the text with browser_human_type",
};

/**
 * Scripts that manipulate input rather than read the page.
 * ⚠️ Patterns, not parsing. See the guard-rail note in this file's header.
 */
const INPUT_MANIPULATION = [
  /\.value\s*=[^=]/,
  /\.checked\s*=[^=]/,
  /\.click\s*\(/,
  /\.focus\s*\(/,
  /\.submit\s*\(/,
  /dispatchEvent\s*\(/,
  /execCommand\s*\(/,
  /new\s+(Mouse|Keyboard|Pointer|Input|Clipboard)Event/,
  /setAttribute\s*\(\s*['"`]value['"`]/,
  /HTMLInputElement\.prototype/,
  /HTMLTextAreaElement\.prototype/,
  /\.setSelectionRange\s*\(/,
  /document\.designMode/,
];

export type GateVerdict = { allowed: true } | { allowed: false; message: string };

/**
 * Decide whether `toolName` may run with these params. Called from the
 * CallTool handler in server.ts, which is the one place every tool call
 * passes through — a per-tool check would be one forgotten import away from
 * a hole nobody notices.
 */
export function gate(toolName: string, params: any): GateVerdict {
  const extensionId = params?.extensionId;
  if (!isHumanMode(extensionId)) return { allowed: true };

  if (SCRIPTED_INPUT_TOOLS.has(toolName)) {
    return {
      allowed: false,
      message:
        `⛔ ${toolName} is refused: profile ${extensionId} is in HUMAN MODE, where input must come from the ` +
        `OS rather than from inside the browser.\n\n` +
        `⇒ Use ${REPLACEMENT[toolName] || "the browser_human_* tools"} instead. Those drive the real X server ` +
        `through xdotool, so the page sees isTrusted hardware events preceded by genuine pointer travel.\n\n` +
        `If this profile should not be in human mode, turn it off: ` +
        `browser_human_mode({ enable: false, extensionId: "${extensionId}" }).`,
    };
  }

  // ⛔ A macro is refused outright, and checking its arguments would have been
  // worse than not checking at all. The script that runs lives in the macro
  // STORE and is fetched at execution time, so the only thing a gate here can
  // see is the parameters — which would have passed a macro whose whole body
  // is `el.value = ...` while reporting that it had checked something.
  if (toolName === "browser_execute_macro") {
    return {
      allowed: false,
      message:
        `⛔ browser_execute_macro is refused: profile ${extensionId} is in HUMAN MODE.\n\n` +
        `The macro body is fetched from the store at execution time, so nothing here can tell a macro that ` +
        `navigates and reads from one that fills a form by assigning to .value. Refusing is the only honest ` +
        `answer; a check on the parameters would pass the second kind while looking like it had checked.\n\n` +
        `⇒ Read it with browser_get_macro and carry out the input steps with browser_human_click / ` +
        `browser_human_type. Everything the macro does that is NOT input you can still do directly.`,
    };
  }

  if (toolName === "browser_evaluate") {
    const text = String(params?.expression ?? "");
    const hit = INPUT_MANIPULATION.find((re) => re.test(text));
    if (hit) {
      return {
        allowed: false,
        message:
          `⛔ ${toolName} is refused: profile ${extensionId} is in HUMAN MODE and this script manipulates input ` +
          `(matched ${hit}).\n\n` +
          `⇒ Reading the DOM is still allowed — measure the element with getBoundingClientRect and then act on it ` +
          `with browser_human_click / browser_human_type, which deliver the event from the OS.\n\n` +
          `⚠️ This is a pattern check, not a parser. It exists to make the scripted path something you have to ` +
          `defeat on purpose, not to be impossible to defeat. Defeating it is not a clever workaround; it is the ` +
          `thing the operator asked to stop.`,
      };
    }
  }

  return { allowed: true };
}

// --------------------------------------------------------------------------- //
// reaching the sidecar
// --------------------------------------------------------------------------- //

/**
 * A display, and the sidecar it belongs to.
 *
 * ⛔ The pair travels together deliberately. With two sidecars configured, a
 * display number alone is ambiguous — both can have a `:90` — so sending input
 * to the right display on the wrong sidecar would drive a DIFFERENT browser and
 * report success. Resolving them in one place makes that unrepresentable.
 */
type Dsp = { display: string; base: string; sidecar: string };

/** extensionId → Xvfb display, read live from the sidecar's own bookkeeping. */
async function displayFor(extensionId: string): Promise<Dsp> {
  const all = listSidecars();
  if (!all.length) {
    throw new Error("UNIBROWSE_CHROMIUM_HOST is unset — human mode needs the chromium-host sidecar");
  }
  const seen: string[] = [];
  // ⛔ MATCH ON THE PROFILE NAME AS WELL AS THE extensionId, and for the same
  // reason the close path has to. A sidecar learns a pid's extensionId only
  // when mcp-server POSTs /processes/<pid>/extension, which happens only if the
  // extension registered while the launch call was still waiting. A browser
  // that registers AFTER the launch returns keeps `extensionId: null` forever —
  // and then EVERY human-input call against it failed with "no live
  // chromium-host process for ext_…", about a browser that was running fine and
  // had a perfectly good display.
  //
  // MEASURED 2026-10-23: this is what blocked a captcha-grid capture on a
  // freshly launched profile, and it is the same root cause as the browsers that
  // could not be closed. The lane's browsers were unaffected only because they
  // happen to register inside the launch window.
  const byProfile = profileNameForExtensionId(extensionId);
  for (const sc of all) {
    let processes: any[] = [];
    try {
      const resp = await fetch(`${sc.url}/processes`);
      if (!resp.ok) { seen.push(`${sc.name}: /processes ${resp.status}`); continue; }
      processes = ((await resp.json()) as any).processes || [];
    } catch (e: any) {
      seen.push(`${sc.name}: ${e.message}`);
      continue;
    }
    let match = processes.find((p: any) => p.extensionId === extensionId && p.alive);
    // ⚠️ Only ever as a FALLBACK, and only for a process with no extensionId of
    // its own. A process that reports a DIFFERENT extensionId is a different
    // browser that happens to share a profile name, and driving a pointer into
    // it would be the exact cross-browser mix-up displayFor exists to prevent.
    if (!match && byProfile) {
      match = processes.find((p: any) => p.profileName === byProfile && p.alive && !p.extensionId);
    }
    if (!match) {
      seen.push(`${sc.name}: ${processes.map((p: any) => `${p.profileName}=${p.extensionId ?? "-"}`).join(", ") || "(none)"}`);
      continue;
    }
    if (!match.display) throw new Error(`profile ${match.profileName} is headless — no display to drive`);
    return { display: match.display, base: sc.url, sidecar: sc.name };
  }
  throw new Error(
    `no live chromium-host process for ${extensionId} on any configured sidecar. Human input needs that ` +
    `profile's Xvfb display, so this only works on a sidecar profile, never on office's desktop Chrome. ` +
    (byProfile
      ? `That id was minted for profile ${JSON.stringify(byProfile)}, and no sidecar reports a live process for it either. `
      : `No identity file claims that id, so it was not minted by this server. `) +
    `Asked ${all.map((s) => s.name).join(", ")} — ${seen.join(" | ")}`,
  );
}

async function sendInput(d: Dsp, body: Record<string, any>): Promise<any> {
  const resp = await fetch(`${d.base}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display: d.display, ...body }),
  });
  const json = (await resp.json()) as any;
  if (!json?.ok) throw new Error(json?.error || `chromium-host /input returned ${resp.status}`);
  return json;
}

/**
 * Viewport point → screen point.
 *
 * ⭐ MEASURED 2026-10-23, and it is not guessable from the window object alone:
 *   offX = screenX + (outerWidth - innerWidth) / 2     (window chrome, split L/R)
 *   offY = screenY + (outerHeight - innerHeight)       (title bar + toolbars, all on top)
 * ⚠️ Only valid while the tab is ACTIVE — an inactive tab reports its window's
 * geometry perfectly well and the pointer still goes to whatever is on screen.
 */
const GEOMETRY_JS = `(() => {
  const w = window;
  return {
    innerWidth: w.innerWidth, innerHeight: w.innerHeight,
    devicePixelRatio: w.devicePixelRatio,
    outerWidth: w.outerWidth, outerHeight: w.outerHeight,
    screenX: w.screenX, screenY: w.screenY,
  };
})()`;

function rectJs(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return {
      found: true, x: r.x, y: r.y, width: r.width, height: r.height,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2,
      visible: r.width > 0 && r.height > 0,
      inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      tag: el.tagName, disabled: !!el.disabled,
    };
  })()`;
}

async function pageEval(context: any, params: any, expression: string): Promise<any> {
  const r: any = await context.sendSocketMessage("browser_evaluate", {
    expression,
    tabTarget: params?.tabTarget,
    extensionId: params?.extensionId,
    agent: params?.agent,
    takeover: params?.takeover,
  });
  return r?.result ?? r;
}

/**
 * Resolve where on the SCREEN to act, and make sure the tab is the active one.
 * ⛔ The switch is not optional. OS input lands wherever the pointer is; naming
 * a tabTarget steers our measurement, not the mouse.
 */
async function resolveTarget(display: Dsp, context: any, params: any): Promise<{ sx: number; sy: number; width?: number; note?: string }> {
  await context.ensureAttachedFromParams(params);
  try {
    await context.sendSocketMessage("browser_switch_tab", {
      tabTarget: params?.tabTarget,
      extensionId: params?.extensionId,
      agent: params?.agent,
      takeover: params?.takeover,
    });
  } catch (e: any) {
    // Reported, never swallowed: if the tab could not be raised, the click is
    // about to land somewhere we did not measure.
    throw new Error(`could not switch to the target tab, so OS input would land in whatever IS active: ${e.message}`);
  }

  const geo = await pageEval(context, params, GEOMETRY_JS);
  let vx = params?.x;
  let vy = params?.y;
  let width = params?.width;
  let note: string | undefined;

  if (params?.selector) {
    const rect = await pageEval(context, params, rectJs(params.selector));
    if (!rect?.found) throw new Error(`selector ${params.selector} matched nothing`);
    if (!rect.visible) throw new Error(`selector ${params.selector} has a zero-sized rect — it is not rendered`);
    if (!rect.inViewport) {
      throw new Error(
        `${params.selector} is outside the viewport (rect y=${Math.round(rect.y)}, viewport height ${geo.innerHeight}). ` +
        `Scroll it in with browser_human_scroll and RE-READ the rect — a rect measured before a scroll is already stale.`,
      );
    }
    vx = rect.cx;
    vy = rect.cy;
    if (width == null) width = Math.max(4, Math.min(rect.width, rect.height));
    if (rect.disabled) note = `⚠️ ${params.selector} is disabled; the click will land on it and do nothing.`;
  }

  if (typeof vx !== "number" || typeof vy !== "number") {
    throw new Error("pass either selector, or both x and y");
  }
  if (vx < 0 || vy < 0 || vx > geo.innerWidth || vy > geo.innerHeight) {
    throw new Error(
      `(${Math.round(vx)},${Math.round(vy)}) is outside the ${geo.innerWidth}x${geo.innerHeight} viewport. ` +
      `A point below the fold hit-tests to whatever occupies that screen position, which is a different element.`,
    );
  }

  // ⚠️ devicePixelRatio: CSS pixels are what the page reports and X wants
  // device pixels. They are equal on the sidecars (dpr 1, measured), so this
  // multiplies by 1 there — it is here so a HiDPI display does not silently
  // land every click at a fraction of the intended position.
  const dpr = geo.devicePixelRatio || 1;
  const { offX, offY, basis } = await viewportOrigin(display, geo);
  const sx = Math.round(offX + vx * dpr);
  const sy = Math.round(offY + vy * dpr);
  if (sx < 0 || sy < 0) {
    throw new Error(
      `computed a negative screen point (${sx},${sy}) from origin (${offX},${offY}) via ${basis}. ` +
      `Refusing rather than clicking — xdotool clamps to 0 and reports success, so this would look like it worked.`,
    );
  }
  return { sx, sy, width, note };
}

/**
 * Where the viewport's top-left sits on the SCREEN.
 *
 * ⛔ ASK THE X SERVER, NOT THE PAGE. Measured 2026-10-23 on a sidecar chromium:
 * `outerWidth`/`outerHeight` read 0 and `screenX`/`screenY` read 0, so the
 * documented `screenX + (outerWidth - innerWidth) / 2` gives (-525, -861) for a
 * 1050x861 viewport. Every click would land off the display, and nothing would
 * report a failure — xdotool clamps to 0 and exits 0.
 *
 * The page's own numbers are used only when the X server cannot answer, and
 * only when they are self-consistent (a non-zero outer size).
 */
async function viewportOrigin(display: Dsp, geo: any): Promise<{ offX: number; offY: number; basis: string }> {
  try {
    const win = await sendInput(display, { action: "window" });
    return {
      offX: win.x + (win.width - geo.innerWidth) / 2,
      offY: win.y + (win.height - geo.innerHeight),
      basis: `X window ${win.windowId} at (${win.x},${win.y}) ${win.width}x${win.height}`,
    };
  } catch (e: any) {
    if (geo.outerWidth > 0 && geo.outerHeight > 0) {
      return {
        offX: geo.screenX + (geo.outerWidth - geo.innerWidth) / 2,
        offY: geo.screenY + (geo.outerHeight - geo.innerHeight),
        basis: `page geometry (X server unavailable: ${e.message})`,
      };
    }
    throw new Error(
      `cannot locate the viewport on screen: the X server did not answer (${e.message}) and the page reports ` +
      `outerWidth/outerHeight of 0, which makes its own offsets meaningless.`,
    );
  }
}

// --------------------------------------------------------------------------- //
// tools
// --------------------------------------------------------------------------- //

function needExtension(params: any): string {
  const id = params?.extensionId;
  if (!id) {
    throw new Error(
      "extensionId is required for human input: it is what names the profile whose display we drive. " +
      "Take it from browser_list_attached_tabs's `extensions` array.",
    );
  }
  return id;
}

export const humanMode: Tool = {
  schema: {
    name: HumanModeTool.shape.name.value,
    description: HumanModeTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanModeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const v = HumanModeTool.shape.arguments.parse(params);
      const state = readState();

      if (v.list || v.enable === undefined) {
        return jsonResponse({
          humanMode: Object.entries(state.extensions).map(([id, meta]) => ({ extensionId: id, ...meta })),
          default: "off",
          stateFile: STATE_FILE,
        }, true, max_tokens);
      }

      const extensionId = v.extensionId;
      if (!extensionId) return errorResponse("extensionId is required when enabling or disabling", false, undefined, max_tokens);

      if (v.enable) {
        // Refuse a profile we could not actually serve — see the header.
        try {
          await displayFor(extensionId);
        } catch (e: any) {
          return errorResponse(
            `Not turning human mode on for ${extensionId}: ${e.message}\n\n` +
            `Human mode without a display refuses every input tool and offers nothing in their place, ` +
            `which would leave that profile unable to do anything at all.`,
            false, undefined, max_tokens,
          );
        }
        state.extensions[extensionId] = { since: new Date().toISOString(), by: (params as any)?.agent };
      } else {
        delete state.extensions[extensionId];
      }
      writeState(state);

      return jsonResponse({
        extensionId,
        humanMode: !!state.extensions[extensionId],
        inHumanMode: Object.keys(state.extensions),
        message: v.enable
          ? `Human mode ON for ${extensionId}. Scripted input tools are now refused for this profile; ` +
            `use browser_human_click / type / scroll / move / key.`
          : `Human mode OFF for ${extensionId}. The scripted input tools work again.`,
      }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_mode failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const humanClick: Tool = {
  schema: {
    name: HumanClickTool.shape.name.value,
    description: HumanClickTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanClickTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const extensionId = needExtension(params);
      const display = await displayFor(extensionId);
      const t = await resolveTarget(display, context, params);
      const r = await sendInput(display, {
        action: "click", x: t.sx, y: t.sy, width: t.width, button: (params as any)?.button || 1,
      });
      return jsonResponse({ ...r, display: display.display, sidecar: display.sidecar, screen: { x: t.sx, y: t.sy }, note: t.note }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_click failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const humanMove: Tool = {
  schema: {
    name: HumanMoveTool.shape.name.value,
    description: HumanMoveTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanMoveTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const extensionId = needExtension(params);
      const display = await displayFor(extensionId);
      const t = await resolveTarget(display, context, params);
      const r = await sendInput(display, { action: "move", x: t.sx, y: t.sy, width: t.width });
      return jsonResponse({ ...r, display: display.display, sidecar: display.sidecar, screen: { x: t.sx, y: t.sy }, note: t.note }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_move failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const humanType: Tool = {
  schema: {
    name: HumanTypeTool.shape.name.value,
    description: HumanTypeTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanTypeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const v = HumanTypeTool.shape.arguments.parse(params);
      const extensionId = needExtension(params);
      const display = await displayFor(extensionId);

      let clicked: any = null;
      if (v.selector) {
        const t = await resolveTarget(display, context, params);
        clicked = await sendInput(display, { action: "click", x: t.sx, y: t.sy, width: t.width, button: 1 });
      } else {
        // Still raise the tab: typing goes to whatever the X server thinks is
        // focused, which is a property of the screen, not of tabTarget.
        await resolveTargetTabOnly(context, params);
      }

      const r = await sendInput(display, { action: "type", text: v.text, sensitive: !!v.sensitive });
      if (v.pressEnter) await sendInput(display, { action: "key", key: "Return" });
      return jsonResponse({ ...r, display: display.display, sidecar: display.sidecar, focusedBy: clicked ? v.selector : "whatever already had focus", pressedEnter: !!v.pressEnter }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_type failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const humanDrag: Tool = {
  schema: {
    name: HumanDragTool.shape.name.value,
    description: HumanDragTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanDragTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const extensionId = needExtension(params);
      const display = await displayFor(extensionId);
      const from = await resolveTarget(display, context, params);
      // ⛔ Resolve the drop point through the same path, so it gets the same
      // viewport check. A drop point below the fold lands on whatever occupies
      // that screen position, and xdotool would report success either way.
      const to = await resolveTarget(display, context, {
        ...params,
        selector: (params as any)?.toSelector,
        x: (params as any)?.toX,
        y: (params as any)?.toY,
        width: undefined,
      });
      const r = await sendInput(display, {
        action: "drag",
        fromX: from.sx, fromY: from.sy,
        x: to.sx, y: to.sy,
        width: from.width,
      });
      return jsonResponse({
        ...r, display: display.display, sidecar: display.sidecar,
        screen: { from: { x: from.sx, y: from.sy }, to: { x: to.sx, y: to.sy } },
        note: [from.note, to.note].filter(Boolean).join(" ") || undefined,
      }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_drag failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const humanScroll: Tool = {
  schema: {
    name: HumanScrollTool.shape.name.value,
    description: HumanScrollTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanScrollTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const v = HumanScrollTool.shape.arguments.parse(params);
      const extensionId = needExtension(params);
      const display = await displayFor(extensionId);
      await resolveTargetTabOnly(context, params);
      const r = await sendInput(display, { action: "scroll", notches: v.notches });
      return jsonResponse({ ...r, display: display.display, sidecar: display.sidecar }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_scroll failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const humanKey: Tool = {
  schema: {
    name: HumanKeyTool.shape.name.value,
    description: HumanKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(HumanKeyTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const v = HumanKeyTool.shape.arguments.parse(params);
      const extensionId = needExtension(params);
      const display = await displayFor(extensionId);
      await resolveTargetTabOnly(context, params);
      const r = await sendInput(display, { action: "key", key: v.key, repeat: v.repeat || 1 });
      return jsonResponse({ ...r, display: display.display, sidecar: display.sidecar }, true, max_tokens);
    } catch (error: any) {
      return errorResponse(`browser_human_key failed: ${error.message}`, false, error, max_tokens);
    }
  },
};

/** Raise the tab without measuring anything — for keyboard and wheel input. */
async function resolveTargetTabOnly(context: any, params: any): Promise<void> {
  await context.ensureAttachedFromParams(params);
  await context.sendSocketMessage("browser_switch_tab", {
    tabTarget: params?.tabTarget,
    extensionId: params?.extensionId,
    agent: params?.agent,
    takeover: params?.takeover,
  });
}
