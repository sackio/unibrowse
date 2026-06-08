import { zodToJsonSchema } from "zod-to-json-schema";
import { v4 as uuidv4 } from "uuid";

import {
  StoreMacroTool,
  ListMacrosTool,
  GetMacroTool,
  ExecuteMacroTool,
  UpdateMacroTool,
  DeleteMacroTool,
} from "@/types/tool-schemas";
import { textResponse, jsonResponse, errorResponse } from "@/utils/response-helpers";
import { mongodb } from "@/utils/mongodb";
import { runRoutine } from "./routine-runner";

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
        // Update existing macro instead of erroring
        const now = new Date();
        const updateDoc: any = {
          category: validatedParams.category,
          description: validatedParams.description,
          parameters: validatedParams.parameters,
          code: validatedParams.code,
          kind: (validatedParams as any).kind || existing.kind || "page",
          returnType: validatedParams.returnType,
          updatedAt: now,
          reliability: validatedParams.reliability || existing.reliability,
          tags: validatedParams.tags || existing.tags,
        };

        // Increment version if code changed
        if (validatedParams.code !== existing.code) {
          const [major, minor, patch] = existing.version.split(".").map(Number);
          updateDoc.version = `${major}.${minor}.${patch + 1}`;
        }

        await macros.updateOne(
          { id: existing.id },
          { $set: updateDoc }
        );

        return jsonResponse({
          success: true,
          id: existing.id,
          message: `Macro "${validatedParams.name}" updated successfully`,
          macro: {
            id: existing.id,
            site: existing.site,
            category: updateDoc.category,
            name: existing.name,
            description: updateDoc.description,
          },
        });
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
        kind: (validatedParams as any).kind || "page",
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
 * Fetch a stored macro's full source by id.
 * Read-only complement to listMacros (which excludes code) and updateMacro
 * (which patches it). Lets an agent inspect a macro before iterating on it
 * without having to read off-MCP filesystem backups (which were the only
 * inspection path before this tool existed — shopping flagged the gap on
 * 2026-06-02).
 */
export const getMacro: Tool = {
  schema: {
    name: GetMacroTool.shape.name.value,
    description: GetMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetMacroTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = GetMacroTool.shape.arguments.parse(params || {});
      const macros = mongodb.getMacrosCollection();
      const macro = await macros.findOne(
        { id: validatedParams.id },
        { projection: { _id: 0 } },
      );
      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }
      return jsonResponse(macro, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get macro: ${error.message}`, false, error, max_tokens);
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

      const validatedParams = ExecuteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();

      // Fetch macro
      const macro = await macros.findOne({ id: validatedParams.id });

      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      // ── Routine-kind macros: host-side execution with ctx tool handle. ──
      // Skip the page-eval path entirely. routine-runner compiles the macro
      // source as an async function, builds a `ctx` bound to this Context +
      // the caller's tab/extension targeting, and invokes it. The macro can
      // sequence ctx.navigate / ctx.evaluate / ctx.realisticClick / etc.
      // inline with normal async control flow. Existing page-kind macros
      // (no `kind` field or kind:'page') still go through the legacy IIFE
      // eval below for back-compat.
      if ((macro as any).kind === "routine") {
        try {
          const result = await runRoutine(
            macro.code as string,
            (validatedParams.params || {}) as Record<string, unknown>,
            context,
            {
              tabTarget: validatedParams.tabTarget,
              extensionId: validatedParams.extensionId,
              agent: (validatedParams as any).agent,
              takeover: (validatedParams as any).takeover,
            },
          );
          // Bump usage / success stats — mirror the page-kind path below.
          await macros.updateOne(
            { id: validatedParams.id },
            {
              $set: {
                usageCount: (macro.usageCount || 0) + 1,
                lastVerified: new Date(),
                successRate: macro.usageCount > 0
                  ? (macro.successRate * macro.usageCount + 1) / (macro.usageCount + 1)
                  : 1.0,
              },
            },
          );
          return jsonResponse({
            success: true,
            macro: { id: macro.id, name: macro.name, site: macro.site, kind: "routine" },
            result,
          });
        } catch (e: any) {
          await macros.updateOne(
            { id: validatedParams.id },
            {
              $set: {
                usageCount: (macro.usageCount || 0) + 1,
                lastVerified: new Date(),
                successRate: macro.usageCount > 0
                  ? (macro.successRate * macro.usageCount) / (macro.usageCount + 1)
                  : 0.0,
              },
            },
          );
          // Surface typed routine errors with full discriminator so the caller
          // (or another routine via ctx.runMacro later) can branch on err.code.
          return errorResponse(
            `Routine execution failed (${e?.code || "unknown"}): ${e?.message || String(e)}`,
            false,
            { code: e?.code, cause: e?.cause, stack: e?.stack },
            max_tokens,
          );
        }
      }

      // ── Page-kind (legacy) execution path ─────────────────────────────────
      await context.ensureAttachedFromParams(params);

      // Wrap the macro code in an async IIFE and pass params
      // Supports both function expressions (async (params) => {...}) and
      // self-invoking IIFEs ((async function() {...}())), where the latter
      // evaluates to a Promise rather than a callable function.
      const wrappedCode = `
        return (async function() {
          const macroFunction = ${macro.code};
          const params = ${JSON.stringify(validatedParams.params || {})};
          try {
            // If code evaluated to a function, call it with params.
            // If it evaluated to a Promise (IIFE format), just await it.
            const result = typeof macroFunction === 'function'
              ? await macroFunction(params)
              : await macroFunction;
            return { success: true, result: result };
          } catch (error) {
            return { success: false, error: error.message, stack: error.stack };
          }
        })()
      `;

      // Execute in page context. Honor the caller's timeout_ms when supplied
      // (default 30000) so long-running macros aren't capped by the WS layer.
      // Forward extensionId + tabTarget through options so multi-extension
      // routing works — otherwise we'd hit "Multiple extensions are connected"
      // even with a valid extensionId on the macro call.
      const timeoutMs = validatedParams.timeout_ms || 30000;
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        { expression: wrappedCode },
        {
          timeoutMs,
          extensionId: validatedParams.extensionId,
          tabTarget: validatedParams.tabTarget,
        },
      );

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

      if ((validatedParams as any).kind !== undefined) {
        updateDoc.kind = (validatedParams as any).kind;
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
