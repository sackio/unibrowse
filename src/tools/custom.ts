import { zodToJsonSchema } from "zod-to-json-schema";

import {
  EvaluateTool,
  GetConsoleLogsTool,
  GetNetworkLogsTool,
  ScreenshotTool,
} from "@/types/tool-schemas";

import { Tool } from "./tool";

export const getConsoleLogs: Tool = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetConsoleLogsTool.shape.arguments),
  },
  handle: async (context, _params) => {
    const consoleLogs = await context.sendSocketMessage(
      "browser_get_console_logs",
      {},
    );
    const text: string = consoleLogs
      .map((log) => JSON.stringify(log))
      .join("\n");
    return {
      content: [{ type: "text", text }],
    };
  },
};

export const screenshot: Tool = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScreenshotTool.shape.arguments),
  },
  handle: async (context, _params) => {
    const screenshot = await context.sendSocketMessage(
      "browser_screenshot",
      {},
    );
    return {
      content: [
        {
          type: "image",
          data: screenshot,
          mimeType: "image/png",
        },
      ],
    };
  },
};

export const evaluate: Tool = {
  schema: {
    name: EvaluateTool.shape.name.value,
    description: EvaluateTool.shape.description.value,
    inputSchema: zodToJsonSchema(EvaluateTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = EvaluateTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage(
      "browser_evaluate",
      validatedParams,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};

export const getNetworkLogs: Tool = {
  schema: {
    name: GetNetworkLogsTool.shape.name.value,
    description: GetNetworkLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetNetworkLogsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = GetNetworkLogsTool.shape.arguments.parse(params);
    const networkLogs = await context.sendSocketMessage(
      "browser_get_network_logs",
      validatedParams,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(networkLogs, null, 2),
        },
      ],
    };
  },
};
