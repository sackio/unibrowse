import zodToJsonSchema from "zod-to-json-schema";

import {
  CloseTabTool,
  CreateTabTool,
  ListTabsTool,
  SwitchTabTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";

import type { Tool } from "./tool";

export const listTabs: Tool = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListTabsTool.shape.arguments),
  },
  handle: async (context: Context) => {
    const tabs = await context.sendSocketMessage("browser_list_tabs", {});
    return {
      content: [
        {
          type: "text",
          text: `Open tabs:\n${JSON.stringify(tabs, null, 2)}`,
        },
      ],
    };
  },
};

export const switchTab: Tool = {
  schema: {
    name: SwitchTabTool.shape.name.value,
    description: SwitchTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(SwitchTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = SwitchTabTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_switch_tab", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Switched to tab ${validatedParams.tabId}`,
        },
      ],
    };
  },
};

export const createTab: Tool = {
  schema: {
    name: CreateTabTool.shape.name.value,
    description: CreateTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(CreateTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = CreateTabTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage(
      "browser_create_tab",
      validatedParams
    );
    return {
      content: [
        {
          type: "text",
          text: `Created new tab ${result.tabId}${validatedParams.url ? ` at ${validatedParams.url}` : ""}`,
        },
      ],
    };
  },
};

export const closeTab: Tool = {
  schema: {
    name: CloseTabTool.shape.name.value,
    description: CloseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema(CloseTabTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = CloseTabTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_close_tab", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Closed tab ${validatedParams.tabId}`,
        },
      ],
    };
  },
};
