import { zodToJsonSchema } from "zod-to-json-schema";

import {
  RealisticMouseMoveTool,
  RealisticClickTool,
  RealisticTypeTool,
} from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

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
      await context.ensureAttached();
      const validatedParams = RealisticMouseMoveTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_realistic_mouse_move", validatedParams);

      return textResponse(result.message || `Moved mouse to (${validatedParams.x}, ${validatedParams.y}, max_tokens)`);
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
      await context.ensureAttached();
      const validatedParams = RealisticClickTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_realistic_click", validatedParams);

      return textResponse(result.message || `Clicked at (${validatedParams.x}, ${validatedParams.y}, max_tokens)`);
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
      await context.ensureAttached();
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
