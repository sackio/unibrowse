import zodToJsonSchema from "zod-to-json-schema";

import {
  FillFormTool,
  SubmitFormTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Fill multiple form fields at once
 * Fills multiple form fields in a single operation. Accepts an array of field objects
 * with element descriptions, references, and values. More efficient than filling fields
 * individually. Supports all standard input types including text, checkboxes, radio buttons,
 * selects, and textareas.
 */
export const fillForm: Tool = {
  schema: {
    name: FillFormTool.shape.name.value,
    description: FillFormTool.shape.description.value,
    inputSchema: zodToJsonSchema(FillFormTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = FillFormTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_fill_form", validatedParams);
      return textResponse(`Filled ${validatedParams.fields.length} form fields`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to fill form: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Submit a form
 * Submits the specified form element, triggering form validation and submission events.
 * Requires a reference to the form element (typically obtained from a snapshot). Will
 * trigger any onsubmit handlers and form validation configured on the form.
 */
export const submitForm: Tool = {
  schema: {
    name: SubmitFormTool.shape.name.value,
    description: SubmitFormTool.shape.description.value,
    inputSchema: zodToJsonSchema(SubmitFormTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = SubmitFormTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_submit_form", validatedParams);
      return textResponse(`Submitted form "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to submit form: ${error.message}`, false, error, max_tokens);
    }
  },
};
