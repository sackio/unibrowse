import zodToJsonSchema from "zod-to-json-schema";

import {
  FillFormTool,
  SubmitFormTool,
} from "@/types/tool-schemas";

import type { Context } from "@/context";

import type { Tool } from "./tool";

export const fillForm: Tool = {
  schema: {
    name: FillFormTool.shape.name.value,
    description: FillFormTool.shape.description.value,
    inputSchema: zodToJsonSchema(FillFormTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = FillFormTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_fill_form", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Filled ${validatedParams.fields.length} form fields`,
        },
      ],
    };
  },
};

export const submitForm: Tool = {
  schema: {
    name: SubmitFormTool.shape.name.value,
    description: SubmitFormTool.shape.description.value,
    inputSchema: zodToJsonSchema(SubmitFormTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = SubmitFormTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_submit_form", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Submitted form "${validatedParams.element}"`,
        },
      ],
    };
  },
};
