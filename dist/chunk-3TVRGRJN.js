import {
  __require,
  createWebSocketServer,
  mcpConfig
} from "./chunk-FT2ARCXD.js";

// src/config/app.config.ts
var appConfig = {
  name: "unibrowse",
  tagline: "Bridging the gap between AI agents and browser automation",
  description: "unibrowse connects AI applications to your browser, bridging the gap between AI agents and browser automation. Supported by Claude, Cursor, VS Code, Windsurf, and more.",
  email: {
    defaultFrom: "support@unibrowse.local"
  }
};

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/utils/messaging-sender.ts
import { WebSocket } from "ws";
var MESSAGE_RESPONSE_TYPE = "messageResponse";
function generateId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
}
function addSocketMessageResponseListener(ws, typeListener) {
  const listener = async (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.type !== MESSAGE_RESPONSE_TYPE) {
      return;
    }
    await typeListener(message);
  };
  ws.addEventListener("message", listener);
  return () => ws.removeEventListener("message", listener);
}
function createSocketMessageSender(ws) {
  async function sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
    const { timeoutMs } = options;
    const id = generateId();
    const message = { id, type: type2, payload };
    return new Promise((resolve2, reject) => {
      const cleanup = () => {
        removeSocketMessageResponseListener();
        ws.removeEventListener("error", errorHandler);
        ws.removeEventListener("close", cleanup);
        if (timeoutId) clearTimeout(timeoutId);
      };
      let timeoutId;
      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(
            new Error(`WebSocket response timeout after ${timeoutMs}ms`)
          );
        }, timeoutMs);
      }
      const removeSocketMessageResponseListener = addSocketMessageResponseListener(
        ws,
        (responseMessage) => {
          const { payload: responsePayload } = responseMessage;
          if (responsePayload.requestId !== id) {
            return;
          }
          const { result, error } = responsePayload;
          if (error) {
            reject(new Error(error));
          } else {
            resolve2(result);
          }
          cleanup();
        }
      );
      const errorHandler = (_event) => {
        cleanup();
        reject(new Error("WebSocket error occurred"));
      };
      ws.addEventListener("error", errorHandler);
      ws.addEventListener("close", cleanup);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        cleanup();
        reject(new Error("WebSocket is not open"));
      }
    });
  }
  return { sendSocketMessage };
}

// src/context.ts
var noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;
var Context = class {
  _ws;
  _activeTabId = null;
  get ws() {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }
  set ws(ws) {
    this._ws = ws;
  }
  hasWs() {
    return !!this._ws;
  }
  /**
   * Get the currently active (last-used) tab ID
   * Note: With multi-tab support, this only tracks the most recently used tab
   */
  get activeTabId() {
    return this._activeTabId;
  }
  /**
   * Ensure debugger is attached to a tab (lazy attachment with multi-tab support)
   *
   * @param tabId - Optional tab ID to attach to
   * @param label - Optional label to identify the tab (alternative to tabId)
   * @param autoOpenUrl - Optional URL to open if no tabs are attached
   * @returns Object with tabId and label of the attached tab
   */
  async ensureAttached(options) {
    const result = await this.sendSocketMessage("browser_ensure_attached", {
      tabId: options?.tabId ?? null,
      label: options?.label ?? null,
      autoOpenUrl: options?.autoOpenUrl ?? null
    });
    this._activeTabId = result.tabId;
    return result;
  }
  async sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
    const { sendSocketMessage } = createSocketMessageSender(
      this.ws
    );
    try {
      return await sendSocketMessage(type2, payload, options);
    } catch (e) {
      if (e instanceof Error && e.message === mcpConfig.errors.noConnectedTab) {
        throw new Error(noConnectionMessage);
      }
      throw e;
    }
  }
  async close() {
    if (!this._ws) {
      return;
    }
    await this._ws.close();
  }
};

// src/server.ts
var globalContext = new Context();
async function createServerWithTools(options) {
  const { name, version, tools, resources, wss: providedWss } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  async function handleBrowserMessage(ws, message) {
    const { id, type: type2, payload } = message;
    if (type2 === "EXTENSION_REGISTER") {
      console.log(`[Server] Extension registered, storing as primary browser connection`);
      globalContext.ws = ws;
      return;
    }
    if (type2 === "messageResponse") {
      return;
    }
    if (!type2) {
      console.warn(`[Server] Message without type field: ${JSON.stringify(message)}`);
      return;
    }
    console.log(`[Server] Handling tool request: ${type2} (id: ${id})`);
    try {
      const tool = tools.find((t) => t.schema.name === type2);
      if (!tool) {
        console.warn(`[Server] Unknown tool: ${type2}`);
        ws.send(JSON.stringify({ id, error: `Unknown tool: ${type2}` }));
        return;
      }
      const toolResult = await tool.handle(globalContext, payload || {});
      ws.send(JSON.stringify({
        type: "messageResponse",
        payload: {
          requestId: id,
          result: toolResult
        }
      }));
    } catch (error) {
      console.error(`[Server] Tool execution error:`, error);
      ws.send(JSON.stringify({
        type: "messageResponse",
        payload: {
          requestId: id,
          error: String(error)
        }
      }));
    }
  }
  const connections = /* @__PURE__ */ new Set();
  const wss = providedWss || await createWebSocketServer();
  wss.on("connection", (websocket) => {
    console.log("[Server] New WebSocket connection established");
    connections.add(websocket);
    console.log(`[Server] Total active connections: ${connections.size}`);
    websocket.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleBrowserMessage(websocket, message);
      } catch (error) {
        console.error("[Server] Error parsing message:", error);
      }
    });
    websocket.on("close", () => {
      console.log("[Server] WebSocket connection closed");
      connections.delete(websocket);
      console.log(`[Server] Total active connections: ${connections.size}`);
      if (globalContext.hasWs() && globalContext.ws === websocket) {
        console.log("[Server] Extension connection closed, clearing globalContext.ws");
        globalContext.ws = void 0;
      }
    });
    websocket.on("error", (error) => {
      console.error("[Server] WebSocket error:", error);
    });
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool2) => tool2.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` }
        ],
        isError: true
      };
    }
    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource2) => resource2.schema.uri === request.params.uri
    );
    if (!resource) {
      return { contents: [] };
    }
    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });
  server.close = async () => {
    await server.close();
    await wss.close();
    await globalContext.close();
  };
  return server;
}
async function createServerWithoutWebSocket(options) {
  const { name, version, tools, resources } = options;
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources.map((resource) => resource.schema) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool2) => tool2.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` }
        ],
        isError: true
      };
    }
    try {
      const result = await tool.handle(globalContext, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource2) => resource2.schema.uri === request.params.uri
    );
    if (!resource) {
      return { contents: [] };
    }
    const contents = await resource.read(globalContext, request.params.uri);
    return { contents };
  });
  return server;
}

// src/tools/bookmarks.ts
import { zodToJsonSchema } from "zod-to-json-schema";

// src/types/tool-schemas.ts
import { z } from "zod";
var ElementSchema = z.object({
  element: z.string().describe(
    "Human-readable element description used to obtain permission to interact with the element"
  ),
  ref: z.string().describe("Exact target element reference from the page snapshot")
});
var TabTargetSchema = z.object({
  tabTarget: z.union([z.number(), z.string()]).optional().describe(
    "Optional tab identifier (tab ID or label) to target a specific attached tab. If not provided, uses the last-used tab. Use browser_list_attached_tabs to see available tabs."
  )
});
var MaxTokensSchema = z.object({
  max_tokens: z.number().positive().optional().describe(
    "Optional maximum tokens for response output (default: 25000). Claude Code's default MCP tool response limit is 25,000 tokens. Use this to control response size for large outputs (snapshots, screenshots, logs, etc.). Set to a lower value to reduce response size or higher value if MAX_MCP_OUTPUT_TOKENS env var is increased."
  )
});
var NavigateTool = z.object({
  name: z.literal("browser_navigate"),
  description: z.literal("Navigate to a URL"),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GoBackTool = z.object({
  name: z.literal("browser_go_back"),
  description: z.literal("Go back to the previous page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GoForwardTool = z.object({
  name: z.literal("browser_go_forward"),
  description: z.literal("Go forward to the next page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var WaitTool = z.object({
  name: z.literal("browser_wait"),
  description: z.literal("Wait for a specified time in seconds"),
  arguments: z.object({
    time: z.number().describe("The time to wait in seconds")
  }).merge(MaxTokensSchema)
});
var PressKeyTool = z.object({
  name: z.literal("browser_press_key"),
  description: z.literal("Press a key on the keyboard"),
  arguments: z.object({
    key: z.string().describe(
      "Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ScrollTool = z.object({
  name: z.literal("browser_scroll"),
  description: z.literal("Scroll the page by a specific amount in pixels"),
  arguments: z.object({
    x: z.number().optional().describe("Horizontal scroll amount in pixels (positive = right, negative = left). Default: 0"),
    y: z.number().describe("Vertical scroll amount in pixels (positive = down, negative = up)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ScrollToElementTool = z.object({
  name: z.literal("browser_scroll_to_element"),
  description: z.literal("Scroll to make a specific element visible in the viewport"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListTabsTool = z.object({
  name: z.literal("browser_list_tabs"),
  description: z.literal("List all open browser tabs"),
  arguments: z.object({}).merge(MaxTokensSchema)
});
var SwitchTabTool = z.object({
  name: z.literal("browser_switch_tab"),
  description: z.literal("Switch to a specific browser tab"),
  arguments: z.object({
    tabId: z.number().describe("The ID of the tab to switch to")
  }).merge(MaxTokensSchema)
});
var CreateTabTool = z.object({
  name: z.literal("browser_create_tab"),
  description: z.literal("Create a new browser tab"),
  arguments: z.object({
    url: z.string().optional().describe("URL to open in the new tab (default: about:blank)")
  }).merge(MaxTokensSchema)
});
var CloseTabTool = z.object({
  name: z.literal("browser_close_tab"),
  description: z.literal("Close a specific browser tab"),
  arguments: z.object({
    tabId: z.number().describe("The ID of the tab to close")
  }).merge(MaxTokensSchema)
});
var CreateWindowTool = z.object({
  name: z.literal("browser_create_window"),
  description: z.literal("Create a new browser window"),
  arguments: z.object({
    url: z.union([z.string(), z.array(z.string())]).optional().describe("URL or array of URLs to open in the new window (default: about:blank)"),
    focused: z.boolean().optional().describe("Whether the new window should be focused (default: true)"),
    incognito: z.boolean().optional().describe("Whether to open in incognito/private mode (default: false)"),
    width: z.number().optional().describe("Window width in pixels"),
    height: z.number().optional().describe("Window height in pixels")
  }).merge(MaxTokensSchema)
});
var FillFormTool = z.object({
  name: z.literal("browser_fill_form"),
  description: z.literal("Fill multiple form fields at once"),
  arguments: z.object({
    fields: z.array(
      z.object({
        element: z.string().describe("Human-readable field description"),
        ref: z.string().describe("Exact field reference from the page snapshot"),
        value: z.string().describe("Value to fill in the field")
      })
    ).describe("Array of fields to fill")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SubmitFormTool = z.object({
  name: z.literal("browser_submit_form"),
  description: z.literal("Submit a form"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetNetworkLogsTool = z.object({
  name: z.literal("browser_get_network_logs"),
  description: z.literal("Get network requests and responses captured since page load"),
  arguments: z.object({
    filter: z.string().optional().describe("Optional filter to match URLs (e.g., 'api', '.json')")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SnapshotTool = z.object({
  name: z.literal("browser_snapshot"),
  description: z.literal(
    "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with."
  ),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var ClickTool = z.object({
  name: z.literal("browser_click"),
  description: z.literal("Perform click on a web page"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DragTool = z.object({
  name: z.literal("browser_drag"),
  description: z.literal("Perform drag and drop between two elements"),
  arguments: z.object({
    startElement: z.string().describe(
      "Human-readable source element description used to obtain the permission to interact with the element"
    ),
    startRef: z.string().describe("Exact source element reference from the page snapshot"),
    endElement: z.string().describe(
      "Human-readable target element description used to obtain the permission to interact with the element"
    ),
    endRef: z.string().describe("Exact target element reference from the page snapshot")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var HoverTool = z.object({
  name: z.literal("browser_hover"),
  description: z.literal("Hover over element on page"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema)
});
var TypeTool = z.object({
  name: z.literal("browser_type"),
  description: z.literal("Type text into editable element"),
  arguments: ElementSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z.boolean().describe("Whether to submit entered text (press Enter after)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SelectOptionTool = z.object({
  name: z.literal("browser_select_option"),
  description: z.literal("Select an option in a dropdown"),
  arguments: ElementSchema.extend({
    values: z.array(z.string()).describe(
      "Array of values to select in the dropdown. This can be a single value or multiple values."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ScreenshotTool = z.object({
  name: z.literal("browser_screenshot"),
  description: z.literal("Take a screenshot of the current page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var SegmentedScreenshotTool = z.object({
  name: z.literal("browser_segmented_screenshot"),
  description: z.literal(
    "Capture multiple screenshots of specific page elements based on CSS selectors. Each selector will produce a separate PNG image file saved to disk. Elements are automatically scrolled into view before capture. Returns array of file paths (not base64) to minimize context usage."
  ),
  arguments: z.object({
    selectors: z.array(z.string()).min(1).describe(
      "Array of CSS selectors identifying elements to capture (e.g., ['.header', '.main', '.footer']). Each element will be captured as a separate image."
    ),
    outputDir: z.string().optional().describe("Output directory for screenshots (default: /tmp)"),
    prefix: z.string().optional().describe("Filename prefix (default: 'segment')"),
    includeLabels: z.boolean().optional().describe(
      "Include element ID or first class name in filename (default: false)"
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetConsoleLogsTool = z.object({
  name: z.literal("browser_get_console_logs"),
  description: z.literal("Get the console logs from the browser"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var EvaluateTool = z.object({
  name: z.literal("browser_evaluate"),
  description: z.literal("Evaluate JavaScript expression on page or element"),
  arguments: z.object({
    expression: z.string().describe("JavaScript expression to evaluate in page context")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var QueryDOMTool = z.object({
  name: z.literal("browser_query_dom"),
  description: z.literal(
    "Query DOM elements by CSS selector and return basic info without full ARIA tree"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector to query elements"),
    limit: z.number().optional().describe("Maximum number of elements to return (default: 10)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetVisibleTextTool = z.object({
  name: z.literal("browser_get_visible_text"),
  description: z.literal(
    "Get visible text content from the page or a specific element"
  ),
  arguments: z.object({
    selector: z.string().optional().describe("Optional CSS selector to get text from specific element"),
    maxLength: z.number().optional().describe("Maximum text length to return (default: 5000)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetComputedStylesTool = z.object({
  name: z.literal("browser_get_computed_styles"),
  description: z.literal("Get computed CSS styles for an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    properties: z.array(z.string()).optional().describe(
      "Specific CSS properties to retrieve (e.g. ['display', 'color']). If not specified, returns common layout properties."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CheckVisibilityTool = z.object({
  name: z.literal("browser_check_visibility"),
  description: z.literal(
    "Check if element is visible, hidden, in viewport, or has specific display state"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetAttributesTool = z.object({
  name: z.literal("browser_get_attributes"),
  description: z.literal("Get all attributes or specific attributes of an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    attributes: z.array(z.string()).optional().describe(
      "Specific attributes to retrieve (e.g. ['href', 'class']). If not specified, returns all attributes."
    )
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CountElementsTool = z.object({
  name: z.literal("browser_count_elements"),
  description: z.literal("Count number of elements matching a CSS selector"),
  arguments: z.object({
    selector: z.string().describe("CSS selector to count matching elements")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetPageMetadataTool = z.object({
  name: z.literal("browser_get_page_metadata"),
  description: z.literal(
    "Get page metadata including title, description, Open Graph tags, schema.org data, etc."
  ),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetFilteredAriaTreeTool = z.object({
  name: z.literal("browser_get_filtered_aria_tree"),
  description: z.literal(
    "Get ARIA tree with filters to reduce token usage (e.g. only interactive elements, specific roles, max depth)"
  ),
  arguments: z.object({
    roles: z.array(z.string()).optional().describe(
      "Filter to only include elements with these ARIA roles (e.g. ['button', 'link', 'textbox'])"
    ),
    maxDepth: z.number().optional().describe("Maximum depth to traverse in the tree (default: 5)"),
    interactiveOnly: z.boolean().optional().describe("Only include interactive elements (buttons, links, inputs, etc.)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var FindByTextTool = z.object({
  name: z.literal("browser_find_by_text"),
  description: z.literal(
    "Find elements containing specific text (case-insensitive, partial match)"
  ),
  arguments: z.object({
    text: z.string().describe("Text to search for in elements"),
    selector: z.string().optional().describe("Optional CSS selector to narrow search scope"),
    exact: z.boolean().optional().describe("Whether to match exact text (default: false for partial match)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 10)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetFormValuesTool = z.object({
  name: z.literal("browser_get_form_values"),
  description: z.literal(
    "Get current values of all form fields in a form or the entire page"
  ),
  arguments: z.object({
    formSelector: z.string().optional().describe("Optional CSS selector for a specific form. If not specified, gets all form fields on the page.")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CheckElementStateTool = z.object({
  name: z.literal("browser_check_element_state"),
  description: z.literal(
    "Check element state: enabled/disabled, checked/unchecked, selected, readonly, required, etc."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RequestUserActionTool = z.object({
  name: z.literal("browser_request_user_action"),
  description: z.literal(
    "Request the user to perform an action in the browser. Shows a notification and overlay with instructions. User can complete or reject the request. Captures all interactions from request to completion via the background log. More flexible than request_demonstration - use this for both learning workflows AND getting user assistance."
  ),
  arguments: z.object({
    request: z.string().describe("Clear instructions for what you want the user to do (e.g., 'Please navigate to your shopping cart and add an item')"),
    timeout: z.number().optional().describe("Maximum time to wait for user response in seconds (default: 300s = 5 minutes). After timeout, request is automatically cancelled.")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetInteractionsTool = z.object({
  name: z.literal("browser_get_interactions"),
  description: z.literal(
    "Retrieve user interactions from the background audit log. Interactions are continuously recorded in the background while connected to a tab. Query any time segment with flexible filtering."
  ),
  arguments: z.object({
    startTime: z.number().optional().describe("Start time as Unix timestamp in ms, or negative offset from now (e.g., -60000 = last minute)"),
    endTime: z.number().optional().describe("End time as Unix timestamp in ms, or negative offset from now"),
    limit: z.number().optional().describe("Maximum number of interactions to return (default: 50)"),
    offset: z.number().optional().describe("Skip first N interactions for pagination (default: 0)"),
    types: z.array(z.string()).optional().describe("Filter by interaction types (e.g., ['click', 'keyboard', 'scroll', 'navigation'])"),
    urlPattern: z.string().optional().describe("Filter by URL regex pattern"),
    selectorPattern: z.string().optional().describe("Filter by CSS selector regex pattern"),
    sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort order by timestamp (default: desc - newest first)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var PruneInteractionsTool = z.object({
  name: z.literal("browser_prune_interactions"),
  description: z.literal(
    "Remove interactions from the background audit log based on various criteria. Allows selective pruning by time, count, type, or pattern."
  ),
  arguments: z.object({
    before: z.number().optional().describe("Remove all interactions before this Unix timestamp in ms"),
    after: z.number().optional().describe("Remove all interactions after this Unix timestamp in ms"),
    between: z.tuple([z.number(), z.number()]).optional().describe("Remove interactions within time range [startTime, endTime] in ms"),
    keepLast: z.number().optional().describe("Keep only the last N interactions, remove all older ones"),
    keepFirst: z.number().optional().describe("Keep only the first N interactions, remove all newer ones"),
    removeOldest: z.number().optional().describe("Remove the oldest N interactions"),
    types: z.array(z.string()).optional().describe("Remove only these interaction types"),
    excludeTypes: z.array(z.string()).optional().describe("Remove all interactions except these types"),
    urlPattern: z.string().optional().describe("Remove interactions matching this URL regex"),
    selectorPattern: z.string().optional().describe("Remove interactions matching this selector regex")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SearchInteractionsTool = z.object({
  name: z.literal("browser_search_interactions"),
  description: z.literal(
    "Search the background interaction log using text queries. Searches across selectors, values, URLs, and element text content."
  ),
  arguments: z.object({
    query: z.string().describe("Text to search for in interactions (searches selectors, values, URLs, element text)"),
    types: z.array(z.string()).optional().describe("Filter by interaction types"),
    startTime: z.number().optional().describe("Start time filter (Unix timestamp in ms or negative offset)"),
    endTime: z.number().optional().describe("End time filter (Unix timestamp in ms or negative offset)"),
    limit: z.number().optional().describe("Maximum number of results (default: 50)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetCookiesTool = z.object({
  name: z.literal("browser_get_cookies"),
  description: z.literal("Get cookies for a specific URL or all cookies"),
  arguments: z.object({
    url: z.string().optional().describe("URL to get cookies for (if not provided, gets all cookies)"),
    name: z.string().optional().describe("Filter by cookie name"),
    domain: z.string().optional().describe("Filter by cookie domain")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SetCookieTool = z.object({
  name: z.literal("browser_set_cookie"),
  description: z.literal("Set a cookie for a specific URL"),
  arguments: z.object({
    url: z.string().describe("URL to set the cookie for"),
    name: z.string().describe("Cookie name"),
    value: z.string().describe("Cookie value"),
    domain: z.string().optional().describe("Cookie domain"),
    path: z.string().optional().describe("Cookie path (default: /)"),
    secure: z.boolean().optional().describe("Secure flag (default: false)"),
    httpOnly: z.boolean().optional().describe("HttpOnly flag (default: false)"),
    sameSite: z.enum(["no_restriction", "lax", "strict"]).optional().describe("SameSite attribute"),
    expirationDate: z.number().optional().describe("Expiration date in Unix timestamp (seconds since epoch)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteCookieTool = z.object({
  name: z.literal("browser_delete_cookie"),
  description: z.literal("Delete a specific cookie"),
  arguments: z.object({
    url: z.string().describe("URL of the cookie to delete"),
    name: z.string().describe("Name of the cookie to delete")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ClearCookiesTool = z.object({
  name: z.literal("browser_clear_cookies"),
  description: z.literal("Clear all cookies, optionally filtered by URL or domain"),
  arguments: z.object({
    url: z.string().optional().describe("Only clear cookies for this URL"),
    domain: z.string().optional().describe("Only clear cookies for this domain")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DownloadFileTool = z.object({
  name: z.literal("browser_download_file"),
  description: z.literal("Download a file from a URL"),
  arguments: z.object({
    url: z.string().describe("URL of the file to download"),
    filename: z.string().optional().describe("Suggested filename for the download"),
    saveAs: z.boolean().optional().describe("Whether to prompt user for save location (default: false)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetDownloadsTool = z.object({
  name: z.literal("browser_get_downloads"),
  description: z.literal("Get list of downloads with optional filtering"),
  arguments: z.object({
    query: z.array(z.string()).optional().describe("Search query terms to filter downloads"),
    orderBy: z.array(z.enum(["startTime", "endTime", "url", "filename", "bytesReceived"])).optional().describe("Fields to order results by"),
    limit: z.number().optional().describe("Maximum number of downloads to return")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CancelDownloadTool = z.object({
  name: z.literal("browser_cancel_download"),
  description: z.literal("Cancel a download in progress"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to cancel")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var OpenDownloadTool = z.object({
  name: z.literal("browser_open_download"),
  description: z.literal("Open a downloaded file"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to open")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetClipboardTool = z.object({
  name: z.literal("browser_get_clipboard"),
  description: z.literal("Read text from the clipboard"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var SetClipboardTool = z.object({
  name: z.literal("browser_set_clipboard"),
  description: z.literal("Write text to the clipboard"),
  arguments: z.object({
    text: z.string().describe("Text to write to the clipboard")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SearchHistoryTool = z.object({
  name: z.literal("browser_search_history"),
  description: z.literal("Search browsing history"),
  arguments: z.object({
    text: z.string().describe("Text to search for in history"),
    startTime: z.number().optional().describe("Start time in milliseconds since epoch"),
    endTime: z.number().optional().describe("End time in milliseconds since epoch"),
    maxResults: z.number().optional().describe("Maximum number of results to return (default: 100)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetHistoryVisitsTool = z.object({
  name: z.literal("browser_get_history_visits"),
  description: z.literal("Get visit details for a URL"),
  arguments: z.object({
    url: z.string().describe("URL to get visit history for")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteHistoryTool = z.object({
  name: z.literal("browser_delete_history"),
  description: z.literal("Delete specific URLs from history"),
  arguments: z.object({
    urls: z.array(z.string()).describe("URLs to delete from history")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ClearHistoryTool = z.object({
  name: z.literal("browser_clear_history"),
  description: z.literal("Clear browsing history for a time range"),
  arguments: z.object({
    startTime: z.number().describe("Start time in milliseconds since epoch"),
    endTime: z.number().describe("End time in milliseconds since epoch")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetVersionTool = z.object({
  name: z.literal("browser_get_version"),
  description: z.literal("Get browser version information"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetSystemInfoTool = z.object({
  name: z.literal("browser_get_system_info"),
  description: z.literal("Get system information including OS, platform, and architecture"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetBrowserInfoTool = z.object({
  name: z.literal("browser_get_browser_info"),
  description: z.literal("Get browser capabilities and information"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetNetworkStateTool = z.object({
  name: z.literal("browser_get_network_state"),
  description: z.literal("Get current network connection state"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var SetNetworkConditionsTool = z.object({
  name: z.literal("browser_set_network_conditions"),
  description: z.literal("Set network throttling conditions for testing"),
  arguments: z.object({
    offline: z.boolean().optional().describe("Simulate offline mode (default: false)"),
    latency: z.number().optional().describe("Minimum latency in milliseconds (default: 0)"),
    downloadThroughput: z.number().optional().describe("Download throughput in bytes/sec (default: -1 for unlimited)"),
    uploadThroughput: z.number().optional().describe("Upload throughput in bytes/sec (default: -1 for unlimited)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ClearCacheTool = z.object({
  name: z.literal("browser_clear_cache"),
  description: z.literal("Clear browser cache"),
  arguments: z.object({
    cacheStorage: z.boolean().optional().describe("Clear cache storage (default: true)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var GetBookmarksTool = z.object({
  name: z.literal("browser_get_bookmarks"),
  description: z.literal("Get bookmarks from the browser"),
  arguments: z.object({
    parentId: z.string().optional().describe("Parent folder ID to get bookmarks from (default: root)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var CreateBookmarkTool = z.object({
  name: z.literal("browser_create_bookmark"),
  description: z.literal("Create a new bookmark"),
  arguments: z.object({
    title: z.string().describe("Bookmark title"),
    url: z.string().describe("Bookmark URL"),
    parentId: z.string().optional().describe("Parent folder ID (default: root)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteBookmarkTool = z.object({
  name: z.literal("browser_delete_bookmark"),
  description: z.literal("Delete a bookmark by ID"),
  arguments: z.object({
    id: z.string().describe("Bookmark ID to delete")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var SearchBookmarksTool = z.object({
  name: z.literal("browser_search_bookmarks"),
  description: z.literal("Search bookmarks by query"),
  arguments: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().optional().describe("Maximum number of results (default: 100)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListExtensionsTool = z.object({
  name: z.literal("browser_list_extensions"),
  description: z.literal("List all installed browser extensions"),
  arguments: TabTargetSchema.merge(MaxTokensSchema)
});
var GetExtensionInfoTool = z.object({
  name: z.literal("browser_get_extension_info"),
  description: z.literal("Get detailed information about a specific extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var EnableExtensionTool = z.object({
  name: z.literal("browser_enable_extension"),
  description: z.literal("Enable a disabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to enable")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DisableExtensionTool = z.object({
  name: z.literal("browser_disable_extension"),
  description: z.literal("Disable an enabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to disable")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var StoreMacroTool = z.object({
  name: z.literal("browser_store_macro"),
  description: z.literal("Store a new executable JavaScript macro for site-specific automation. Macros are reusable functions that encapsulate common workflows like searching, extracting data, or interacting with specific sites."),
  arguments: z.object({
    site: z.string().describe("Site domain (e.g., 'amazon.com') or '*' for universal macros"),
    category: z.string().describe("Macro category: 'search', 'extraction', 'navigation', 'interaction', 'form', 'util'"),
    name: z.string().describe("Human-readable macro name (unique per site)"),
    description: z.string().describe("What the macro does and when to use it"),
    parameters: z.record(z.object({
      type: z.enum(["string", "number", "boolean", "object", "array"]).describe("Parameter data type"),
      description: z.string().describe("What this parameter is for"),
      required: z.boolean().describe("Whether this parameter is required"),
      default: z.any().optional().describe("Default value if not provided")
    })).describe("Macro parameters schema"),
    code: z.string().describe("JavaScript function code: (params) => { /* your code */ return result; }"),
    returnType: z.string().describe("Description of what the macro returns"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Reliability rating (default: untested)"),
    tags: z.array(z.string()).optional().describe("Tags for filtering and search")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListMacrosTool = z.object({
  name: z.literal("browser_list_macros"),
  description: z.literal("List available macros with optional filtering by site, category, or tags. Returns macro metadata without the code."),
  arguments: z.object({
    site: z.string().optional().describe("Filter by site domain or '*' for universal"),
    category: z.string().optional().describe("Filter by category: search, extraction, navigation, interaction, form, util"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns macros matching ANY tag)"),
    search: z.string().optional().describe("Search in name and description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Filter by reliability rating"),
    limit: z.number().optional().describe("Maximum number of results (default: 50)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ExecuteMacroTool = z.object({
  name: z.literal("browser_execute_macro"),
  description: z.literal("Execute a stored macro by ID with provided parameters. The macro runs in the page context and returns the result."),
  arguments: z.object({
    id: z.string().describe("Macro ID to execute"),
    params: z.record(z.any()).optional().describe("Parameters to pass to the macro function")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var UpdateMacroTool = z.object({
  name: z.literal("browser_update_macro"),
  description: z.literal("Update an existing macro. Creates a new version while preserving the old one. Only the owner can update macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to update"),
    description: z.string().optional().describe("Updated description"),
    parameters: z.record(z.object({
      type: z.enum(["string", "number", "boolean", "object", "array"]),
      description: z.string(),
      required: z.boolean(),
      default: z.any().optional()
    })).optional().describe("Updated parameters schema"),
    code: z.string().optional().describe("Updated JavaScript code"),
    returnType: z.string().optional().describe("Updated return type description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Updated reliability rating"),
    tags: z.array(z.string()).optional().describe("Updated tags")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var DeleteMacroTool = z.object({
  name: z.literal("browser_delete_macro"),
  description: z.literal("Delete a macro by ID. This action cannot be undone. Only the owner can delete macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to delete")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RealisticMouseMoveTool = z.object({
  name: z.literal("browser_realistic_mouse_move"),
  description: z.literal("Move mouse cursor along a natural bezier curve path to target coordinates. More human-like than instant positioning. Uses CDP Input domain for OS-level events."),
  arguments: z.object({
    x: z.number().describe("Target X coordinate"),
    y: z.number().describe("Target Y coordinate"),
    duration: z.number().optional().describe("Movement duration in milliseconds (default: 500)"),
    currentX: z.number().optional().describe("Current mouse X position (default: 0)"),
    currentY: z.number().optional().describe("Current mouse Y position (default: 0)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RealisticClickTool = z.object({
  name: z.literal("browser_realistic_click"),
  description: z.literal("Perform a realistic click at coordinates with human-like timing and optional mouse movement. Supports double-clicks. Uses CDP Input domain for OS-level events."),
  arguments: z.object({
    x: z.number().describe("Target X coordinate to click"),
    y: z.number().describe("Target Y coordinate to click"),
    button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button to click (default: 'left')"),
    clickCount: z.number().optional().describe("Number of clicks - 1 for single, 2 for double (default: 1)"),
    moveFirst: z.boolean().optional().describe("Whether to move mouse to position first with bezier curve (default: true)"),
    moveDuration: z.number().optional().describe("Duration of mouse movement in ms if moveFirst is true (default: 300)"),
    currentX: z.number().optional().describe("Current mouse X position for movement calculation (default: 0)"),
    currentY: z.number().optional().describe("Current mouse Y position for movement calculation (default: 0)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var RealisticTypeTool = z.object({
  name: z.literal("browser_realistic_type"),
  description: z.literal("Type text with realistic human-like timing and optional typos. Variable delays between keystrokes. Uses CDP Input domain for OS-level keyboard events."),
  arguments: z.object({
    text: z.string().describe("Text to type"),
    minDelay: z.number().optional().describe("Minimum delay between keystrokes in ms (default: 50)"),
    maxDelay: z.number().optional().describe("Maximum delay between keystrokes in ms (default: 150)"),
    mistakeChance: z.number().optional().describe("Probability of making a typo that gets corrected, 0-1 (default: 0)"),
    pressEnter: z.boolean().optional().describe("Whether to press Enter after typing (default: false)")
  }).merge(TabTargetSchema).merge(MaxTokensSchema)
});
var ListAttachedTabsTool = z.object({
  name: z.literal("browser_list_attached_tabs"),
  description: z.literal(
    "List all tabs that have debugger attached with their labels. Use this to see available tabs and their labels for targeting specific tabs."
  ),
  arguments: z.object({}).merge(MaxTokensSchema)
});
var SetTabLabelTool = z.object({
  name: z.literal("browser_set_tab_label"),
  description: z.literal(
    "Set or update a tab's label. Labels are used to identify tabs in a human-readable way."
  ),
  arguments: z.object({
    tabTarget: z.union([z.number(), z.string()]).describe("Tab identifier (tab ID or current label) of the tab to update"),
    label: z.string().describe("The new label for the tab")
  }).merge(MaxTokensSchema)
});
var DetachTabTool = z.object({
  name: z.literal("browser_detach_tab"),
  description: z.literal(
    "Detach debugger from a specific tab. This removes the tab from the list of attached tabs."
  ),
  arguments: z.object({
    tabId: z.number().describe("The tab ID to detach from")
  }).merge(MaxTokensSchema)
});
var GetActiveTabTool = z.object({
  name: z.literal("browser_get_active_tab"),
  description: z.literal(
    "Get information about the currently active (last-used) tab. Returns tab ID, label, URL, and last used timestamp."
  ),
  arguments: z.object({}).merge(MaxTokensSchema)
});
var AttachTabTool = z.object({
  name: z.literal("browser_attach_tab"),
  description: z.literal(
    "Attach debugger to a browser tab. Can attach to an existing tab by ID or open a new tab with a URL. Use this to start controlling a tab before performing operations on it."
  ),
  arguments: z.object({
    tabId: z.number().optional().describe("The tab ID to attach to (if attaching to existing tab)"),
    autoOpenUrl: z.string().optional().describe("URL to open in a new tab and attach to (if opening new tab)"),
    label: z.string().optional().describe("Optional label to assign to the tab after attaching")
  }).merge(MaxTokensSchema)
});
var LaunchIsolatedChromeTool = z.object({
  name: z.literal("browser_launch_isolated_chrome"),
  description: z.literal(
    "Launch Chrome in isolated mode with the Browser MCP extension pre-loaded. Creates an isolated profile separate from your main browser, useful for testing, automation, and development. The extension will auto-connect to the MCP server."
  ),
  arguments: z.object({
    profileName: z.string().optional().describe("Name for the isolated profile (default: 'browser-mcp-test'). Each profile is stored separately in .chrome-profiles/"),
    url: z.union([z.string(), z.array(z.string())]).optional().describe("URL or array of URLs to open on launch (default: chrome://extensions/)"),
    width: z.number().optional().describe("Window width in pixels"),
    height: z.number().optional().describe("Window height in pixels"),
    headless: z.boolean().optional().describe("Launch in headless mode (default: false)"),
    freshProfile: z.boolean().optional().describe("Always start with a fresh profile, deleting any existing data (cookies, history, etc.). Default: true. Set to false to persist profile data between sessions.")
  }).merge(MaxTokensSchema)
});

// src/utils/response-helpers.ts
import { encodingForModel } from "js-tiktoken";
var DEFAULT_MAX_TOKENS = process.env.MAX_MCP_OUTPUT_TOKENS ? parseInt(process.env.MAX_MCP_OUTPUT_TOKENS, 10) : 25e3;
var tokenEncoder = null;
function getTokenEncoder() {
  if (!tokenEncoder) {
    tokenEncoder = encodingForModel("gpt-4");
  }
  return tokenEncoder;
}
function estimateTokens(text) {
  try {
    const encoder = getTokenEncoder();
    return encoder.encode(text).length;
  } catch (error) {
    return Math.ceil(text.length / 4);
  }
}
function truncateToTokens(text, maxTokens) {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) {
    return text;
  }
  let left = 0;
  let right = text.length;
  let bestLength = 0;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const truncated2 = text.substring(0, mid);
    const tokens = estimateTokens(truncated2);
    if (tokens <= maxTokens - 100) {
      bestLength = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  const truncated = text.substring(0, bestLength);
  const truncationNotice = `

[... Response truncated: ${currentTokens} tokens \u2192 ${maxTokens} tokens limit. Original size: ${text.length} chars, truncated to: ${bestLength} chars ...]`;
  return truncated + truncationNotice;
}
function jsonResponse(data, pretty = true, maxTokens = DEFAULT_MAX_TOKENS) {
  let text = JSON.stringify(data, null, pretty ? 2 : 0);
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
function textResponse(text, maxTokens = DEFAULT_MAX_TOKENS) {
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
function imageResponse(base64Data, mimeType = "image/png", maxTokens = DEFAULT_MAX_TOKENS) {
  if (maxTokens && maxTokens > 0) {
    const currentTokens = estimateTokens(base64Data);
    if (currentTokens > maxTokens) {
      const errorMsg = `[Image Response Truncated]

Image size (${currentTokens} tokens) exceeds maximum allowed tokens (${maxTokens}).

Original data size: ${base64Data.length} characters
Estimated tokens: ${currentTokens}
Limit: ${maxTokens} tokens

Consider:
1. Reducing screenshot area
2. Taking screenshot of specific element instead of full page
3. Using lower quality/resolution
4. Increasing MAX_MCP_OUTPUT_TOKENS environment variable`;
      return {
        content: [
          {
            type: "text",
            text: errorMsg
          }
        ]
      };
    }
  }
  return {
    content: [
      {
        type: "image",
        data: base64Data,
        mimeType
      }
    ]
  };
}
function errorResponse(message, includeStack = false, error, maxTokens = DEFAULT_MAX_TOKENS) {
  let text = message;
  if (includeStack && error?.stack) {
    text += `

Stack trace:
${error.stack}`;
  }
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    isError: true
  };
}

// src/tools/bookmarks.ts
var getBookmarks = {
  schema: {
    name: GetBookmarksTool.shape.name.value,
    description: GetBookmarksTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetBookmarksTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = GetBookmarksTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_bookmarks", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to get bookmarks: ${error.message}`, false, error, max_tokens);
    }
  }
};
var createBookmark = {
  schema: {
    name: CreateBookmarkTool.shape.name.value,
    description: CreateBookmarkTool.shape.description.value,
    inputSchema: zodToJsonSchema(CreateBookmarkTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = CreateBookmarkTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_create_bookmark", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to create bookmark: ${error.message}`, false, error, max_tokens);
    }
  }
};
var deleteBookmark = {
  schema: {
    name: DeleteBookmarkTool.shape.name.value,
    description: DeleteBookmarkTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteBookmarkTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = DeleteBookmarkTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_delete_bookmark", validatedParams);
      return textResponse(`Bookmark deleted successfully (ID: ${validatedParams.id})`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to delete bookmark: ${error.message}`, false, error, max_tokens);
    }
  }
};
var searchBookmarks = {
  schema: {
    name: SearchBookmarksTool.shape.name.value,
    description: SearchBookmarksTool.shape.description.value,
    inputSchema: zodToJsonSchema(SearchBookmarksTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = SearchBookmarksTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_search_bookmarks", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to search bookmarks: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/clipboard.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getClipboard = {
  schema: {
    name: GetClipboardTool.shape.name.value,
    description: GetClipboardTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetClipboardTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = GetClipboardTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_clipboard", validatedParams);
      return textResponse(result.text, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to get clipboard: ${error.message}`, false, error, max_tokens);
    }
  }
};
var setClipboard = {
  schema: {
    name: SetClipboardTool.shape.name.value,
    description: SetClipboardTool.shape.description.value,
    inputSchema: zodToJsonSchema2(SetClipboardTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = SetClipboardTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_set_clipboard", validatedParams);
      return textResponse(`Clipboard set to: ${validatedParams.text.substring(0, 50)}${validatedParams.text.length > 50 ? "..." : ""}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to set clipboard: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/common.ts
import { zodToJsonSchema as zodToJsonSchema3 } from "zod-to-json-schema";

// src/utils/aria-snapshot.ts
async function captureAriaSnapshot(context, status = "", tabTarget, maxTokens) {
  const url = await context.sendSocketMessage("getUrl", tabTarget !== void 0 ? { tabTarget } : void 0);
  const title = await context.sendSocketMessage("getTitle", tabTarget !== void 0 ? { tabTarget } : void 0);
  const snapshot2 = await context.sendSocketMessage("browser_snapshot", tabTarget !== void 0 ? { tabTarget } : void 0);
  return textResponse(
    `${status ? `${status}
` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot2}
\`\`\`
`,
    maxTokens
  );
}

// src/tools/common.ts
var navigate = (snapshot2) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema3(NavigateTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = NavigateTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_navigate", validatedParams);
      if (snapshot2) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse(`Navigated to ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to navigate: ${error.message}`, false, error, max_tokens);
    }
  }
});
var goBack = (snapshot2) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GoBackTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = GoBackTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_go_back", validatedParams);
      if (snapshot2) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse("Navigated back", max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to go back: ${error.message}`, false, error, max_tokens);
    }
  }
});
var goForward = (snapshot2) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GoForwardTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = GoForwardTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_go_forward", validatedParams);
      if (snapshot2) {
        return captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
      }
      return textResponse("Navigated forward", max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to go forward: ${error.message}`, false, error, max_tokens);
    }
  }
});
var wait = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema3(WaitTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const { time } = WaitTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_wait", { time });
      return textResponse(`Waited for ${time} seconds`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to wait: ${error.message}`, false, error, max_tokens);
    }
  }
};
var pressKey = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema3(PressKeyTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = PressKeyTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_press_key", validatedParams);
      return textResponse(`Pressed key ${validatedParams.key}`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to press key: ${error.message}`, false, error, max_tokens);
    }
  }
};
var scroll = {
  schema: {
    name: ScrollTool.shape.name.value,
    description: ScrollTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ScrollTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = ScrollTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_scroll", validatedParams);
      const x = validatedParams.x ?? 0;
      const y = validatedParams.y;
      return textResponse(`Scrolled by (${x}, ${y}) pixels`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to scroll: ${error.message}`, false, error, max_tokens);
    }
  }
};
var scrollToElement = {
  schema: {
    name: ScrollToElementTool.shape.name.value,
    description: ScrollToElementTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ScrollToElementTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = ScrollToElementTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_scroll_to_element", validatedParams);
      return textResponse(`Scrolled to "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to scroll to element: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/cookies.ts
import { zodToJsonSchema as zodToJsonSchema4 } from "zod-to-json-schema";
var getCookies = {
  schema: {
    name: GetCookiesTool.shape.name.value,
    description: GetCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema4(GetCookiesTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetCookiesTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_cookies", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get cookies: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var setCookie = {
  schema: {
    name: SetCookieTool.shape.name.value,
    description: SetCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema4(SetCookieTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SetCookieTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_set_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" set for ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to set cookie: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var deleteCookie = {
  schema: {
    name: DeleteCookieTool.shape.name.value,
    description: DeleteCookieTool.shape.description.value,
    inputSchema: zodToJsonSchema4(DeleteCookieTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = DeleteCookieTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_delete_cookie", validatedParams);
      return textResponse(`Cookie "${validatedParams.name}" deleted from ${validatedParams.url}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to delete cookie: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var clearCookies = {
  schema: {
    name: ClearCookiesTool.shape.name.value,
    description: ClearCookiesTool.shape.description.value,
    inputSchema: zodToJsonSchema4(ClearCookiesTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = ClearCookiesTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_clear_cookies", validatedParams);
      return textResponse(`Cleared ${result.count} cookie(s, max_tokens)`);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to clear cookies: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/custom.ts
import * as fs from "fs";
import * as path from "path";
import { zodToJsonSchema as zodToJsonSchema5 } from "zod-to-json-schema";
var getConsoleLogs = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(GetConsoleLogsTool.shape.arguments)
  },
  handle: async (context, _params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const consoleLogs = await context.sendSocketMessage(
        "browser_get_console_logs",
        {}
      );
      const text = consoleLogs.map((log) => JSON.stringify(log)).join("\n");
      return textResponse(text, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params || {};
      return errorResponse(`Failed to get console logs: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var screenshot = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema5(ScreenshotTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = ScreenshotTool.shape.arguments.parse(params2);
      const screenshot2 = await context.sendSocketMessage(
        "browser_screenshot",
        validatedParams
      );
      return imageResponse(screenshot2, "image/png", max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to capture screenshot: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var segmentedScreenshot = {
  schema: {
    name: SegmentedScreenshotTool.shape.name.value,
    description: SegmentedScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema5(SegmentedScreenshotTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SegmentedScreenshotTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage(
        "browser_segmented_screenshot",
        validatedParams
      );
      const { screenshots, failedSelectors } = result;
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
      const outputDir = validatedParams.outputDir || "/tmp";
      const prefix = validatedParams.prefix || "segment";
      const includeLabels = validatedParams.includeLabels || false;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const filePaths = [];
      for (let i = 0; i < screenshots.length; i++) {
        const { selector, base64Data, label } = screenshots[i];
        const sequenceNum = String(i + 1).padStart(3, "0");
        const labelPart = includeLabels && label ? `_${label}` : "";
        const filename = `${timestamp}_${prefix}_${sequenceNum}${labelPart}.png`;
        const filepath = path.join(outputDir, filename);
        const buffer = Buffer.from(base64Data, "base64");
        fs.writeFileSync(filepath, buffer);
        filePaths.push({
          path: filepath,
          selector,
          label,
          index: i + 1
        });
      }
      return jsonResponse(
        {
          success: true,
          count: filePaths.length,
          files: filePaths,
          failedSelectors,
          outputDir,
          timestamp
        },
        max_tokens
      );
    } catch (error) {
      return errorResponse(
        `Failed to capture segmented screenshots: ${error.message}`,
        false,
        error,
        max_tokens
      );
    }
  }
};
var evaluate = {
  schema: {
    name: EvaluateTool.shape.name.value,
    description: EvaluateTool.shape.description.value,
    inputSchema: zodToJsonSchema5(EvaluateTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = EvaluateTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        validatedParams
      );
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to evaluate JavaScript: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getNetworkLogs = {
  schema: {
    name: GetNetworkLogsTool.shape.name.value,
    description: GetNetworkLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(GetNetworkLogsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetNetworkLogsTool.shape.arguments.parse(params2);
      const networkLogs = await context.sendSocketMessage(
        "browser_get_network_logs",
        validatedParams
      );
      return jsonResponse(networkLogs, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get network logs: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/downloads.ts
import { zodToJsonSchema as zodToJsonSchema6 } from "zod-to-json-schema";
var downloadFile = {
  schema: {
    name: DownloadFileTool.shape.name.value,
    description: DownloadFileTool.shape.description.value,
    inputSchema: zodToJsonSchema6(DownloadFileTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = DownloadFileTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_download_file", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to download file: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getDownloads = {
  schema: {
    name: GetDownloadsTool.shape.name.value,
    description: GetDownloadsTool.shape.description.value,
    inputSchema: zodToJsonSchema6(GetDownloadsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetDownloadsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_downloads", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get downloads: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var cancelDownload = {
  schema: {
    name: CancelDownloadTool.shape.name.value,
    description: CancelDownloadTool.shape.description.value,
    inputSchema: zodToJsonSchema6(CancelDownloadTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = CancelDownloadTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_cancel_download", validatedParams);
      return textResponse(`Download ${validatedParams.downloadId} cancelled`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to cancel download: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var openDownload = {
  schema: {
    name: OpenDownloadTool.shape.name.value,
    description: OpenDownloadTool.shape.description.value,
    inputSchema: zodToJsonSchema6(OpenDownloadTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = OpenDownloadTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_open_download", validatedParams);
      return textResponse(`Opened download ${validatedParams.downloadId}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to open download: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/extensions.ts
import { zodToJsonSchema as zodToJsonSchema7 } from "zod-to-json-schema";
var listExtensions = {
  schema: {
    name: ListExtensionsTool.shape.name.value,
    description: ListExtensionsTool.shape.description.value,
    inputSchema: zodToJsonSchema7(ListExtensionsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = ListExtensionsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_list_extensions", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to list extensions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getExtensionInfo = {
  schema: {
    name: GetExtensionInfoTool.shape.name.value,
    description: GetExtensionInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema7(GetExtensionInfoTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetExtensionInfoTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_extension_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get extension info: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var enableExtension = {
  schema: {
    name: EnableExtensionTool.shape.name.value,
    description: EnableExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema7(EnableExtensionTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = EnableExtensionTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_enable_extension", validatedParams);
      return textResponse(`Extension enabled successfully (ID: ${validatedParams.id}, max_tokens)`);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to enable extension: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var disableExtension = {
  schema: {
    name: DisableExtensionTool.shape.name.value,
    description: DisableExtensionTool.shape.description.value,
    inputSchema: zodToJsonSchema7(DisableExtensionTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = DisableExtensionTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_disable_extension", validatedParams);
      return textResponse(`Extension disabled successfully (ID: ${validatedParams.id}, max_tokens)`);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to disable extension: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/exploration.ts
import { zodToJsonSchema as zodToJsonSchema8 } from "zod-to-json-schema";
var queryDOM = {
  schema: {
    name: QueryDOMTool.shape.name.value,
    description: QueryDOMTool.shape.description.value,
    inputSchema: zodToJsonSchema8(QueryDOMTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = QueryDOMTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_query_dom", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to query DOM: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getVisibleText = {
  schema: {
    name: GetVisibleTextTool.shape.name.value,
    description: GetVisibleTextTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetVisibleTextTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetVisibleTextTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_visible_text", validatedParams);
      return typeof result === "string" ? textResponse(result, max_tokens) : jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get visible text: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getComputedStyles = {
  schema: {
    name: GetComputedStylesTool.shape.name.value,
    description: GetComputedStylesTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetComputedStylesTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetComputedStylesTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_computed_styles", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get computed styles: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var checkVisibility = {
  schema: {
    name: CheckVisibilityTool.shape.name.value,
    description: CheckVisibilityTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CheckVisibilityTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = CheckVisibilityTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_check_visibility", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to check visibility: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getAttributes = {
  schema: {
    name: GetAttributesTool.shape.name.value,
    description: GetAttributesTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetAttributesTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetAttributesTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_attributes", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get attributes: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var countElements = {
  schema: {
    name: CountElementsTool.shape.name.value,
    description: CountElementsTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CountElementsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = CountElementsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_count_elements", validatedParams);
      return textResponse(`Found ${result} elements matching selector "${validatedParams.selector}"`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to count elements: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getPageMetadata = {
  schema: {
    name: GetPageMetadataTool.shape.name.value,
    description: GetPageMetadataTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetPageMetadataTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetPageMetadataTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_page_metadata", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get page metadata: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getFilteredAriaTree = {
  schema: {
    name: GetFilteredAriaTreeTool.shape.name.value,
    description: GetFilteredAriaTreeTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetFilteredAriaTreeTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetFilteredAriaTreeTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_filtered_aria_tree", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get filtered ARIA tree: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var findByText = {
  schema: {
    name: FindByTextTool.shape.name.value,
    description: FindByTextTool.shape.description.value,
    inputSchema: zodToJsonSchema8(FindByTextTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = FindByTextTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_find_by_text", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to find by text: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getFormValues = {
  schema: {
    name: GetFormValuesTool.shape.name.value,
    description: GetFormValuesTool.shape.description.value,
    inputSchema: zodToJsonSchema8(GetFormValuesTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetFormValuesTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_form_values", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get form values: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var checkElementState = {
  schema: {
    name: CheckElementStateTool.shape.name.value,
    description: CheckElementStateTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CheckElementStateTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = CheckElementStateTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_check_element_state", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to check element state: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/forms.ts
import zodToJsonSchema9 from "zod-to-json-schema";
var fillForm = {
  schema: {
    name: FillFormTool.shape.name.value,
    description: FillFormTool.shape.description.value,
    inputSchema: zodToJsonSchema9(FillFormTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = FillFormTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_fill_form", validatedParams);
      return textResponse(`Filled ${validatedParams.fields.length} form fields`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to fill form: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var submitForm = {
  schema: {
    name: SubmitFormTool.shape.name.value,
    description: SubmitFormTool.shape.description.value,
    inputSchema: zodToJsonSchema9(SubmitFormTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SubmitFormTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_submit_form", validatedParams);
      return textResponse(`Submitted form "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to submit form: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/history.ts
import { zodToJsonSchema as zodToJsonSchema10 } from "zod-to-json-schema";
var searchHistory = {
  schema: {
    name: SearchHistoryTool.shape.name.value,
    description: SearchHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema10(SearchHistoryTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SearchHistoryTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_search_history", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to search history: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getHistoryVisits = {
  schema: {
    name: GetHistoryVisitsTool.shape.name.value,
    description: GetHistoryVisitsTool.shape.description.value,
    inputSchema: zodToJsonSchema10(GetHistoryVisitsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetHistoryVisitsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_history_visits", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get history visits: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var deleteHistory = {
  schema: {
    name: DeleteHistoryTool.shape.name.value,
    description: DeleteHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema10(DeleteHistoryTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = DeleteHistoryTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_delete_history", validatedParams);
      return textResponse(`Deleted ${validatedParams.urls.length} URL(s, max_tokens) from history`);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to delete history: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var clearHistory = {
  schema: {
    name: ClearHistoryTool.shape.name.value,
    description: ClearHistoryTool.shape.description.value,
    inputSchema: zodToJsonSchema10(ClearHistoryTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = ClearHistoryTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_clear_history", validatedParams);
      const startDate = new Date(validatedParams.startTime).toISOString();
      const endDate = new Date(validatedParams.endTime).toISOString();
      return textResponse(`Cleared history from ${startDate} to ${endDate}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to clear history: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/interactions.ts
import { zodToJsonSchema as zodToJsonSchema11 } from "zod-to-json-schema";
var getInteractions = {
  schema: {
    name: GetInteractionsTool.shape.name.value,
    description: GetInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema11(GetInteractionsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetInteractionsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_interactions", validatedParams);
      const interactions = result.interactions || [];
      const totalCount = result.totalCount || 0;
      const bufferSize = result.bufferSize || 0;
      let summary = `# Interaction Log

`;
      summary += `**Retrieved**: ${interactions.length} of ${totalCount} total interactions
`;
      summary += `**Buffer size**: ${bufferSize} interactions
`;
      if (validatedParams.startTime || validatedParams.endTime) {
        summary += `**Time range**: `;
        if (validatedParams.startTime) {
          summary += `${validatedParams.startTime < 0 ? `${validatedParams.startTime}ms ago` : new Date(validatedParams.startTime).toISOString()}`;
        }
        if (validatedParams.endTime) {
          summary += ` to ${validatedParams.endTime < 0 ? `${validatedParams.endTime}ms ago` : new Date(validatedParams.endTime).toISOString()}`;
        }
        summary += `
`;
      }
      if (validatedParams.types && validatedParams.types.length > 0) {
        summary += `**Filtered by types**: ${validatedParams.types.join(", ")}
`;
      }
      summary += `
## Interactions

`;
      for (const interaction of interactions) {
        const timestamp = new Date(interaction.timestamp).toISOString();
        summary += `**${interaction.type}** (${timestamp})
`;
        if (interaction.url) {
          summary += `  - URL: ${interaction.url}
`;
        }
        if (interaction.element) {
          summary += `  - Element: ${interaction.element.tagName}`;
          if (interaction.element.text) summary += ` "${interaction.element.text}"`;
          summary += `
`;
          if (interaction.element.selector) {
            summary += `  - Selector: \`${interaction.element.selector}\`
`;
          }
        }
        if (interaction.value) {
          summary += `  - Value: "${interaction.value}"
`;
        }
        if (interaction.key) {
          summary += `  - Key: ${interaction.key}
`;
        }
        if (interaction.x !== void 0 && interaction.y !== void 0) {
          summary += `  - Position: (${interaction.x}, ${interaction.y})
`;
        }
        summary += `
`;
      }
      if (interactions.length === 0) {
        summary += `No interactions found matching the specified criteria.
`;
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get interactions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var pruneInteractions = {
  schema: {
    name: PruneInteractionsTool.shape.name.value,
    description: PruneInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema11(PruneInteractionsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = PruneInteractionsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_prune_interactions", validatedParams);
      const removedCount = result.removedCount || 0;
      const remainingCount = result.remainingCount || 0;
      let summary = `# Interaction Log Pruned

`;
      summary += `**Removed**: ${removedCount} interactions
`;
      summary += `**Remaining**: ${remainingCount} interactions

`;
      const criteria = [];
      if (validatedParams.before) {
        criteria.push(`before ${new Date(validatedParams.before).toISOString()}`);
      }
      if (validatedParams.after) {
        criteria.push(`after ${new Date(validatedParams.after).toISOString()}`);
      }
      if (validatedParams.between) {
        criteria.push(`between ${new Date(validatedParams.between[0]).toISOString()} and ${new Date(validatedParams.between[1]).toISOString()}`);
      }
      if (validatedParams.keepLast) {
        criteria.push(`kept last ${validatedParams.keepLast} interactions`);
      }
      if (validatedParams.keepFirst) {
        criteria.push(`kept first ${validatedParams.keepFirst} interactions`);
      }
      if (validatedParams.removeOldest) {
        criteria.push(`removed oldest ${validatedParams.removeOldest} interactions`);
      }
      if (validatedParams.types) {
        criteria.push(`types: ${validatedParams.types.join(", ")}`);
      }
      if (validatedParams.excludeTypes) {
        criteria.push(`excluded types: ${validatedParams.excludeTypes.join(", ")}`);
      }
      if (validatedParams.urlPattern) {
        criteria.push(`URL pattern: ${validatedParams.urlPattern}`);
      }
      if (validatedParams.selectorPattern) {
        criteria.push(`selector pattern: ${validatedParams.selectorPattern}`);
      }
      if (criteria.length > 0) {
        summary += `**Criteria**: ${criteria.join(", ")}
`;
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to prune interactions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var searchInteractions = {
  schema: {
    name: SearchInteractionsTool.shape.name.value,
    description: SearchInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema11(SearchInteractionsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SearchInteractionsTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_search_interactions", validatedParams);
      const interactions = result.interactions || [];
      const totalMatches = result.totalMatches || 0;
      let summary = `# Interaction Search Results

`;
      summary += `**Query**: "${validatedParams.query}"
`;
      summary += `**Found**: ${interactions.length} of ${totalMatches} total matches

`;
      if (validatedParams.types && validatedParams.types.length > 0) {
        summary += `**Filtered by types**: ${validatedParams.types.join(", ")}
`;
      }
      summary += `## Matches

`;
      for (const interaction of interactions) {
        const timestamp = new Date(interaction.timestamp).toISOString();
        summary += `**${interaction.type}** (${timestamp})
`;
        if (interaction.url) {
          summary += `  - URL: ${interaction.url}
`;
        }
        if (interaction.element) {
          summary += `  - Element: ${interaction.element.tagName}`;
          if (interaction.element.text) summary += ` "${interaction.element.text}"`;
          summary += `
`;
          if (interaction.element.selector) {
            summary += `  - Selector: \`${interaction.element.selector}\`
`;
          }
        }
        if (interaction.value) {
          summary += `  - Value: "${interaction.value}"
`;
        }
        if (interaction.matchedField) {
          summary += `  - Matched in: ${interaction.matchedField}
`;
        }
        summary += `
`;
      }
      if (interactions.length === 0) {
        summary += `No interactions found matching "${validatedParams.query}".
`;
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to search interactions: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/network.ts
import { zodToJsonSchema as zodToJsonSchema12 } from "zod-to-json-schema";
var getNetworkState = {
  schema: {
    name: GetNetworkStateTool.shape.name.value,
    description: GetNetworkStateTool.shape.description.value,
    inputSchema: zodToJsonSchema12(GetNetworkStateTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetNetworkStateTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_network_state", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get network state: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var setNetworkConditions = {
  schema: {
    name: SetNetworkConditionsTool.shape.name.value,
    description: SetNetworkConditionsTool.shape.description.value,
    inputSchema: zodToJsonSchema12(SetNetworkConditionsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SetNetworkConditionsTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_set_network_conditions", validatedParams);
      return textResponse("Network conditions updated successfully", max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to set network conditions: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var clearCache = {
  schema: {
    name: ClearCacheTool.shape.name.value,
    description: ClearCacheTool.shape.description.value,
    inputSchema: zodToJsonSchema12(ClearCacheTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = ClearCacheTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_clear_cache", validatedParams);
      return textResponse("Cache cleared successfully", max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to clear cache: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/snapshot.ts
import zodToJsonSchema13 from "zod-to-json-schema";
var snapshot = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema13(SnapshotTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = SnapshotTool.shape.arguments.parse(params2);
      return await captureAriaSnapshot(context, "", validatedParams.tabTarget, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to capture snapshot: ${error.message}`, false, error, max_tokens);
    }
  }
};
var click = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema13(ClickTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = ClickTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_click", validatedParams);
      return textResponse(`Clicked "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to click element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var drag = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema13(DragTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = DragTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_drag", validatedParams);
      return textResponse(`Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to drag element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var hover = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema13(HoverTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = HoverTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_hover", validatedParams);
      return textResponse(`Hovered over "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to hover over element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var type = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema13(TypeTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = TypeTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_type", validatedParams);
      return textResponse(`Typed "${validatedParams.text}" into "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to type into element: ${error.message}`, false, error, max_tokens);
    }
  }
};
var selectOption = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema13(SelectOptionTool.shape.arguments)
  },
  handle: async (context, params2) => {
    try {
      const { max_tokens } = params2 || {};
      await context.ensureAttached();
      const validatedParams = SelectOptionTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_select_option", validatedParams);
      return textResponse(`Selected option in "${validatedParams.element}"`, max_tokens);
    } catch (error) {
      const { max_tokens } = params2 || {};
      return errorResponse(`Failed to select option: ${error.message}`, false, error, max_tokens);
    }
  }
};

// src/tools/system.ts
import { zodToJsonSchema as zodToJsonSchema14 } from "zod-to-json-schema";
var getVersion = {
  schema: {
    name: GetVersionTool.shape.name.value,
    description: GetVersionTool.shape.description.value,
    inputSchema: zodToJsonSchema14(GetVersionTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetVersionTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_version", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get version: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getSystemInfo = {
  schema: {
    name: GetSystemInfoTool.shape.name.value,
    description: GetSystemInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema14(GetSystemInfoTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetSystemInfoTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_system_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get system info: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var getBrowserInfo = {
  schema: {
    name: GetBrowserInfoTool.shape.name.value,
    description: GetBrowserInfoTool.shape.description.value,
    inputSchema: zodToJsonSchema14(GetBrowserInfoTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetBrowserInfoTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_get_browser_info", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to get browser info: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/tabs.ts
import zodToJsonSchema15 from "zod-to-json-schema";
var listTabs = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema15(ListTabsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const tabs = await context.sendSocketMessage("browser_list_tabs", {});
      return textResponse(`Open tabs:
${JSON.stringify(tabs, null, 2)}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to list tabs: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var switchTab = {
  schema: {
    name: SwitchTabTool.shape.name.value,
    description: SwitchTabTool.shape.description.value,
    inputSchema: zodToJsonSchema15(SwitchTabTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = SwitchTabTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_switch_tab", validatedParams);
      return textResponse(`Switched to tab ${validatedParams.tabId}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to switch tab: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var createTab = {
  schema: {
    name: CreateTabTool.shape.name.value,
    description: CreateTabTool.shape.description.value,
    inputSchema: zodToJsonSchema15(CreateTabTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = CreateTabTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage(
        "browser_create_tab",
        validatedParams
      );
      return textResponse(`Created new tab ${result.tabId}${validatedParams.url ? ` at ${validatedParams.url}` : ""}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to create tab: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var closeTab = {
  schema: {
    name: CloseTabTool.shape.name.value,
    description: CloseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema15(CloseTabTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = CloseTabTool.shape.arguments.parse(params2);
      await context.sendSocketMessage("browser_close_tab", validatedParams);
      return textResponse(`Closed tab ${validatedParams.tabId}`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to close tab: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var createWindow = {
  schema: {
    name: CreateWindowTool.shape.name.value,
    description: CreateWindowTool.shape.description.value,
    inputSchema: zodToJsonSchema15(CreateWindowTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const validatedParams = CreateWindowTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_create_window", validatedParams);
      return jsonResponse(result, true, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to create window: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/user-action.ts
import { zodToJsonSchema as zodToJsonSchema16 } from "zod-to-json-schema";
var requestUserAction = (snapshot2) => ({
  schema: {
    name: RequestUserActionTool.shape.name.value,
    description: RequestUserActionTool.shape.description.value,
    inputSchema: zodToJsonSchema16(RequestUserActionTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const { request, timeout } = RequestUserActionTool.shape.arguments.parse(params2);
      const wsTimeoutMs = timeout ? timeout * 1e3 : 3e5;
      const result = await context.sendSocketMessage(
        "browser_request_user_action",
        { request },
        { timeoutMs: wsTimeoutMs }
      );
      const interactions = result.interactions || [];
      const status = result.status;
      const feedback = result.feedback;
      let summary = `# User Action Request

`;
      summary += `**Request**: ${request}
`;
      summary += `**Status**: ${status}
`;
      summary += `**Duration**: ${(result.duration / 1e3).toFixed(1)}s
`;
      summary += `**Start Time**: ${new Date(result.startTime).toISOString()}
`;
      summary += `**End Time**: ${new Date(result.endTime).toISOString()}
`;
      if (feedback) {
        summary += `**User Feedback**: ${feedback}
`;
      }
      summary += `
`;
      if (status === "rejected") {
        summary += `The user rejected this request.
`;
        if (feedback) {
          summary += `
**Reason provided**: ${feedback}
`;
        }
      } else if (status === "timeout") {
        summary += `The request timed out after ${timeout || 300}s.
`;
      } else {
        summary += `## Interactions Captured (${interactions.length})

`;
        if (interactions.length === 0) {
          summary += `No interactions were captured during this period.
`;
        } else {
          const grouped = interactions.reduce((acc, interaction) => {
            const type2 = interaction.type;
            if (!acc[type2]) acc[type2] = [];
            acc[type2].push(interaction);
            return acc;
          }, {});
          for (const [type2, items] of Object.entries(grouped)) {
            summary += `### ${type2} (${items.length})
`;
            for (const interaction of items.slice(0, 10)) {
              const time = new Date(interaction.timestamp).toISOString().split("T")[1].slice(0, -1);
              summary += `- **${time}** `;
              if (interaction.selector) {
                summary += `\`${interaction.selector}\` `;
              }
              if (interaction.element?.tagName) {
                summary += `<${interaction.element.tagName}> `;
              }
              if (interaction.element?.text) {
                summary += `"${interaction.element.text.slice(0, 50)}" `;
              }
              if (interaction.key) {
                summary += `Key: ${interaction.key} `;
              }
              if (interaction.value) {
                summary += `Value: "${interaction.value.slice(0, 50)}" `;
              }
              if (interaction.url) {
                summary += `URL: ${interaction.url} `;
              }
              summary += `
`;
            }
            if (items.length > 10) {
              summary += `... and ${items.length - 10} more ${type2} interactions
`;
            }
            summary += `
`;
          }
        }
      }
      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to request user action: ${error.message}`, false, error, max_tokens2);
    }
  }
});

// src/tools/macros.ts
import { zodToJsonSchema as zodToJsonSchema17 } from "zod-to-json-schema";
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
   * Default: mongodb://localhost:27017/browser_mcp
   */
  async connect(uri) {
    if (this.connected && this.client) {
      return;
    }
    const connectionUri = uri || process.env.MONGODB_URI || "mongodb://localhost:27017";
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
    inputSchema: zodToJsonSchema17(StoreMacroTool.shape.arguments)
  },
  handle: async (_context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = StoreMacroTool.shape.arguments.parse(params2);
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
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to store macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var listMacros = {
  schema: {
    name: ListMacrosTool.shape.name.value,
    description: ListMacrosTool.shape.description.value,
    inputSchema: zodToJsonSchema17(ListMacrosTool.shape.arguments)
  },
  handle: async (_context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = ListMacrosTool.shape.arguments.parse(params2 || {});
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
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to list macros: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var executeMacro = {
  schema: {
    name: ExecuteMacroTool.shape.name.value,
    description: ExecuteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(ExecuteMacroTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      await context.ensureAttached();
      const validatedParams = ExecuteMacroTool.shape.arguments.parse(params2);
      const macros = mongodb.getMacrosCollection();
      const macro = await macros.findOne({ id: validatedParams.id });
      if (!macro) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
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
          result.stack,
          max_tokens
        );
      }
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to execute macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var updateMacro = {
  schema: {
    name: UpdateMacroTool.shape.name.value,
    description: UpdateMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(UpdateMacroTool.shape.arguments)
  },
  handle: async (_context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = UpdateMacroTool.shape.arguments.parse(params2);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
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
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to update macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var deleteMacro = {
  schema: {
    name: DeleteMacroTool.shape.name.value,
    description: DeleteMacroTool.shape.description.value,
    inputSchema: zodToJsonSchema17(DeleteMacroTool.shape.arguments)
  },
  handle: async (_context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }
      const validatedParams = DeleteMacroTool.shape.arguments.parse(params2);
      const macros = mongodb.getMacrosCollection();
      const existing = await macros.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Macro with ID "${validatedParams.id}" not found`, true, void 0, max_tokens);
      }
      await macros.deleteOne({ id: validatedParams.id });
      return jsonResponse({
        success: true,
        message: `Macro "${existing.name}" deleted successfully`,
        id: existing.id
      });
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to delete macro: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/realistic-input.ts
import { zodToJsonSchema as zodToJsonSchema18 } from "zod-to-json-schema";
var realisticMouseMove = {
  schema: {
    name: RealisticMouseMoveTool.shape.name.value,
    description: RealisticMouseMoveTool.shape.description.value,
    inputSchema: zodToJsonSchema18(RealisticMouseMoveTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = RealisticMouseMoveTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_realistic_mouse_move", validatedParams);
      return textResponse(result.message || `Moved mouse to (${validatedParams.x}, ${validatedParams.y}, max_tokens)`);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to move mouse: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var realisticClick = {
  schema: {
    name: RealisticClickTool.shape.name.value,
    description: RealisticClickTool.shape.description.value,
    inputSchema: zodToJsonSchema18(RealisticClickTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = RealisticClickTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_realistic_click", validatedParams);
      return textResponse(result.message || `Clicked at (${validatedParams.x}, ${validatedParams.y}, max_tokens)`);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to click: ${error.message}`, false, error, max_tokens2);
    }
  }
};
var realisticType = {
  schema: {
    name: RealisticTypeTool.shape.name.value,
    description: RealisticTypeTool.shape.description.value,
    inputSchema: zodToJsonSchema18(RealisticTypeTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = RealisticTypeTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage("browser_realistic_type", validatedParams);
      const preview = validatedParams.text.substring(0, 50);
      const suffix = validatedParams.text.length > 50 ? "..." : "";
      return textResponse(result.message || `Typed: "${preview}${suffix}"`, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(`Failed to type: ${error.message}`, false, error, max_tokens2);
    }
  }
};

// src/tools/multi-tab-management.ts
import zodToJsonSchema19 from "zod-to-json-schema";
var listAttachedTabs = {
  schema: {
    name: ListAttachedTabsTool.shape.name.value,
    description: ListAttachedTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema19(ListAttachedTabsTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const result = await context.sendSocketMessage(
        "browser_list_attached_tabs",
        {}
      );
      if (!result.tabs || result.tabs.length === 0) {
        return textResponse("No tabs currently attached", max_tokens);
      }
      const tabList = result.tabs.map(
        (tab) => `- Tab ${tab.tabId} (${tab.label}): ${tab.title}
  URL: ${tab.url}
  Last used: ${new Date(tab.lastUsedAt).toLocaleString()}`
      ).join("\n");
      return textResponse(
        `Attached tabs (${result.tabs.length}):
${tabList}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(
        `Failed to list attached tabs: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var setTabLabel = {
  schema: {
    name: SetTabLabelTool.shape.name.value,
    description: SetTabLabelTool.shape.description.value,
    inputSchema: zodToJsonSchema19(SetTabLabelTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const validatedParams = SetTabLabelTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage(
        "browser_set_tab_label",
        validatedParams
      );
      return textResponse(
        `Updated tab ${validatedParams.tabTarget} label to "${validatedParams.label}"`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(
        `Failed to set tab label: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var detachTab = {
  schema: {
    name: DetachTabTool.shape.name.value,
    description: DetachTabTool.shape.description.value,
    inputSchema: zodToJsonSchema19(DetachTabTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      await context.ensureAttached();
      const validatedParams = DetachTabTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage(
        "browser_detach_tab",
        validatedParams
      );
      return textResponse(
        `Detached from tab ${validatedParams.tabId}${result.detachedLabel ? ` (${result.detachedLabel}, max_tokens)` : ""}`
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(
        `Failed to detach tab: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var getActiveTab = {
  schema: {
    name: GetActiveTabTool.shape.name.value,
    description: GetActiveTabTool.shape.description.value,
    inputSchema: zodToJsonSchema19(GetActiveTabTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const result = await context.sendSocketMessage(
        "browser_get_active_tab",
        {}
      );
      if (!result.hasActiveTab) {
        return textResponse("No tabs currently attached", max_tokens);
      }
      return textResponse(
        `Active tab: ${result.tabId} (${result.label})
Title: ${result.title}
URL: ${result.url}
Last used: ${new Date(result.lastUsedAt).toLocaleString()}`,
        max_tokens
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(
        `Failed to get active tab: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};
var attachTab = {
  schema: {
    name: AttachTabTool.shape.name.value,
    description: AttachTabTool.shape.description.value,
    inputSchema: zodToJsonSchema19(AttachTabTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const validatedParams = AttachTabTool.shape.arguments.parse(params2);
      const result = await context.sendSocketMessage(
        "browser_ensure_attached",
        validatedParams
      );
      return textResponse(
        `Attached to tab ${result.tabId}${result.label ? ` (${result.label}, max_tokens)` : ""}
URL: ${result.url}`
      );
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(
        `Failed to attach to tab: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};

// src/tools/chrome-launcher.ts
import { spawn } from "child_process";
import { zodToJsonSchema as zodToJsonSchema20 } from "zod-to-json-schema";
import * as path2 from "path";
import * as fs2 from "fs";
var launchedProcesses = /* @__PURE__ */ new Map();
function findChromeExecutable() {
  const possiblePaths = [
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];
  for (const chromePath of possiblePaths) {
    if (fs2.existsSync(chromePath)) {
      return chromePath;
    }
  }
  try {
    const { execSync } = __require("child_process");
    const commands = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];
    for (const cmd of commands) {
      try {
        const result = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
          encoding: "utf-8"
        }).trim();
        if (result && fs2.existsSync(result)) {
          return result;
        }
      } catch {
      }
    }
  } catch {
  }
  return null;
}
var launchIsolatedChrome = {
  schema: {
    name: LaunchIsolatedChromeTool.shape.name.value,
    description: LaunchIsolatedChromeTool.shape.description.value,
    inputSchema: zodToJsonSchema20(LaunchIsolatedChromeTool.shape.arguments)
  },
  handle: async (context, params2) => {
    const { max_tokens } = params2 || {};
    try {
      const validatedParams = LaunchIsolatedChromeTool.shape.arguments.parse(params2);
      const chromeBin = findChromeExecutable();
      if (!chromeBin) {
        return errorResponse(
          "Could not find Chrome or Chromium executable. Please install Chrome/Chromium or set the path manually.",
          false
        );
      }
      const projectRoot = path2.resolve(__dirname, "../..", max_tokens);
      const extensionDir = path2.join(projectRoot, "extension");
      const profilesDir = path2.join(projectRoot, ".chrome-profiles");
      if (!fs2.existsSync(extensionDir)) {
        return errorResponse(
          `Extension directory not found at ${extensionDir}`,
          false
        );
      }
      if (!fs2.existsSync(profilesDir)) {
        fs2.mkdirSync(profilesDir, { recursive: true }, max_tokens);
      }
      const profileName = validatedParams.profileName || "browser-mcp-test";
      const profileDir = path2.join(profilesDir, profileName);
      const freshProfile = validatedParams.freshProfile !== false;
      if (freshProfile && fs2.existsSync(profileDir)) {
        fs2.rmSync(profileDir, { recursive: true, force: true });
      }
      if (!fs2.existsSync(profileDir)) {
        fs2.mkdirSync(profileDir, { recursive: true });
      }
      let urls;
      if (!validatedParams.url) {
        urls = ["chrome://extensions/"];
      } else if (Array.isArray(validatedParams.url)) {
        urls = validatedParams.url;
      } else {
        urls = [validatedParams.url];
      }
      const chromeArgs = [
        `--user-data-dir=${profileDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-features=TranslateUI",
        "--disable-default-apps"
      ];
      if (validatedParams.width && validatedParams.height) {
        chromeArgs.push(`--window-size=${validatedParams.width},${validatedParams.height}`);
      }
      if (validatedParams.headless) {
        chromeArgs.push("--headless=new");
        chromeArgs.push("--disable-gpu");
      }
      chromeArgs.push(...urls);
      const chromeProcess = spawn(chromeBin, chromeArgs, {
        detached: true,
        stdio: "ignore"
      });
      chromeProcess.unref();
      if (chromeProcess.pid) {
        launchedProcesses.set(chromeProcess.pid, chromeProcess);
      }
      let message = `\u2713 Chrome launched in isolated mode
`;
      message += `  Profile: ${profileName} ${freshProfile ? "(fresh - no cookies/history)" : "(persistent)"}
`;
      message += `  Profile Directory: ${profileDir}
`;
      message += `  Extension: ${extensionDir}
`;
      message += `  PID: ${chromeProcess.pid}
`;
      message += `  URLs: ${urls.join(", ")}
`;
      if (validatedParams.headless) {
        message += `  Mode: Headless
`;
      }
      message += `
The extension will auto-connect to the MCP server at localhost:9010`;
      return textResponse(message, max_tokens);
    } catch (error) {
      const { max_tokens: max_tokens2 } = params2 || {};
      return errorResponse(
        `Failed to launch isolated Chrome: ${error.message}`,
        false,
        error,
        max_tokens2
      );
    }
  }
};

// package.json
var package_default = {
  name: "@unibrowse/mcp",
  version: "0.1.3",
  description: "MCP server bridging the gap between AI agents and browser automation",
  author: "unibrowse",
  bugs: "https://github.com/sackio/unibrowse/issues",
  type: "module",
  bin: {
    "mcp-server-unibrowse": "dist/http-server.js"
  },
  files: [
    "dist"
  ],
  scripts: {
    typecheck: "tsc --noEmit",
    build: "tsup src/http-server.ts src/stdio-server.ts --format esm && shx chmod +x dist/*.js",
    prepare: "npm run build",
    watch: "tsup src/http-server.ts src/stdio-server.ts --format esm --watch",
    dev: "nodemon",
    start: "node --env-file=.env dist/http-server.js",
    "start:stdio": "node dist/stdio-server.js",
    inspector: "CLIENT_PORT=9001 SERVER_PORT=9002 pnpx @modelcontextprotocol/inspector node dist/stdio-server.js",
    chrome: "./scripts/launch-chrome-isolated.sh",
    "test:prereq": "node tests/check-prerequisites.js",
    test: "node tests/test-all-tools.js",
    "test:multi-tab": "node tests/test-multi-tab.js",
    "test:window": "node tests/test-create-window.js",
    "test:utility-macros": "node tests/test-utility-macros.js",
    "test:advanced-macros": "node tests/test-advanced-macros.js",
    "store:macros": "node tests/store-utility-macros.js",
    "store:advanced-macros": "node tests/store-advanced-macros.js",
    "backup:test": "./scripts/backup-and-test.sh"
  },
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.20.0",
    commander: "^13.1.0",
    express: "^5.1.0",
    "js-tiktoken": "^1.0.15",
    mongodb: "^6.20.0",
    nodemon: "^3.1.10",
    uuid: "^13.0.0",
    ws: "^8.18.1",
    zod: "^3.24.2",
    "zod-to-json-schema": "^3.24.3"
  },
  devDependencies: {
    "@types/express": "^5.0.3",
    "@types/uuid": "^10.0.0",
    "@types/ws": "^8.18.0",
    shx: "^0.3.4",
    tsup: "^8.4.0",
    typescript: "^5.6.2"
  }
};

export {
  appConfig,
  createServerWithTools,
  createServerWithoutWebSocket,
  getBookmarks,
  createBookmark,
  deleteBookmark,
  searchBookmarks,
  getClipboard,
  setClipboard,
  navigate,
  goBack,
  goForward,
  wait,
  pressKey,
  scroll,
  scrollToElement,
  getCookies,
  setCookie,
  deleteCookie,
  clearCookies,
  getConsoleLogs,
  screenshot,
  segmentedScreenshot,
  evaluate,
  getNetworkLogs,
  downloadFile,
  getDownloads,
  cancelDownload,
  openDownload,
  listExtensions,
  getExtensionInfo,
  enableExtension,
  disableExtension,
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
  checkElementState,
  fillForm,
  submitForm,
  searchHistory,
  getHistoryVisits,
  deleteHistory,
  clearHistory,
  getInteractions,
  pruneInteractions,
  searchInteractions,
  getNetworkState,
  setNetworkConditions,
  clearCache,
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  getVersion,
  getSystemInfo,
  getBrowserInfo,
  listTabs,
  switchTab,
  createTab,
  closeTab,
  createWindow,
  requestUserAction,
  storeMacro,
  listMacros,
  executeMacro,
  updateMacro,
  deleteMacro,
  realisticMouseMove,
  realisticClick,
  realisticType,
  listAttachedTabs,
  setTabLabel,
  detachTab,
  getActiveTab,
  attachTab,
  launchIsolatedChrome,
  package_default
};
