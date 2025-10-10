import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GetClipboardTool,
  SetClipboardTool,
} from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Read text from the clipboard
 * Retrieves the current text content from the system clipboard. Requires the clipboard
 * permission. Useful for reading pasted content or programmatically accessing clipboard data.
 */
export const getClipboard: Tool = {
  schema: {
    name: GetClipboardTool.shape.name.value,
    description: GetClipboardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetClipboardTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetClipboardTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_clipboard", validatedParams);
      return textResponse(result.text);
    } catch (error) {
      return errorResponse(`Failed to get clipboard: ${error.message}`, false, error);
    }
  },
};

/**
 * Write text to the clipboard
 * Writes the specified text to the system clipboard, replacing any existing content.
 * Requires the clipboard permission. Useful for copying data programmatically or
 * enabling copy-to-clipboard functionality.
 */
export const setClipboard: Tool = {
  schema: {
    name: SetClipboardTool.shape.name.value,
    description: SetClipboardTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetClipboardTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SetClipboardTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_clipboard", validatedParams);
      return textResponse(`Clipboard set to: ${validatedParams.text.substring(0, 50)}${validatedParams.text.length > 50 ? '...' : ''}`);
    } catch (error) {
      return errorResponse(`Failed to set clipboard: ${error.message}`, false, error);
    }
  },
};
