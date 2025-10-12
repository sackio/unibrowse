#!/usr/bin/env node
import {
  DeleteMacroTool,
  ExecuteMacroTool,
  ListMacrosTool,
  StoreMacroTool,
  UpdateMacroTool,
  appConfig,
  cancelDownload,
  checkElementState,
  checkVisibility,
  clearCache,
  clearCookies,
  clearHistory,
  click,
  closeTab,
  countElements,
  createBookmark,
  createServerWithTools,
  createTab,
  deleteBookmark,
  deleteCookie,
  deleteHistory,
  disableExtension,
  downloadFile,
  drag,
  enableExtension,
  errorResponse,
  evaluate,
  fillForm,
  findByText,
  getAttributes,
  getBookmarks,
  getBrowserInfo,
  getClipboard,
  getComputedStyles,
  getConsoleLogs,
  getCookies,
  getDownloads,
  getExtensionInfo,
  getFilteredAriaTree,
  getFormValues,
  getHistoryVisits,
  getInteractions,
  getNetworkLogs,
  getNetworkState,
  getPageMetadata,
  getSystemInfo,
  getVersion,
  getVisibleText,
  goBack,
  goForward,
  hover,
  jsonResponse,
  listExtensions,
  listTabs,
  navigate,
  openDownload,
  package_default,
  pressKey,
  pruneInteractions,
  queryDOM,
  requestUserAction,
  screenshot,
  scroll,
  scrollToElement,
  searchBookmarks,
  searchHistory,
  searchInteractions,
  selectOption,
  setClipboard,
  setCookie,
  setNetworkConditions,
  snapshot,
  submitForm,
  switchTab,
  type,
  wait
} from "./chunk-AQCJSZ5J.js";
import "./chunk-ITTVOQ2V.js";

// src/stdio-server.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// src/tools/macros.ts
import { zodToJsonSchema } from "zod-to-json-schema";
import { v4 as uuidv4 } from "uuid";

// src/utils/mongodb.ts
import { MongoClient } from "mongodb";
var MongoDB = class _MongoDB {
  static instance;
  client = null;
  db = null;
  connected = false;
  constructor() {
  }
  static getInstance() {
    if (!_MongoDB.instance) {
      _MongoDB.instance = new _MongoDB();
    }
    return _MongoDB.instance;
  }
  /**
   * Connect to MongoDB
   * Default: mongodb://192.168.1.42:27017/browser_mcp
   */
  async connect(uri) {
    if (this.connected && this.client) {
      return;
    }
    const connectionUri = uri || process.env.MONGODB_URI || "mongodb://192.168.1.42:27017";
    const dbName = process.env.MONGODB_DB || "browser_mcp";
    try {
      this.client = new MongoClient(connectionUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5e3,
        socketTimeoutMS: 45e3
      });
      await this.client.connect();
      this.db = this.client.db(dbName);
      this.connected = true;
      await this.ensureIndexes();
      console.log(`[MongoDB] Connected to ${connectionUri}/${dbName}`);
    } catch (error) {
      console.error("[MongoDB] Connection failed:", error);
      this.connected = false;
      throw error;
    }
  }
  /**
   * Ensure required indexes exist
   */
  async ensureIndexes() {
    if (!this.db) return;
    const macros = this.db.collection("macros");
    await macros.createIndex({ id: 1 }, { unique: true });
    await macros.createIndex({ site: 1, category: 1 });
    await macros.createIndex({ site: 1, name: 1 }, { unique: true });
    await macros.createIndex({ tags: 1 });
    await macros.createIndex({ createdAt: 1 });
    await macros.createIndex({ reliability: 1 });
    console.log("[MongoDB] Indexes created successfully");
  }
  /**
   * Get macros collection
   */
  getMacrosCollection() {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("macros");
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }
  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.connected = false;
      this.client = null;
      this.db = null;
      console.log("[MongoDB] Disconnected");
    }
  }
  /**
   * Health check
   */
  async ping() {
    if (!this.db) return false;
    try {
      await this.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }
};
var mongodb = MongoDB.getInstance();

// src/tools/macros.ts
var storeMacro = {
  schema: {
    name: StoreMacroTool.shape.name.value,
    description: StoreMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(StoreMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = StoreMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({
        site: validatedParams.site,
        name: validatedParams.name
      });
      if (existing) {
        return errorResponse(
          `Macro "${validatedParams.name}" already exists for site "${validatedParams.site}". Use browser_update_macro to update it.`,
          true
        );
      }
      const now = /* @__PURE__ */ new Date();
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
        successRate: 0
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
          description: macroDoc.description
        }
      });
    } catch (error) {
      return errorResponse(`Failed to store macro: ${error.message}`, false, error);
    }
  }
};
var listMacros = {
  schema: {
    name: ListMacrosTool.shape.name.value,
    description: ListMacrosTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListMacrosTool.shape.arguments)
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = ListMacrosTool.shape.arguments.parse(params || {});
      const macros = mongodb.getMacrosCollection();
      const query = {};
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
          { description: { $regex: validatedParams.search, $options: "i" } }
        ];
      }
      const limit = validatedParams.limit || 50;
      const results = await macros.find(query, {
        projection: {
          _id: 0,
          code: 0
          // Exclude code from list results
        }
      }).limit(limit).sort({ usageCount: -1, createdAt: -1 }).toArray();
      return jsonResponse({
        count: results.length,
        macros: results
      });
    } catch (error) {
      return errorResponse(`Failed to list macros: ${error.message}`, false, error);
    }
  }
};
var executeMacro = {
  schema: {
    name: ExecuteMacroTool.shape.name.value,
    description: ExecuteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(ExecuteMacroTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      await context.ensureAttached();
      const validatedParams = ExecuteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const macro = await macros.findOne({ id: validatedParams.id });
      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true);
      }
      const wrappedCode = `
        (function() {
          const macroFunction = ${macro.code};
          const params = ${JSON.stringify(validatedParams.params || {})};
          try {
            const result = macroFunction(params);
            return { success: true, result: result };
          } catch (error) {
            return { success: false, error: error.message, stack: error.stack };
          }
        })()
      `;
      const result = await context.sendSocketMessage("browser_evaluate", {
        expression: wrappedCode
      });
      const isSuccess = result.success === true;
      const updateFields = {
        usageCount: macro.usageCount + 1,
        lastVerified: /* @__PURE__ */ new Date()
      };
      if (macro.usageCount > 0) {
        const newSuccessCount = macro.successRate * macro.usageCount + (isSuccess ? 1 : 0);
        updateFields.successRate = newSuccessCount / (macro.usageCount + 1);
      } else {
        updateFields.successRate = isSuccess ? 1 : 0;
      }
      await macros.updateOne(
        { id: validatedParams.id },
        { $set: updateFields }
      );
      if (result.success) {
        return jsonResponse({
          success: true,
          macro: {
            id: macro.id,
            name: macro.name,
            site: macro.site
          },
          result: result.result
        });
      } else {
        return errorResponse(
          `Macro execution failed: ${result.error}`,
          false,
          result.stack
        );
      }
    } catch (error) {
      return errorResponse(`Failed to execute macro: ${error.message}`, false, error);
    }
  }
};
var updateMacro = {
  schema: {
    name: UpdateMacroTool.shape.name.value,
    description: UpdateMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(UpdateMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = UpdateMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true);
      }
      const updateDoc = {
        updatedAt: /* @__PURE__ */ new Date()
      };
      if (validatedParams.description !== void 0) {
        updateDoc.description = validatedParams.description;
      }
      if (validatedParams.parameters !== void 0) {
        updateDoc.parameters = validatedParams.parameters;
      }
      if (validatedParams.code !== void 0) {
        updateDoc.code = validatedParams.code;
        const [major, minor, patch] = existing.version.split(".").map(Number);
        updateDoc.version = `${major}.${minor}.${patch + 1}`;
      }
      if (validatedParams.returnType !== void 0) {
        updateDoc.returnType = validatedParams.returnType;
      }
      if (validatedParams.reliability !== void 0) {
        updateDoc.reliability = validatedParams.reliability;
      }
      if (validatedParams.tags !== void 0) {
        updateDoc.tags = validatedParams.tags;
      }
      await macros.updateOne(
        { id: validatedParams.id },
        { $set: updateDoc }
      );
      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" updated successfully`,
        id: existing.id,
        version: updateDoc.version || existing.version
      });
    } catch (error) {
      return errorResponse(`Failed to update macro: ${error.message}`, false, error);
    }
  }
};
var deleteMacro = {
  schema: {
    name: DeleteMacroTool.shape.name.value,
    description: DeleteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteMacroTool.shape.arguments)
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = DeleteMacroTool.shape.arguments.parse(params);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true);
      }
      await macros.deleteOne({ id: validatedParams.id });
      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" deleted successfully`,
        id: existing.id
      });
    } catch (error) {
      return errorResponse(`Failed to delete macro: ${error.message}`, false, error);
    }
  }
};

// src/stdio-server.ts
function setupExitWatchdog(server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15e3);
    await server.close();
    process.exit(0);
  });
}
var commonTools = [
  pressKey,
  scroll,
  scrollToElement,
  wait
];
var customTools = [
  evaluate,
  getConsoleLogs,
  getNetworkLogs,
  screenshot
];
var explorationTools = [
  queryDOM,
  getVisibleText,
  getComputedStyles,
  checkVisibility,
  getAttributes,
  countElements,
  getPageMetadata,
  getFilteredAriaTree,
  findByText,
  getFormValues,
  checkElementState
];
var tabTools = [
  listTabs,
  switchTab,
  createTab,
  closeTab
];
var formTools = [
  fillForm,
  submitForm
];
var recordingTools = [
  requestUserAction(false)
];
var interactionTools = [
  getInteractions,
  pruneInteractions,
  searchInteractions
];
var cookieTools = [
  getCookies,
  setCookie,
  deleteCookie,
  clearCookies
];
var downloadTools = [
  downloadFile,
  getDownloads,
  cancelDownload,
  openDownload
];
var clipboardTools = [
  getClipboard,
  setClipboard
];
var historyTools = [
  searchHistory,
  getHistoryVisits,
  deleteHistory,
  clearHistory
];
var systemTools = [
  getVersion,
  getSystemInfo,
  getBrowserInfo
];
var networkTools = [
  getNetworkState,
  setNetworkConditions,
  clearCache
];
var bookmarkTools = [
  getBookmarks,
  createBookmark,
  deleteBookmark,
  searchBookmarks
];
var extensionTools = [
  listExtensions,
  getExtensionInfo,
  enableExtension,
  disableExtension
];
var macroTools = [
  storeMacro,
  listMacros,
  executeMacro,
  updateMacro,
  deleteMacro
];
var snapshotTools = [
  navigate(false),
  goBack(false),
  goForward(false),
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
  ...tabTools,
  ...formTools,
  ...recordingTools,
  ...interactionTools,
  ...cookieTools,
  ...downloadTools,
  ...clipboardTools,
  ...historyTools,
  ...systemTools,
  ...networkTools,
  ...bookmarkTools,
  ...extensionTools,
  ...macroTools
];
var resources = [];
async function createServer() {
  return createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
}
program.version("Version " + package_default.version).name(package_default.name).action(async () => {
  const server = await createServer();
  setupExitWatchdog(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
});
program.parse(process.argv);
