import { zodToJsonSchema } from "zod-to-json-schema";

import { GetErrorsTool, ReloadExtensionTool } from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";

import { Tool } from "./tool";

export const getErrors: Tool = {
  schema: {
    name: GetErrorsTool.shape.name.value,
    description: GetErrorsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetErrorsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetErrorsTool.shape.arguments.parse(params || {});
      const result = await context.sendSocketMessage("browser_get_errors", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get errors: ${error.message}`, false, error, max_tokens);
    }
  },
};

export const reloadExtension: Tool = {
  schema: {
    name: ReloadExtensionTool.shape.name.value,
    description: ReloadExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema(ReloadExtensionTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const result = await context.sendSocketMessage("browser_reload_extension", {});
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to reload extension: ${error.message}`, false, error, max_tokens);
    }
  },
};
