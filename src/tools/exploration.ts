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
import { textResponse, jsonResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Query DOM elements by CSS selector
 * Searches for elements matching a CSS selector and returns basic information about them
 * without building a full ARIA tree. Returns up to a specified limit of matching elements
 * with their tag names, text content, and attributes.
 */
export const queryDOM: Tool = {
  schema: {
    name: QueryDOMTool.shape.name.value,
    description: QueryDOMTool.shape.description.value,
    inputSchema: zodToJsonSchema(QueryDOMTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = QueryDOMTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_query_dom", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to query DOM: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get visible text content from the page
 * Extracts all visible text from the page or a specific element. Optionally limits
 * the length of returned text. Useful for understanding page content without full
 * HTML structure. Returns only text that is actually visible to users.
 */
export const getVisibleText: Tool = {
  schema: {
    name: GetVisibleTextTool.shape.name.value,
    description: GetVisibleTextTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetVisibleTextTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetVisibleTextTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_visible_text", validatedParams);
      return typeof result === "string" ? textResponse(result, max_tokens) : jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get visible text: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get computed CSS styles for an element
 * Retrieves the final computed CSS property values for a specified element after all
 * stylesheets and inline styles are applied. Can request specific properties or get
 * common layout properties by default. Useful for understanding visual state.
 */
export const getComputedStyles: Tool = {
  schema: {
    name: GetComputedStylesTool.shape.name.value,
    description: GetComputedStylesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetComputedStylesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetComputedStylesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_computed_styles", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get computed styles: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Check element visibility state
 * Determines if an element is visible, hidden, in the viewport, or has a specific display
 * state. Returns detailed visibility information including whether the element is displayed,
 * its opacity, and viewport position. Essential for conditional interactions.
 */
export const checkVisibility: Tool = {
  schema: {
    name: CheckVisibilityTool.shape.name.value,
    description: CheckVisibilityTool.shape.description.value,
    inputSchema: zodToJsonSchema(CheckVisibilityTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = CheckVisibilityTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_check_visibility", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to check visibility: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get element attributes
 * Retrieves all HTML attributes or specific requested attributes from an element.
 * Returns attribute names and values as key-value pairs. Useful for extracting
 * data attributes, IDs, classes, href values, and other element properties.
 */
export const getAttributes: Tool = {
  schema: {
    name: GetAttributesTool.shape.name.value,
    description: GetAttributesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetAttributesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetAttributesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_attributes", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get attributes: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Count elements matching a CSS selector
 * Returns the total number of elements on the page that match the given CSS selector.
 * Useful for checking how many instances of a particular element exist before attempting
 * operations, or for understanding page structure.
 */
export const countElements: Tool = {
  schema: {
    name: CountElementsTool.shape.name.value,
    description: CountElementsTool.shape.description.value,
    inputSchema: zodToJsonSchema(CountElementsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = CountElementsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_count_elements", validatedParams);
      return textResponse(`Found ${result} elements matching selector "${validatedParams.selector}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to count elements: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get page metadata
 * Extracts comprehensive page metadata including title, description, Open Graph tags,
 * Twitter Card tags, canonical URLs, and schema.org structured data. Essential for
 * understanding page purpose, content, and SEO configuration.
 */
export const getPageMetadata: Tool = {
  schema: {
    name: GetPageMetadataTool.shape.name.value,
    description: GetPageMetadataTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetPageMetadataTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetPageMetadataTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_page_metadata", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get page metadata: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get filtered ARIA accessibility tree
 * Returns a filtered accessibility tree with options to reduce token usage. Can filter
 * by ARIA roles, show only interactive elements, or limit tree depth. More efficient
 * than full page snapshot when you need specific accessibility information.
 */
export const getFilteredAriaTree: Tool = {
  schema: {
    name: GetFilteredAriaTreeTool.shape.name.value,
    description: GetFilteredAriaTreeTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetFilteredAriaTreeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetFilteredAriaTreeTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_filtered_aria_tree", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get filtered ARIA tree: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Find elements containing specific text
 * Searches for elements that contain the specified text content. Supports both exact
 * matching and partial (case-insensitive) matching. Can limit search scope with an
 * optional CSS selector. Returns matching elements with their selectors and text.
 */
export const findByText: Tool = {
  schema: {
    name: FindByTextTool.shape.name.value,
    description: FindByTextTool.shape.description.value,
    inputSchema: zodToJsonSchema(FindByTextTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = FindByTextTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_find_by_text", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to find by text: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get current values of form fields
 * Retrieves the current values of all form fields on the page or within a specific form.
 * Returns field names, types (input/select/textarea), and their current values. Useful
 * for validating form state before submission or extracting user input.
 */
export const getFormValues: Tool = {
  schema: {
    name: GetFormValuesTool.shape.name.value,
    description: GetFormValuesTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetFormValuesTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetFormValuesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_form_values", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get form values: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Check element interactive state
 * Determines the interactive state of form elements and interactive controls. Returns
 * whether the element is enabled/disabled, checked/unchecked, selected, readonly, required,
 * or in other specific states. Essential for form validation and conditional interactions.
 */
export const checkElementState: Tool = {
  schema: {
    name: CheckElementStateTool.shape.name.value,
    description: CheckElementStateTool.shape.description.value,
    inputSchema: zodToJsonSchema(CheckElementStateTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = CheckElementStateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_check_element_state", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to check element state: ${error.message}`, false, error, max_tokens);
    }
  },
};
