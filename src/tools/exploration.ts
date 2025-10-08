import { zodToJsonSchema } from "zod-to-json-schema";

import {
  QueryDOMTool,
  GetVisibleTextTool,
  GetComputedStylesTool,
  CheckVisibilityTool,
  GetAttributesTool,
  CountElementsTool,
  GetPageMetadataTool,
  GetFilteredAriaTreeTool,
  FindByTextTool,
  GetFormValuesTool,
  CheckElementStateTool,
} from "@/types/tool-schemas";

import type { Tool } from "./tool";

// Query DOM elements by CSS selector
export const queryDOM: Tool = {
  schema: {
    name: QueryDOMTool.shape.name.value,
    description: QueryDOMTool.shape.description.value,
    inputSchema: zodToJsonSchema(QueryDOMTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = QueryDOMTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_query_dom", validatedParams);
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

// Get visible text content
export const getVisibleText: Tool = {
  schema: {
    name: GetVisibleTextTool.shape.name.value,
    description: GetVisibleTextTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetVisibleTextTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = GetVisibleTextTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_visible_text", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};

// Get computed CSS styles
export const getComputedStyles: Tool = {
  schema: {
    name: GetComputedStylesTool.shape.name.value,
    description: GetComputedStylesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetComputedStylesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = GetComputedStylesTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_computed_styles", validatedParams);
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

// Check element visibility
export const checkVisibility: Tool = {
  schema: {
    name: CheckVisibilityTool.shape.name.value,
    description: CheckVisibilityTool.shape.description.value,
    inputSchema: zodToJsonSchema(CheckVisibilityTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = CheckVisibilityTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_check_visibility", validatedParams);
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

// Get element attributes
export const getAttributes: Tool = {
  schema: {
    name: GetAttributesTool.shape.name.value,
    description: GetAttributesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetAttributesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = GetAttributesTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_attributes", validatedParams);
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

// Count elements matching selector
export const countElements: Tool = {
  schema: {
    name: CountElementsTool.shape.name.value,
    description: CountElementsTool.shape.description.value,
    inputSchema: zodToJsonSchema(CountElementsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = CountElementsTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_count_elements", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Found ${result} elements matching selector "${validatedParams.selector}"`,
        },
      ],
    };
  },
};

// Get page metadata
export const getPageMetadata: Tool = {
  schema: {
    name: GetPageMetadataTool.shape.name.value,
    description: GetPageMetadataTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetPageMetadataTool.shape.arguments),
  },
  handle: async (context, params) => {
    GetPageMetadataTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_page_metadata", {});
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

// Get filtered ARIA tree
export const getFilteredAriaTree: Tool = {
  schema: {
    name: GetFilteredAriaTreeTool.shape.name.value,
    description: GetFilteredAriaTreeTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetFilteredAriaTreeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = GetFilteredAriaTreeTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_filtered_aria_tree", validatedParams);
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

// Find elements by text
export const findByText: Tool = {
  schema: {
    name: FindByTextTool.shape.name.value,
    description: FindByTextTool.shape.description.value,
    inputSchema: zodToJsonSchema(FindByTextTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = FindByTextTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_find_by_text", validatedParams);
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

// Get form field values
export const getFormValues: Tool = {
  schema: {
    name: GetFormValuesTool.shape.name.value,
    description: GetFormValuesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetFormValuesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = GetFormValuesTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_form_values", validatedParams);
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

// Check element state
export const checkElementState: Tool = {
  schema: {
    name: CheckElementStateTool.shape.name.value,
    description: CheckElementStateTool.shape.description.value,
    inputSchema: zodToJsonSchema(CheckElementStateTool.shape.arguments),
  },
  handle: async (context, params) => {
    const validatedParams = CheckElementStateTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_check_element_state", validatedParams);
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
