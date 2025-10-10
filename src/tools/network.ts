import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetNetworkStateTool,
  SetNetworkConditionsTool,
  ClearCacheTool,
} from "@/types/tool-schemas";
import { jsonResponse, textResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

/**
 * Get current network connection state
 * Retrieves information about the current network connection including
 * online/offline status and connection type. Useful for testing network-dependent
 * features and handling offline scenarios.
 */
export const getNetworkState: Tool = {
  schema: {
    name: GetNetworkStateTool.shape.name.value,
    description: GetNetworkStateTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetNetworkStateTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetNetworkStateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_network_state", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get network state: ${error.message}`, false, error);
    }
  },
};

/**
 * Set network throttling conditions
 * Configures network throttling to simulate different network conditions such as
 * slow 3G, fast 3G, or offline mode. Useful for testing application behavior
 * under various network conditions. Parameters control latency and throughput.
 */
export const setNetworkConditions: Tool = {
  schema: {
    name: SetNetworkConditionsTool.shape.name.value,
    description: SetNetworkConditionsTool.shape.description.value,
    inputSchema: zodToJsonSchema(SetNetworkConditionsTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SetNetworkConditionsTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_set_network_conditions", validatedParams);
      return textResponse("Network conditions updated successfully");
    } catch (error) {
      return errorResponse(`Failed to set network conditions: ${error.message}`, false, error);
    }
  },
};

/**
 * Clear browser cache
 * Clears the browser's cache storage to free up disk space or ensure
 * fresh content is loaded. By default clears all cache storage.
 * Useful for testing cache behavior and troubleshooting caching issues.
 */
export const clearCache: Tool = {
  schema: {
    name: ClearCacheTool.shape.name.value,
    description: ClearCacheTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClearCacheTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = ClearCacheTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_clear_cache", validatedParams);
      return textResponse("Cache cleared successfully");
    } catch (error) {
      return errorResponse(`Failed to clear cache: ${error.message}`, false, error);
    }
  },
};
