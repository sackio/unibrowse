import { zodToJsonSchema } from "zod-to-json-schema";

import { ListFramesTool } from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";

import { Tool } from "./tool";

/**
 * List all frames (iframes) in the current page.
 * Returns frameId, URL, parentFrameId, name, and best-effort iframeSelector.
 * Use the frameId values with other tools' frameTarget parameter to operate inside frames.
 */
export const listFrames: Tool = {
  schema: {
    name: ListFramesTool.shape.name.value,
    description: ListFramesTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListFramesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = ListFramesTool.shape.arguments.parse(params || {});
      const result = await context.sendSocketMessage("browser_list_frames", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to list frames: ${error.message}`, false, error, max_tokens);
    }
  },
};
