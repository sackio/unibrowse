import {
  createWebSocketServer,
  mcpConfig
} from "./chunk-ITTVOQ2V.js";

// src/config/app.config.ts
var appConfig = {
  name: "Browser MCP",
  tagline: "Automate your browser with AI",
  description: "Browser MCP connects AI applications to your browser so you can automate tasks using AI. Supported by Claude, Cursor, VS Code, Windsurf, and more.",
  email: {
    defaultFrom: "support@mail.browsermcp.io"
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
    return new Promise((resolve, reject) => {
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
            resolve(result);
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
   * Get the currently active tab ID (where debugger is attached)
   */
  get activeTabId() {
    return this._activeTabId;
  }
  /**
   * Ensure debugger is attached to a tab (lazy attachment)
   * If no tabId is provided, attaches to the current active tab in the browser
   * If already attached to the requested tab, does nothing
   * If attached to a different tab, switches to the new tab
   *
   * @param tabId - Optional tab ID to attach to. If not provided, uses current active tab
   * @returns The tab ID that is now attached
   */
  async ensureAttached(tabId) {
    const result = await this.sendSocketMessage("browser_ensure_attached", {
      tabId: tabId ?? null
    });
    this._activeTabId = result.tabId;
    return result.tabId;
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
  const wss = providedWss || await createWebSocketServer();
  wss.on("connection", (websocket) => {
    if (globalContext.hasWs()) {
      globalContext.ws.close();
    }
    globalContext.ws = websocket;
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

// src/tools/common.ts
import { zodToJsonSchema } from "zod-to-json-schema";

// src/types/tool-schemas.ts
import { z } from "zod";
var ElementSchema = z.object({
  element: z.string().describe(
    "Human-readable element description used to obtain permission to interact with the element"
  ),
  ref: z.string().describe("Exact target element reference from the page snapshot")
});
var NavigateTool = z.object({
  name: z.literal("browser_navigate"),
  description: z.literal("Navigate to a URL"),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to")
  })
});
var GoBackTool = z.object({
  name: z.literal("browser_go_back"),
  description: z.literal("Go back to the previous page"),
  arguments: z.object({})
});
var GoForwardTool = z.object({
  name: z.literal("browser_go_forward"),
  description: z.literal("Go forward to the next page"),
  arguments: z.object({})
});
var WaitTool = z.object({
  name: z.literal("browser_wait"),
  description: z.literal("Wait for a specified time in seconds"),
  arguments: z.object({
    time: z.number().describe("The time to wait in seconds")
  })
});
var PressKeyTool = z.object({
  name: z.literal("browser_press_key"),
  description: z.literal("Press a key on the keyboard"),
  arguments: z.object({
    key: z.string().describe(
      "Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"
    )
  })
});
var ScrollTool = z.object({
  name: z.literal("browser_scroll"),
  description: z.literal("Scroll the page by a specific amount in pixels"),
  arguments: z.object({
    x: z.number().optional().describe("Horizontal scroll amount in pixels (positive = right, negative = left). Default: 0"),
    y: z.number().describe("Vertical scroll amount in pixels (positive = down, negative = up)")
  })
});
var ScrollToElementTool = z.object({
  name: z.literal("browser_scroll_to_element"),
  description: z.literal("Scroll to make a specific element visible in the viewport"),
  arguments: ElementSchema
});
var ListTabsTool = z.object({
  name: z.literal("browser_list_tabs"),
  description: z.literal("List all open browser tabs"),
  arguments: z.object({})
});
var SwitchTabTool = z.object({
  name: z.literal("browser_switch_tab"),
  description: z.literal("Switch to a specific browser tab"),
  arguments: z.object({
    tabId: z.number().describe("The ID of the tab to switch to")
  })
});
var CreateTabTool = z.object({
  name: z.literal("browser_create_tab"),
  description: z.literal("Create a new browser tab"),
  arguments: z.object({
    url: z.string().optional().describe("URL to open in the new tab (default: about:blank)")
  })
});
var CloseTabTool = z.object({
  name: z.literal("browser_close_tab"),
  description: z.literal("Close a specific browser tab"),
  arguments: z.object({
    tabId: z.number().describe("The ID of the tab to close")
  })
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
  })
});
var SubmitFormTool = z.object({
  name: z.literal("browser_submit_form"),
  description: z.literal("Submit a form"),
  arguments: ElementSchema
});
var GetNetworkLogsTool = z.object({
  name: z.literal("browser_get_network_logs"),
  description: z.literal("Get network requests and responses captured since page load"),
  arguments: z.object({
    filter: z.string().optional().describe("Optional filter to match URLs (e.g., 'api', '.json')")
  })
});
var SnapshotTool = z.object({
  name: z.literal("browser_snapshot"),
  description: z.literal(
    "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with."
  ),
  arguments: z.object({})
});
var ClickTool = z.object({
  name: z.literal("browser_click"),
  description: z.literal("Perform click on a web page"),
  arguments: ElementSchema
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
  })
});
var HoverTool = z.object({
  name: z.literal("browser_hover"),
  description: z.literal("Hover over element on page"),
  arguments: ElementSchema
});
var TypeTool = z.object({
  name: z.literal("browser_type"),
  description: z.literal("Type text into editable element"),
  arguments: ElementSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z.boolean().describe("Whether to submit entered text (press Enter after)")
  })
});
var SelectOptionTool = z.object({
  name: z.literal("browser_select_option"),
  description: z.literal("Select an option in a dropdown"),
  arguments: ElementSchema.extend({
    values: z.array(z.string()).describe(
      "Array of values to select in the dropdown. This can be a single value or multiple values."
    )
  })
});
var ScreenshotTool = z.object({
  name: z.literal("browser_screenshot"),
  description: z.literal("Take a screenshot of the current page"),
  arguments: z.object({})
});
var GetConsoleLogsTool = z.object({
  name: z.literal("browser_get_console_logs"),
  description: z.literal("Get the console logs from the browser"),
  arguments: z.object({})
});
var EvaluateTool = z.object({
  name: z.literal("browser_evaluate"),
  description: z.literal("Evaluate JavaScript expression on page or element"),
  arguments: z.object({
    expression: z.string().describe("JavaScript expression to evaluate in page context")
  })
});
var QueryDOMTool = z.object({
  name: z.literal("browser_query_dom"),
  description: z.literal(
    "Query DOM elements by CSS selector and return basic info without full ARIA tree"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector to query elements"),
    limit: z.number().optional().describe("Maximum number of elements to return (default: 10)")
  })
});
var GetVisibleTextTool = z.object({
  name: z.literal("browser_get_visible_text"),
  description: z.literal(
    "Get visible text content from the page or a specific element"
  ),
  arguments: z.object({
    selector: z.string().optional().describe("Optional CSS selector to get text from specific element"),
    maxLength: z.number().optional().describe("Maximum text length to return (default: 5000)")
  })
});
var GetComputedStylesTool = z.object({
  name: z.literal("browser_get_computed_styles"),
  description: z.literal("Get computed CSS styles for an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    properties: z.array(z.string()).optional().describe(
      "Specific CSS properties to retrieve (e.g. ['display', 'color']). If not specified, returns common layout properties."
    )
  })
});
var CheckVisibilityTool = z.object({
  name: z.literal("browser_check_visibility"),
  description: z.literal(
    "Check if element is visible, hidden, in viewport, or has specific display state"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element")
  })
});
var GetAttributesTool = z.object({
  name: z.literal("browser_get_attributes"),
  description: z.literal("Get all attributes or specific attributes of an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    attributes: z.array(z.string()).optional().describe(
      "Specific attributes to retrieve (e.g. ['href', 'class']). If not specified, returns all attributes."
    )
  })
});
var CountElementsTool = z.object({
  name: z.literal("browser_count_elements"),
  description: z.literal("Count number of elements matching a CSS selector"),
  arguments: z.object({
    selector: z.string().describe("CSS selector to count matching elements")
  })
});
var GetPageMetadataTool = z.object({
  name: z.literal("browser_get_page_metadata"),
  description: z.literal(
    "Get page metadata including title, description, Open Graph tags, schema.org data, etc."
  ),
  arguments: z.object({})
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
  })
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
  })
});
var GetFormValuesTool = z.object({
  name: z.literal("browser_get_form_values"),
  description: z.literal(
    "Get current values of all form fields in a form or the entire page"
  ),
  arguments: z.object({
    formSelector: z.string().optional().describe("Optional CSS selector for a specific form. If not specified, gets all form fields on the page.")
  })
});
var CheckElementStateTool = z.object({
  name: z.literal("browser_check_element_state"),
  description: z.literal(
    "Check element state: enabled/disabled, checked/unchecked, selected, readonly, required, etc."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element")
  })
});
var RequestDemonstrationTool = z.object({
  name: z.literal("browser_request_demonstration"),
  description: z.literal(
    "Ask the user to demonstrate how to perform a task. Shows a notification in the browser with a Start button. Records all DOM interactions and network activity until the user clicks Done or presses Ctrl+Shift+D."
  ),
  arguments: z.object({
    request: z.string().describe("Description of what you want the user to demonstrate (e.g., 'Please add an item to your cart')"),
    timeout: z.number().optional().describe("Maximum time to wait for the demonstration in seconds (default: no timeout - waits indefinitely). Specify a timeout only if you need to limit the duration.")
  })
});
var RequestUserActionTool = z.object({
  name: z.literal("browser_request_user_action"),
  description: z.literal(
    "Request the user to perform an action in the browser. Shows a notification and overlay with instructions. User can complete or reject the request. Captures all interactions from request to completion via the background log. More flexible than request_demonstration - use this for both learning workflows AND getting user assistance."
  ),
  arguments: z.object({
    request: z.string().describe("Clear instructions for what you want the user to do (e.g., 'Please navigate to your shopping cart and add an item')"),
    timeout: z.number().optional().describe("Maximum time to wait for user response in seconds (default: 300s = 5 minutes). After timeout, request is automatically cancelled.")
  })
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
  })
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
  })
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
  })
});

// src/utils/aria-snapshot.ts
async function captureAriaSnapshot(context, status = "") {
  const url = await context.sendSocketMessage("getUrl", void 0);
  const title = await context.sendSocketMessage("getTitle", void 0);
  const snapshot2 = await context.sendSocketMessage("browser_snapshot", {});
  return {
    content: [
      {
        type: "text",
        text: `${status ? `${status}
` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot2}
\`\`\`
`
      }
    ]
  };
}

// src/utils/response-helpers.ts
function jsonResponse(data, pretty = true) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, pretty ? 2 : 0)
      }
    ]
  };
}
function textResponse(text) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}
function imageResponse(base64Data, mimeType = "image/png") {
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
function errorResponse(message, includeStack = false, error) {
  let text = message;
  if (includeStack && error?.stack) {
    text += `

Stack trace:
${error.stack}`;
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

// src/tools/common.ts
var navigate = (snapshot2) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema(NavigateTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const { url } = NavigateTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_navigate", { url });
      if (snapshot2) {
        return captureAriaSnapshot(context);
      }
      return textResponse(`Navigated to ${url}`);
    } catch (error) {
      return errorResponse(`Failed to navigate: ${error.message}`, false, error);
    }
  }
});
var goBack = (snapshot2) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoBackTool.shape.arguments)
  },
  handle: async (context) => {
    try {
      await context.ensureAttached();
      await context.sendSocketMessage("browser_go_back", {});
      if (snapshot2) {
        return captureAriaSnapshot(context);
      }
      return textResponse("Navigated back");
    } catch (error) {
      return errorResponse(`Failed to go back: ${error.message}`, false, error);
    }
  }
});
var goForward = (snapshot2) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoForwardTool.shape.arguments)
  },
  handle: async (context) => {
    try {
      await context.ensureAttached();
      await context.sendSocketMessage("browser_go_forward", {});
      if (snapshot2) {
        return captureAriaSnapshot(context);
      }
      return textResponse("Navigated forward");
    } catch (error) {
      return errorResponse(`Failed to go forward: ${error.message}`, false, error);
    }
  }
});
var wait = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema(WaitTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const { time } = WaitTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_wait", { time });
      return textResponse(`Waited for ${time} seconds`);
    } catch (error) {
      return errorResponse(`Failed to wait: ${error.message}`, false, error);
    }
  }
};
var pressKey = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(PressKeyTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const { key } = PressKeyTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_press_key", { key });
      return textResponse(`Pressed key ${key}`);
    } catch (error) {
      return errorResponse(`Failed to press key: ${error.message}`, false, error);
    }
  }
};
var scroll = {
  schema: {
    name: ScrollTool.shape.name.value,
    description: ScrollTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScrollTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = ScrollTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll", validatedParams);
      const x = validatedParams.x ?? 0;
      const y = validatedParams.y;
      return textResponse(`Scrolled by (${x}, ${y}) pixels`);
    } catch (error) {
      return errorResponse(`Failed to scroll: ${error.message}`, false, error);
    }
  }
};
var scrollToElement = {
  schema: {
    name: ScrollToElementTool.shape.name.value,
    description: ScrollToElementTool.shape.description.value,
    inputSchema: zodToJsonSchema(ScrollToElementTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = ScrollToElementTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_scroll_to_element", validatedParams);
      return textResponse(`Scrolled to "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to scroll to element: ${error.message}`, false, error);
    }
  }
};

// src/tools/custom.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getConsoleLogs = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetConsoleLogsTool.shape.arguments)
  },
  handle: async (context, _params) => {
    try {
      await context.ensureAttached();
      const consoleLogs = await context.sendSocketMessage(
        "browser_get_console_logs",
        {}
      );
      const text = consoleLogs.map((log) => JSON.stringify(log)).join("\n");
      return textResponse(text);
    } catch (error) {
      return errorResponse(`Failed to get console logs: ${error.message}`, false, error);
    }
  }
};
var screenshot = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema2(ScreenshotTool.shape.arguments)
  },
  handle: async (context, _params) => {
    try {
      await context.ensureAttached();
      const screenshot2 = await context.sendSocketMessage(
        "browser_screenshot",
        {}
      );
      return imageResponse(screenshot2, "image/png");
    } catch (error) {
      return errorResponse(`Failed to capture screenshot: ${error.message}`, false, error);
    }
  }
};
var evaluate = {
  schema: {
    name: EvaluateTool.shape.name.value,
    description: EvaluateTool.shape.description.value,
    inputSchema: zodToJsonSchema2(EvaluateTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = EvaluateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_evaluate",
        validatedParams
      );
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to evaluate JavaScript: ${error.message}`, false, error);
    }
  }
};
var getNetworkLogs = {
  schema: {
    name: GetNetworkLogsTool.shape.name.value,
    description: GetNetworkLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetNetworkLogsTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetNetworkLogsTool.shape.arguments.parse(params);
      const networkLogs = await context.sendSocketMessage(
        "browser_get_network_logs",
        validatedParams
      );
      return jsonResponse(networkLogs);
    } catch (error) {
      return errorResponse(`Failed to get network logs: ${error.message}`, false, error);
    }
  }
};

// src/tools/exploration.ts
import { zodToJsonSchema as zodToJsonSchema3 } from "zod-to-json-schema";
var queryDOM = {
  schema: {
    name: QueryDOMTool.shape.name.value,
    description: QueryDOMTool.shape.description.value,
    inputSchema: zodToJsonSchema3(QueryDOMTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = QueryDOMTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_query_dom", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to query DOM: ${error.message}`, false, error);
    }
  }
};
var getVisibleText = {
  schema: {
    name: GetVisibleTextTool.shape.name.value,
    description: GetVisibleTextTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetVisibleTextTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetVisibleTextTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_visible_text", validatedParams);
      return typeof result === "string" ? textResponse(result) : jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get visible text: ${error.message}`, false, error);
    }
  }
};
var getComputedStyles = {
  schema: {
    name: GetComputedStylesTool.shape.name.value,
    description: GetComputedStylesTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetComputedStylesTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetComputedStylesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_computed_styles", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get computed styles: ${error.message}`, false, error);
    }
  }
};
var checkVisibility = {
  schema: {
    name: CheckVisibilityTool.shape.name.value,
    description: CheckVisibilityTool.shape.description.value,
    inputSchema: zodToJsonSchema3(CheckVisibilityTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CheckVisibilityTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_check_visibility", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to check visibility: ${error.message}`, false, error);
    }
  }
};
var getAttributes = {
  schema: {
    name: GetAttributesTool.shape.name.value,
    description: GetAttributesTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetAttributesTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetAttributesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_attributes", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get attributes: ${error.message}`, false, error);
    }
  }
};
var countElements = {
  schema: {
    name: CountElementsTool.shape.name.value,
    description: CountElementsTool.shape.description.value,
    inputSchema: zodToJsonSchema3(CountElementsTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CountElementsTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_count_elements", validatedParams);
      return textResponse(`Found ${result} elements matching selector "${validatedParams.selector}"`);
    } catch (error) {
      return errorResponse(`Failed to count elements: ${error.message}`, false, error);
    }
  }
};
var getPageMetadata = {
  schema: {
    name: GetPageMetadataTool.shape.name.value,
    description: GetPageMetadataTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetPageMetadataTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      GetPageMetadataTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_page_metadata", {});
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get page metadata: ${error.message}`, false, error);
    }
  }
};
var getFilteredAriaTree = {
  schema: {
    name: GetFilteredAriaTreeTool.shape.name.value,
    description: GetFilteredAriaTreeTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetFilteredAriaTreeTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetFilteredAriaTreeTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_filtered_aria_tree", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get filtered ARIA tree: ${error.message}`, false, error);
    }
  }
};
var findByText = {
  schema: {
    name: FindByTextTool.shape.name.value,
    description: FindByTextTool.shape.description.value,
    inputSchema: zodToJsonSchema3(FindByTextTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = FindByTextTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_find_by_text", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to find by text: ${error.message}`, false, error);
    }
  }
};
var getFormValues = {
  schema: {
    name: GetFormValuesTool.shape.name.value,
    description: GetFormValuesTool.shape.description.value,
    inputSchema: zodToJsonSchema3(GetFormValuesTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetFormValuesTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_get_form_values", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get form values: ${error.message}`, false, error);
    }
  }
};
var checkElementState = {
  schema: {
    name: CheckElementStateTool.shape.name.value,
    description: CheckElementStateTool.shape.description.value,
    inputSchema: zodToJsonSchema3(CheckElementStateTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CheckElementStateTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage("browser_check_element_state", validatedParams);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to check element state: ${error.message}`, false, error);
    }
  }
};

// src/tools/forms.ts
import zodToJsonSchema4 from "zod-to-json-schema";
var fillForm = {
  schema: {
    name: FillFormTool.shape.name.value,
    description: FillFormTool.shape.description.value,
    inputSchema: zodToJsonSchema4(FillFormTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = FillFormTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_fill_form", validatedParams);
      return textResponse(`Filled ${validatedParams.fields.length} form fields`);
    } catch (error) {
      return errorResponse(`Failed to fill form: ${error.message}`, false, error);
    }
  }
};
var submitForm = {
  schema: {
    name: SubmitFormTool.shape.name.value,
    description: SubmitFormTool.shape.description.value,
    inputSchema: zodToJsonSchema4(SubmitFormTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SubmitFormTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_submit_form", validatedParams);
      return textResponse(`Submitted form "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to submit form: ${error.message}`, false, error);
    }
  }
};

// src/tools/interactions.ts
import { zodToJsonSchema as zodToJsonSchema5 } from "zod-to-json-schema";
var getInteractions = {
  schema: {
    name: GetInteractionsTool.shape.name.value,
    description: GetInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(GetInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = GetInteractionsTool.shape.arguments.parse(params);
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
      return textResponse(summary);
    } catch (error) {
      return errorResponse(`Failed to get interactions: ${error.message}`, false, error);
    }
  }
};
var pruneInteractions = {
  schema: {
    name: PruneInteractionsTool.shape.name.value,
    description: PruneInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(PruneInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = PruneInteractionsTool.shape.arguments.parse(params);
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
      return textResponse(summary);
    } catch (error) {
      return errorResponse(`Failed to prune interactions: ${error.message}`, false, error);
    }
  }
};
var searchInteractions = {
  schema: {
    name: SearchInteractionsTool.shape.name.value,
    description: SearchInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema5(SearchInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SearchInteractionsTool.shape.arguments.parse(params);
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
      return textResponse(summary);
    } catch (error) {
      return errorResponse(`Failed to search interactions: ${error.message}`, false, error);
    }
  }
};

// src/tools/recording.ts
import { zodToJsonSchema as zodToJsonSchema6 } from "zod-to-json-schema";
var requestDemonstration = (snapshot2) => ({
  schema: {
    name: RequestDemonstrationTool.shape.name.value,
    description: RequestDemonstrationTool.shape.description.value,
    inputSchema: zodToJsonSchema6(RequestDemonstrationTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const { request, timeout } = RequestDemonstrationTool.shape.arguments.parse(params);
      const wsTimeoutMs = timeout ? timeout * 1e3 : void 0;
      const result = await context.sendSocketMessage(
        "browser_request_demonstration",
        { request },
        { timeoutMs: wsTimeoutMs }
      );
      const actions = result.actions || [];
      const network = result.network || [];
      let summary = `# Demonstration Recording

`;
      summary += `**Request**: ${request}
`;
      summary += `**Duration**: ${(result.duration / 1e3).toFixed(1)}s
`;
      summary += `**Start URL**: ${result.startUrl}
`;
      summary += `**End URL**: ${result.endUrl}

`;
      summary += `## Actions Recorded (${actions.length})

`;
      for (const action of actions) {
        summary += `${action.step}. **${action.type}** (${action.timestamp}ms)
`;
        if (action.element) {
          summary += `   - Element: ${action.element.tagName}`;
          if (action.element.text) summary += ` "${action.element.text}"`;
          summary += `
   - Selector: \`${action.element.selector}\`
`;
        }
        if (action.value) {
          summary += `   - Value: "${action.value}"
`;
        }
        if (action.url) {
          summary += `   - URL: ${action.url}
`;
        }
        summary += `
`;
      }
      if (network.length > 0) {
        summary += `
## Network Activity (${network.length} requests)

`;
        for (const req of network.slice(0, 10)) {
          summary += `- **${req.method}** ${req.url}
`;
          if (req.response) {
            summary += `  Status: ${req.response.status}
`;
          }
        }
        if (network.length > 10) {
          summary += `
... and ${network.length - 10} more requests
`;
        }
      }
      return textResponse(summary);
    } catch (error) {
      return errorResponse(`Failed to request demonstration: ${error.message}`, false, error);
    }
  }
});

// src/tools/snapshot.ts
import zodToJsonSchema7 from "zod-to-json-schema";
var snapshot = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema7(SnapshotTool.shape.arguments)
  },
  handle: async (context) => {
    try {
      await context.ensureAttached();
      return await captureAriaSnapshot(context);
    } catch (error) {
      return errorResponse(`Failed to capture snapshot: ${error.message}`, false, error);
    }
  }
};
var click = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema7(ClickTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = ClickTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_click", validatedParams);
      return textResponse(`Clicked "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to click element: ${error.message}`, false, error);
    }
  }
};
var drag = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema7(DragTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = DragTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_drag", validatedParams);
      return textResponse(`Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`);
    } catch (error) {
      return errorResponse(`Failed to drag element: ${error.message}`, false, error);
    }
  }
};
var hover = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema7(HoverTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = HoverTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_hover", validatedParams);
      return textResponse(`Hovered over "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to hover over element: ${error.message}`, false, error);
    }
  }
};
var type = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema7(TypeTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = TypeTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_type", validatedParams);
      return textResponse(`Typed "${validatedParams.text}" into "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to type into element: ${error.message}`, false, error);
    }
  }
};
var selectOption = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema7(SelectOptionTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SelectOptionTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_select_option", validatedParams);
      return textResponse(`Selected option in "${validatedParams.element}"`);
    } catch (error) {
      return errorResponse(`Failed to select option: ${error.message}`, false, error);
    }
  }
};

// src/tools/tabs.ts
import zodToJsonSchema8 from "zod-to-json-schema";
var listTabs = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema8(ListTabsTool.shape.arguments)
  },
  handle: async (context) => {
    try {
      await context.ensureAttached();
      const tabs = await context.sendSocketMessage("browser_list_tabs", {});
      return textResponse(`Open tabs:
${JSON.stringify(tabs, null, 2)}`);
    } catch (error) {
      return errorResponse(`Failed to list tabs: ${error.message}`, false, error);
    }
  }
};
var switchTab = {
  schema: {
    name: SwitchTabTool.shape.name.value,
    description: SwitchTabTool.shape.description.value,
    inputSchema: zodToJsonSchema8(SwitchTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = SwitchTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_switch_tab", validatedParams);
      return textResponse(`Switched to tab ${validatedParams.tabId}`);
    } catch (error) {
      return errorResponse(`Failed to switch tab: ${error.message}`, false, error);
    }
  }
};
var createTab = {
  schema: {
    name: CreateTabTool.shape.name.value,
    description: CreateTabTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CreateTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CreateTabTool.shape.arguments.parse(params);
      const result = await context.sendSocketMessage(
        "browser_create_tab",
        validatedParams
      );
      return textResponse(`Created new tab ${result.tabId}${validatedParams.url ? ` at ${validatedParams.url}` : ""}`);
    } catch (error) {
      return errorResponse(`Failed to create tab: ${error.message}`, false, error);
    }
  }
};
var closeTab = {
  schema: {
    name: CloseTabTool.shape.name.value,
    description: CloseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema8(CloseTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const validatedParams = CloseTabTool.shape.arguments.parse(params);
      await context.sendSocketMessage("browser_close_tab", validatedParams);
      return textResponse(`Closed tab ${validatedParams.tabId}`);
    } catch (error) {
      return errorResponse(`Failed to close tab: ${error.message}`, false, error);
    }
  }
};

// src/tools/user-action.ts
import { zodToJsonSchema as zodToJsonSchema9 } from "zod-to-json-schema";
var requestUserAction = (snapshot2) => ({
  schema: {
    name: RequestUserActionTool.shape.name.value,
    description: RequestUserActionTool.shape.description.value,
    inputSchema: zodToJsonSchema9(RequestUserActionTool.shape.arguments)
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const { request, timeout } = RequestUserActionTool.shape.arguments.parse(params);
      const wsTimeoutMs = timeout ? timeout * 1e3 : 3e5;
      const result = await context.sendSocketMessage(
        "browser_request_user_action",
        { request },
        { timeoutMs: wsTimeoutMs }
      );
      const interactions = result.interactions || [];
      const status = result.status;
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
      if (status === "rejected") {
        summary += `The user rejected this request.
`;
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
      return textResponse(summary);
    } catch (error) {
      return errorResponse(`Failed to request user action: ${error.message}`, false, error);
    }
  }
});

// package.json
var package_default = {
  name: "@browsermcp/mcp",
  version: "0.1.3",
  description: "MCP server for browser automation using Browser MCP",
  author: "Browser MCP",
  homepage: "https://browsermcp.io",
  bugs: "https://github.com/browsermcp/mcp/issues",
  type: "module",
  bin: {
    "mcp-server-browsermcp": "dist/http-server.js"
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
    inspector: "CLIENT_PORT=9001 SERVER_PORT=9002 pnpx @modelcontextprotocol/inspector node dist/stdio-server.js"
  },
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.20.0",
    commander: "^13.1.0",
    express: "^5.1.0",
    nodemon: "^3.1.10",
    ws: "^8.18.1",
    zod: "^3.24.2",
    "zod-to-json-schema": "^3.24.3"
  },
  devDependencies: {
    "@types/express": "^5.0.3",
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
  navigate,
  goBack,
  goForward,
  wait,
  pressKey,
  scroll,
  scrollToElement,
  getConsoleLogs,
  screenshot,
  evaluate,
  getNetworkLogs,
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
  getInteractions,
  pruneInteractions,
  searchInteractions,
  requestDemonstration,
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  listTabs,
  switchTab,
  createTab,
  closeTab,
  requestUserAction,
  package_default
};
