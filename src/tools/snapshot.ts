import zodToJsonSchema from "zod-to-json-schema";

import {
  ClickTool,
  DragTool,
  HoverTool,
  SelectOptionTool,
  SnapshotTool,
  TypeTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";
import { captureAriaSnapshot } from "@/utils/aria-snapshot";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Capture accessibility snapshot of the current page
 * Returns a text representation of the page's accessibility tree, useful for understanding
 * page structure and finding elements to interact with.
 */
export const snapshot: Tool = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema(SnapshotTool.shape.arguments),
  },
  handle: async (context: Context) => {
    try {
      await context.ensureAttached();
      return await captureAriaSnapshot(context);
    } catch (error) {
      return errorResponse(`Failed to capture snapshot: ${error.message}`, false, error);
    }
  },
};

/**
 * Click an element on the page
 * Performs a mouse click on the specified element. Supports different button types (left/right/middle)
 * and modifier keys (Shift, Ctrl, Alt, Meta).
 */
export const click: Tool = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema(ClickTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = ClickTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_click", validatedParams);
      return textResponse(`Clicked "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to click element: ${error.message}`, false, error);
    }
  },
};

/**
 * Drag and drop an element to another element
 * Performs a drag operation from a source element to a target element, simulating
 * user drag-and-drop interactions.
 */
export const drag: Tool = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema(DragTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = DragTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_drag", validatedParams);
      return textResponse(`Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`);
    } catch (error) {
      return errorResponse(`Failed to drag element: ${error.message}`, false, error);
    }
  },
};

/**
 * Hover over an element
 * Moves the mouse cursor over the specified element, triggering hover effects and
 * revealing hidden UI elements that appear on hover.
 */
export const hover: Tool = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema(HoverTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = HoverTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_hover", validatedParams);
      return textResponse(`Hovered over "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to hover over element: ${error.message}`, false, error);
    }
  },
};

/**
 * Type text into an input element
 * Enters text into an editable element (input, textarea, contenteditable) and optionally
 * submits the form by pressing Enter.
 */
export const type: Tool = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema(TypeTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = TypeTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_type", validatedParams);
      return textResponse(`Typed "${validatedParams.text}" into "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to type into element: ${error.message}`, false, error);
    }
  },
};

/**
 * Select an option from a dropdown
 * Selects one or more options from a select element (dropdown) by their values.
 * Supports both single and multi-select dropdowns.
 */
export const selectOption: Tool = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema(SelectOptionTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SelectOptionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_select_option", validatedParams);
      return textResponse(`Selected option in "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to select option: ${error.message}`, false, error);
    }
  },
};
