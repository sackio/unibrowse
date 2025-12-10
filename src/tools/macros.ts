import { zodToJsonSchema } from "zod-to-json-schema";
import { v4 as uuidv4 } from "uuid";

import {
  StoreMacroTool,
  ListMacrosTool,
  ExecuteMacroTool,
  UpdateMacroTool,
  DeleteMacroTool,
} from "@/types/tool-schemas";
import { textResponse, jsonResponse, errorResponse } from "@/utils/response-helpers";
import { mongodb } from "@/utils/mongodb";

import { Tool } from "./tool";

/**
 * Store a new executable JavaScript macro
 */
export const storeMacro: Tool = {
  schema: {
    name: StoreMacroTool.shape.name.value,
    description: StoreMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(StoreMacroTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      // Ensure MongoDB is connected
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = StoreMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();

      // Check if macro with same site+name already exists
      const existing = await macros.findOne({
        site: validatedParams.site,
        name: validatedParams.name,
      });

      if (existing) {
        return errorResponse(
          `Macro "${validatedParams.name}" already exists for site "${validatedParams.site}". Use browser_update_macro to update it.`,
          true
        );
      }

      // Create new macro document
      const now = new Date();
      const macroDoc = {
        id: uuidv4(),
        site: validatedParams.site,
        category: validatedParams.category,
        name: validatedParams.name,
        description: validatedParams.description,
        parameters: validatedParams.parameters,
        code: validatedParams.code,
        returnType: validatedParams.returnType,
        version: "1.0.0",
        createdAt: now,
        updatedAt: now,
        lastVerified: now,
        reliability: validatedParams.reliability || "untested",
        tags: validatedParams.tags || [],
        usageCount: 0,
        successRate: 0,
      };

      await macros.insertOne(macroDoc);

      return jsonResponse({
        success: true,
        id: macroDoc.id,
        message: `Macro "${validatedParams.name}" stored successfully`,
        macro: {
          id: macroDoc.id,
          site: macroDoc.site,
          category: macroDoc.category,
          name: macroDoc.name,
          description: macroDoc.description,
        },
      });
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to store macro: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * List available macros with filtering
 */
export const listMacros: Tool = {
  schema: {
    name: ListMacrosTool.shape.name.value,
    description: ListMacrosTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListMacrosTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      // Ensure MongoDB is connected
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = ListMacrosTool.shape.arguments.parse(params || {});
      const macros = mongodb.getMacrosCollection();

      // Build query
      const query: any = {};

      if (validatedParams.site) {
        query.site = validatedParams.site;
      }

      if (validatedParams.category) {
        query.category = validatedParams.category;
      }

      if (validatedParams.tags && validatedParams.tags.length > 0) {
        query.tags = { $in: validatedParams.tags };
      }

      if (validatedParams.reliability) {
        query.reliability = validatedParams.reliability;
      }

      if (validatedParams.search) {
        query.$or = [
          { name: { $regex: validatedParams.search, $options: "i" } },
          { description: { $regex: validatedParams.search, $options: "i" } },
        ];
      }

      const limit = validatedParams.limit || 50;

      // Execute query (exclude code field to reduce response size)
      const results = await macros
        .find(query, {
          projection: {
            _id: 0,
            code: 0, // Exclude code from list results
          },
        })
        .limit(limit)
        .sort({ usageCount: -1, createdAt: -1 })
        .toArray();

      return jsonResponse({
        count: results.length,
        macros: results,
      });
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to list macros: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Execute a stored macro
 */
export const executeMacro: Tool = {
  schema: {
    name: ExecuteMacroTool.shape.name.value,
    description: ExecuteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(ExecuteMacroTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      // Ensure MongoDB is connected
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      await context.ensureAttached();

      const validatedParams = ExecuteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();

      // Fetch macro
      const macro = await macros.findOne({ id: validatedParams.id });

      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      // Wrap the macro code in an async IIFE and pass params
      // This handles both sync and async macros correctly
      const wrappedCode = `
        (async function() {
          const macroFunction = ${macro.code};
          const params = ${JSON.stringify(validatedParams.params || {})};
          try {
            const result = await macroFunction(params);
            return { success: true, result: result };
          } catch (error) {
            return { success: false, error: error.message, stack: error.stack };
          }
        })()
      `;

      // Execute in page context
      const result = await context.sendSocketMessage("browser_evaluate", {
        expression: wrappedCode,
      });

      // Update usage statistics
      const isSuccess = result.success === true;
      const updateFields: any = {
        usageCount: macro.usageCount + 1,
        lastVerified: new Date(),
      };

      if (macro.usageCount > 0) {
        const newSuccessCount = macro.successRate * macro.usageCount + (isSuccess ? 1 : 0);
        updateFields.successRate = newSuccessCount / (macro.usageCount + 1);
      } else {
        updateFields.successRate = isSuccess ? 1.0 : 0.0;
      }

      await macros.updateOne(
        { id: validatedParams.id },
        { $set: updateFields }
      );

      // Return result
      if (result.success) {
        return jsonResponse({
          success: true,
          macro: {
            id: macro.id,
            name: macro.name,
            site: macro.site,
          },
          result: result.result,
        });
      } else {
        return errorResponse(
          `Macro execution failed: ${result.error}`, false, result.stack
        , max_tokens);
      }
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to execute macro: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Update an existing macro
 */
export const updateMacro: Tool = {
  schema: {
    name: UpdateMacroTool.shape.name.value,
    description: UpdateMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(UpdateMacroTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      // Ensure MongoDB is connected
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = UpdateMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();

      // Check if macro exists
      const existing = await macros.findOne({ id: validatedParams.id });

      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      // Build update document
      const updateDoc: any = {
        updatedAt: new Date(),
      };

      if (validatedParams.description !== undefined) {
        updateDoc.description = validatedParams.description;
      }

      if (validatedParams.parameters !== undefined) {
        updateDoc.parameters = validatedParams.parameters;
      }

      if (validatedParams.code !== undefined) {
        updateDoc.code = validatedParams.code;
        // Increment version
        const [major, minor, patch] = existing.version.split(".").map(Number);
        updateDoc.version = `${major}.${minor}.${patch + 1}`;
      }

      if (validatedParams.returnType !== undefined) {
        updateDoc.returnType = validatedParams.returnType;
      }

      if (validatedParams.reliability !== undefined) {
        updateDoc.reliability = validatedParams.reliability;
      }

      if (validatedParams.tags !== undefined) {
        updateDoc.tags = validatedParams.tags;
      }

      // Update macro
      await macros.updateOne(
        { id: validatedParams.id },
        { $set: updateDoc }
      );

      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" updated successfully`,
        id: existing.id,
        version: updateDoc.version || existing.version,
      });
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to update macro: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Delete a macro
 */
export const deleteMacro: Tool = {
  schema: {
    name: DeleteMacroTool.shape.name.value,
    description: DeleteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteMacroTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      // Ensure MongoDB is connected
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = DeleteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();

      // Check if macro exists
      const existing = await macros.findOne({ id: validatedParams.id });

      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      // Delete macro
      await macros.deleteOne({ id: validatedParams.id });

      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" deleted successfully`,
        id: existing.id,
      });
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to delete macro: ${error.message}`, false, error, max_tokens);
    }
  },
};
