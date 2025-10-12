import { z } from "zod";

const ElementSchema = z.object({
  element: z
    .string()
    .describe(
      "Human-readable element description used to obtain permission to interact with the element"
    ),
  ref: z
    .string()
    .describe("Exact target element reference from the page snapshot"),
});

export const NavigateTool = z.object({
  name: z.literal("browser_navigate"),
  description: z.literal("Navigate to a URL"),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to"),
  }),
});

export const GoBackTool = z.object({
  name: z.literal("browser_go_back"),
  description: z.literal("Go back to the previous page"),
  arguments: z.object({}),
});

export const GoForwardTool = z.object({
  name: z.literal("browser_go_forward"),
  description: z.literal("Go forward to the next page"),
  arguments: z.object({}),
});

export const WaitTool = z.object({
  name: z.literal("browser_wait"),
  description: z.literal("Wait for a specified time in seconds"),
  arguments: z.object({
    time: z.number().describe("The time to wait in seconds"),
  }),
});

export const PressKeyTool = z.object({
  name: z.literal("browser_press_key"),
  description: z.literal("Press a key on the keyboard"),
  arguments: z.object({
    key: z
      .string()
      .describe(
        "Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"
      ),
  }),
});

export const ScrollTool = z.object({
  name: z.literal("browser_scroll"),
  description: z.literal("Scroll the page by a specific amount in pixels"),
  arguments: z.object({
    x: z.number().optional().describe("Horizontal scroll amount in pixels (positive = right, negative = left). Default: 0"),
    y: z.number().describe("Vertical scroll amount in pixels (positive = down, negative = up)"),
  }),
});

export const ScrollToElementTool = z.object({
  name: z.literal("browser_scroll_to_element"),
  description: z.literal("Scroll to make a specific element visible in the viewport"),
  arguments: ElementSchema,
});

export const ListTabsTool = z.object({
  name: z.literal("browser_list_tabs"),
  description: z.literal("List all open browser tabs"),
  arguments: z.object({}),
});

export const SwitchTabTool = z.object({
  name: z.literal("browser_switch_tab"),
  description: z.literal("Switch to a specific browser tab"),
  arguments: z.object({
    tabId: z.number().describe("The ID of the tab to switch to"),
  }),
});

export const CreateTabTool = z.object({
  name: z.literal("browser_create_tab"),
  description: z.literal("Create a new browser tab"),
  arguments: z.object({
    url: z.string().optional().describe("URL to open in the new tab (default: about:blank)"),
  }),
});

export const CloseTabTool = z.object({
  name: z.literal("browser_close_tab"),
  description: z.literal("Close a specific browser tab"),
  arguments: z.object({
    tabId: z.number().describe("The ID of the tab to close"),
  }),
});

export const FillFormTool = z.object({
  name: z.literal("browser_fill_form"),
  description: z.literal("Fill multiple form fields at once"),
  arguments: z.object({
    fields: z.array(
      z.object({
        element: z
          .string()
          .describe("Human-readable field description"),
        ref: z
          .string()
          .describe("Exact field reference from the page snapshot"),
        value: z
          .string()
          .describe("Value to fill in the field"),
      })
    ).describe("Array of fields to fill"),
  }),
});

export const SubmitFormTool = z.object({
  name: z.literal("browser_submit_form"),
  description: z.literal("Submit a form"),
  arguments: ElementSchema,
});

export const GetNetworkLogsTool = z.object({
  name: z.literal("browser_get_network_logs"),
  description: z.literal("Get network requests and responses captured since page load"),
  arguments: z.object({
    filter: z.string().optional().describe("Optional filter to match URLs (e.g., 'api', '.json')"),
  }),
});

export const SnapshotTool = z.object({
  name: z.literal("browser_snapshot"),
  description: z.literal(
    "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with."
  ),
  arguments: z.object({}),
});

export const ClickTool = z.object({
  name: z.literal("browser_click"),
  description: z.literal("Perform click on a web page"),
  arguments: ElementSchema,
});

export const DragTool = z.object({
  name: z.literal("browser_drag"),
  description: z.literal("Perform drag and drop between two elements"),
  arguments: z.object({
    startElement: z
      .string()
      .describe(
        "Human-readable source element description used to obtain the permission to interact with the element"
      ),
    startRef: z
      .string()
      .describe("Exact source element reference from the page snapshot"),
    endElement: z
      .string()
      .describe(
        "Human-readable target element description used to obtain the permission to interact with the element"
      ),
    endRef: z
      .string()
      .describe("Exact target element reference from the page snapshot"),
  }),
});

export const HoverTool = z.object({
  name: z.literal("browser_hover"),
  description: z.literal("Hover over element on page"),
  arguments: ElementSchema,
});

export const TypeTool = z.object({
  name: z.literal("browser_type"),
  description: z.literal("Type text into editable element"),
  arguments: ElementSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z
      .boolean()
      .describe("Whether to submit entered text (press Enter after)"),
  }),
});

export const SelectOptionTool = z.object({
  name: z.literal("browser_select_option"),
  description: z.literal("Select an option in a dropdown"),
  arguments: ElementSchema.extend({
    values: z
      .array(z.string())
      .describe(
        "Array of values to select in the dropdown. This can be a single value or multiple values."
      ),
  }),
});

export const ScreenshotTool = z.object({
  name: z.literal("browser_screenshot"),
  description: z.literal("Take a screenshot of the current page"),
  arguments: z.object({}),
});

export const GetConsoleLogsTool = z.object({
  name: z.literal("browser_get_console_logs"),
  description: z.literal("Get the console logs from the browser"),
  arguments: z.object({}),
});

export const EvaluateTool = z.object({
  name: z.literal("browser_evaluate"),
  description: z.literal("Evaluate JavaScript expression on page or element"),
  arguments: z.object({
    expression: z
      .string()
      .describe("JavaScript expression to evaluate in page context"),
  }),
});

// DOM Exploration Tools

export const QueryDOMTool = z.object({
  name: z.literal("browser_query_dom"),
  description: z.literal(
    "Query DOM elements by CSS selector and return basic info without full ARIA tree"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector to query elements"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of elements to return (default: 10)"),
  }),
});

export const GetVisibleTextTool = z.object({
  name: z.literal("browser_get_visible_text"),
  description: z.literal(
    "Get visible text content from the page or a specific element"
  ),
  arguments: z.object({
    selector: z
      .string()
      .optional()
      .describe("Optional CSS selector to get text from specific element"),
    maxLength: z
      .number()
      .optional()
      .describe("Maximum text length to return (default: 5000)"),
  }),
});

export const GetComputedStylesTool = z.object({
  name: z.literal("browser_get_computed_styles"),
  description: z.literal("Get computed CSS styles for an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    properties: z
      .array(z.string())
      .optional()
      .describe(
        "Specific CSS properties to retrieve (e.g. ['display', 'color']). If not specified, returns common layout properties."
      ),
  }),
});

export const CheckVisibilityTool = z.object({
  name: z.literal("browser_check_visibility"),
  description: z.literal(
    "Check if element is visible, hidden, in viewport, or has specific display state"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
  }),
});

export const GetAttributesTool = z.object({
  name: z.literal("browser_get_attributes"),
  description: z.literal("Get all attributes or specific attributes of an element"),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
    attributes: z
      .array(z.string())
      .optional()
      .describe(
        "Specific attributes to retrieve (e.g. ['href', 'class']). If not specified, returns all attributes."
      ),
  }),
});

export const CountElementsTool = z.object({
  name: z.literal("browser_count_elements"),
  description: z.literal("Count number of elements matching a CSS selector"),
  arguments: z.object({
    selector: z.string().describe("CSS selector to count matching elements"),
  }),
});

export const GetPageMetadataTool = z.object({
  name: z.literal("browser_get_page_metadata"),
  description: z.literal(
    "Get page metadata including title, description, Open Graph tags, schema.org data, etc."
  ),
  arguments: z.object({}),
});

export const GetFilteredAriaTreeTool = z.object({
  name: z.literal("browser_get_filtered_aria_tree"),
  description: z.literal(
    "Get ARIA tree with filters to reduce token usage (e.g. only interactive elements, specific roles, max depth)"
  ),
  arguments: z.object({
    roles: z
      .array(z.string())
      .optional()
      .describe(
        "Filter to only include elements with these ARIA roles (e.g. ['button', 'link', 'textbox'])"
      ),
    maxDepth: z
      .number()
      .optional()
      .describe("Maximum depth to traverse in the tree (default: 5)"),
    interactiveOnly: z
      .boolean()
      .optional()
      .describe("Only include interactive elements (buttons, links, inputs, etc.)"),
  }),
});

export const FindByTextTool = z.object({
  name: z.literal("browser_find_by_text"),
  description: z.literal(
    "Find elements containing specific text (case-insensitive, partial match)"
  ),
  arguments: z.object({
    text: z.string().describe("Text to search for in elements"),
    selector: z
      .string()
      .optional()
      .describe("Optional CSS selector to narrow search scope"),
    exact: z
      .boolean()
      .optional()
      .describe("Whether to match exact text (default: false for partial match)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 10)"),
  }),
});

export const GetFormValuesTool = z.object({
  name: z.literal("browser_get_form_values"),
  description: z.literal(
    "Get current values of all form fields in a form or the entire page"
  ),
  arguments: z.object({
    formSelector: z
      .string()
      .optional()
      .describe("Optional CSS selector for a specific form. If not specified, gets all form fields on the page."),
  }),
});

export const CheckElementStateTool = z.object({
  name: z.literal("browser_check_element_state"),
  description: z.literal(
    "Check element state: enabled/disabled, checked/unchecked, selected, readonly, required, etc."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
  }),
});

export const RequestUserActionTool = z.object({
  name: z.literal("browser_request_user_action"),
  description: z.literal(
    "Request the user to perform an action in the browser. Shows a notification and overlay with instructions. User can complete or reject the request. Captures all interactions from request to completion via the background log. More flexible than request_demonstration - use this for both learning workflows AND getting user assistance."
  ),
  arguments: z.object({
    request: z.string().describe("Clear instructions for what you want the user to do (e.g., 'Please navigate to your shopping cart and add an item')"),
    timeout: z.number().optional().describe("Maximum time to wait for user response in seconds (default: 300s = 5 minutes). After timeout, request is automatically cancelled."),
  }),
});

// Background Interaction Log Tools

export const GetInteractionsTool = z.object({
  name: z.literal("browser_get_interactions"),
  description: z.literal(
    "Retrieve user interactions from the background audit log. Interactions are continuously recorded in the background while connected to a tab. Query any time segment with flexible filtering."
  ),
  arguments: z.object({
    startTime: z
      .number()
      .optional()
      .describe("Start time as Unix timestamp in ms, or negative offset from now (e.g., -60000 = last minute)"),
    endTime: z
      .number()
      .optional()
      .describe("End time as Unix timestamp in ms, or negative offset from now"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of interactions to return (default: 50)"),
    offset: z
      .number()
      .optional()
      .describe("Skip first N interactions for pagination (default: 0)"),
    types: z
      .array(z.string())
      .optional()
      .describe("Filter by interaction types (e.g., ['click', 'keyboard', 'scroll', 'navigation'])"),
    urlPattern: z
      .string()
      .optional()
      .describe("Filter by URL regex pattern"),
    selectorPattern: z
      .string()
      .optional()
      .describe("Filter by CSS selector regex pattern"),
    sortOrder: z
      .enum(["asc", "desc"])
      .optional()
      .describe("Sort order by timestamp (default: desc - newest first)"),
  }),
});

export const PruneInteractionsTool = z.object({
  name: z.literal("browser_prune_interactions"),
  description: z.literal(
    "Remove interactions from the background audit log based on various criteria. Allows selective pruning by time, count, type, or pattern."
  ),
  arguments: z.object({
    before: z
      .number()
      .optional()
      .describe("Remove all interactions before this Unix timestamp in ms"),
    after: z
      .number()
      .optional()
      .describe("Remove all interactions after this Unix timestamp in ms"),
    between: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("Remove interactions within time range [startTime, endTime] in ms"),
    keepLast: z
      .number()
      .optional()
      .describe("Keep only the last N interactions, remove all older ones"),
    keepFirst: z
      .number()
      .optional()
      .describe("Keep only the first N interactions, remove all newer ones"),
    removeOldest: z
      .number()
      .optional()
      .describe("Remove the oldest N interactions"),
    types: z
      .array(z.string())
      .optional()
      .describe("Remove only these interaction types"),
    excludeTypes: z
      .array(z.string())
      .optional()
      .describe("Remove all interactions except these types"),
    urlPattern: z
      .string()
      .optional()
      .describe("Remove interactions matching this URL regex"),
    selectorPattern: z
      .string()
      .optional()
      .describe("Remove interactions matching this selector regex"),
  }),
});

export const SearchInteractionsTool = z.object({
  name: z.literal("browser_search_interactions"),
  description: z.literal(
    "Search the background interaction log using text queries. Searches across selectors, values, URLs, and element text content."
  ),
  arguments: z.object({
    query: z
      .string()
      .describe("Text to search for in interactions (searches selectors, values, URLs, element text)"),
    types: z
      .array(z.string())
      .optional()
      .describe("Filter by interaction types"),
    startTime: z
      .number()
      .optional()
      .describe("Start time filter (Unix timestamp in ms or negative offset)"),
    endTime: z
      .number()
      .optional()
      .describe("End time filter (Unix timestamp in ms or negative offset)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of results (default: 50)"),
  }),
});

// Cookie Management Tools
export const GetCookiesTool = z.object({
  name: z.literal("browser_get_cookies"),
  description: z.literal("Get cookies for a specific URL or all cookies"),
  arguments: z.object({
    url: z
      .string()
      .optional()
      .describe("URL to get cookies for (if not provided, gets all cookies)"),
    name: z
      .string()
      .optional()
      .describe("Filter by cookie name"),
    domain: z
      .string()
      .optional()
      .describe("Filter by cookie domain"),
  }),
});

export const SetCookieTool = z.object({
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
    sameSite: z
      .enum(["no_restriction", "lax", "strict"])
      .optional()
      .describe("SameSite attribute"),
    expirationDate: z
      .number()
      .optional()
      .describe("Expiration date in Unix timestamp (seconds since epoch)"),
  }),
});

export const DeleteCookieTool = z.object({
  name: z.literal("browser_delete_cookie"),
  description: z.literal("Delete a specific cookie"),
  arguments: z.object({
    url: z.string().describe("URL of the cookie to delete"),
    name: z.string().describe("Name of the cookie to delete"),
  }),
});

export const ClearCookiesTool = z.object({
  name: z.literal("browser_clear_cookies"),
  description: z.literal("Clear all cookies, optionally filtered by URL or domain"),
  arguments: z.object({
    url: z
      .string()
      .optional()
      .describe("Only clear cookies for this URL"),
    domain: z
      .string()
      .optional()
      .describe("Only clear cookies for this domain"),
  }),
});

// Download Management Tools
export const DownloadFileTool = z.object({
  name: z.literal("browser_download_file"),
  description: z.literal("Download a file from a URL"),
  arguments: z.object({
    url: z.string().describe("URL of the file to download"),
    filename: z
      .string()
      .optional()
      .describe("Suggested filename for the download"),
    saveAs: z
      .boolean()
      .optional()
      .describe("Whether to prompt user for save location (default: false)"),
  }),
});

export const GetDownloadsTool = z.object({
  name: z.literal("browser_get_downloads"),
  description: z.literal("Get list of downloads with optional filtering"),
  arguments: z.object({
    query: z
      .array(z.string())
      .optional()
      .describe("Search query terms to filter downloads"),
    orderBy: z
      .array(z.enum(["startTime", "endTime", "url", "filename", "bytesReceived"]))
      .optional()
      .describe("Fields to order results by"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of downloads to return"),
  }),
});

export const CancelDownloadTool = z.object({
  name: z.literal("browser_cancel_download"),
  description: z.literal("Cancel a download in progress"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to cancel"),
  }),
});

export const OpenDownloadTool = z.object({
  name: z.literal("browser_open_download"),
  description: z.literal("Open a downloaded file"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to open"),
  }),
});

// Clipboard Tools
export const GetClipboardTool = z.object({
  name: z.literal("browser_get_clipboard"),
  description: z.literal("Read text from the clipboard"),
  arguments: z.object({}),
});

export const SetClipboardTool = z.object({
  name: z.literal("browser_set_clipboard"),
  description: z.literal("Write text to the clipboard"),
  arguments: z.object({
    text: z.string().describe("Text to write to the clipboard"),
  }),
});

// History Tools
export const SearchHistoryTool = z.object({
  name: z.literal("browser_search_history"),
  description: z.literal("Search browsing history"),
  arguments: z.object({
    text: z.string().describe("Text to search for in history"),
    startTime: z
      .number()
      .optional()
      .describe("Start time in milliseconds since epoch"),
    endTime: z
      .number()
      .optional()
      .describe("End time in milliseconds since epoch"),
    maxResults: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 100)"),
  }),
});

export const GetHistoryVisitsTool = z.object({
  name: z.literal("browser_get_history_visits"),
  description: z.literal("Get visit details for a URL"),
  arguments: z.object({
    url: z.string().describe("URL to get visit history for"),
  }),
});

export const DeleteHistoryTool = z.object({
  name: z.literal("browser_delete_history"),
  description: z.literal("Delete specific URLs from history"),
  arguments: z.object({
    urls: z.array(z.string()).describe("URLs to delete from history"),
  }),
});

export const ClearHistoryTool = z.object({
  name: z.literal("browser_clear_history"),
  description: z.literal("Clear browsing history for a time range"),
  arguments: z.object({
    startTime: z
      .number()
      .describe("Start time in milliseconds since epoch"),
    endTime: z
      .number()
      .describe("End time in milliseconds since epoch"),
  }),
});

// System Information Tools
export const GetVersionTool = z.object({
  name: z.literal("browser_get_version"),
  description: z.literal("Get browser version information"),
  arguments: z.object({}),
});

export const GetSystemInfoTool = z.object({
  name: z.literal("browser_get_system_info"),
  description: z.literal("Get system information including OS, platform, and architecture"),
  arguments: z.object({}),
});

export const GetBrowserInfoTool = z.object({
  name: z.literal("browser_get_browser_info"),
  description: z.literal("Get browser capabilities and information"),
  arguments: z.object({}),
});

// Network Tools
export const GetNetworkStateTool = z.object({
  name: z.literal("browser_get_network_state"),
  description: z.literal("Get current network connection state"),
  arguments: z.object({}),
});

export const SetNetworkConditionsTool = z.object({
  name: z.literal("browser_set_network_conditions"),
  description: z.literal("Set network throttling conditions for testing"),
  arguments: z.object({
    offline: z
      .boolean()
      .optional()
      .describe("Simulate offline mode (default: false)"),
    latency: z
      .number()
      .optional()
      .describe("Minimum latency in milliseconds (default: 0)"),
    downloadThroughput: z
      .number()
      .optional()
      .describe("Download throughput in bytes/sec (default: -1 for unlimited)"),
    uploadThroughput: z
      .number()
      .optional()
      .describe("Upload throughput in bytes/sec (default: -1 for unlimited)"),
  }),
});

export const ClearCacheTool = z.object({
  name: z.literal("browser_clear_cache"),
  description: z.literal("Clear browser cache"),
  arguments: z.object({
    cacheStorage: z
      .boolean()
      .optional()
      .describe("Clear cache storage (default: true)"),
  }),
});

// Bookmark Tools
export const GetBookmarksTool = z.object({
  name: z.literal("browser_get_bookmarks"),
  description: z.literal("Get bookmarks from the browser"),
  arguments: z.object({
    parentId: z
      .string()
      .optional()
      .describe("Parent folder ID to get bookmarks from (default: root)"),
  }),
});

export const CreateBookmarkTool = z.object({
  name: z.literal("browser_create_bookmark"),
  description: z.literal("Create a new bookmark"),
  arguments: z.object({
    title: z.string().describe("Bookmark title"),
    url: z.string().describe("Bookmark URL"),
    parentId: z
      .string()
      .optional()
      .describe("Parent folder ID (default: root)"),
  }),
});

export const DeleteBookmarkTool = z.object({
  name: z.literal("browser_delete_bookmark"),
  description: z.literal("Delete a bookmark by ID"),
  arguments: z.object({
    id: z.string().describe("Bookmark ID to delete"),
  }),
});

export const SearchBookmarksTool = z.object({
  name: z.literal("browser_search_bookmarks"),
  description: z.literal("Search bookmarks by query"),
  arguments: z.object({
    query: z.string().describe("Search query"),
    maxResults: z
      .number()
      .optional()
      .describe("Maximum number of results (default: 100)"),
  }),
});

// Extension Management Tools
export const ListExtensionsTool = z.object({
  name: z.literal("browser_list_extensions"),
  description: z.literal("List all installed browser extensions"),
  arguments: z.object({}),
});

export const GetExtensionInfoTool = z.object({
  name: z.literal("browser_get_extension_info"),
  description: z.literal("Get detailed information about a specific extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID"),
  }),
});

export const EnableExtensionTool = z.object({
  name: z.literal("browser_enable_extension"),
  description: z.literal("Enable a disabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to enable"),
  }),
});

export const DisableExtensionTool = z.object({
  name: z.literal("browser_disable_extension"),
  description: z.literal("Disable an enabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to disable"),
  }),
});

// Macro Management Tools
export const StoreMacroTool = z.object({
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
      default: z.any().optional().describe("Default value if not provided"),
    })).describe("Macro parameters schema"),
    code: z.string().describe("JavaScript function code: (params) => { /* your code */ return result; }"),
    returnType: z.string().describe("Description of what the macro returns"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Reliability rating (default: untested)"),
    tags: z.array(z.string()).optional().describe("Tags for filtering and search"),
  }),
});

export const ListMacrosTool = z.object({
  name: z.literal("browser_list_macros"),
  description: z.literal("List available macros with optional filtering by site, category, or tags. Returns macro metadata without the code."),
  arguments: z.object({
    site: z.string().optional().describe("Filter by site domain or '*' for universal"),
    category: z.string().optional().describe("Filter by category: search, extraction, navigation, interaction, form, util"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns macros matching ANY tag)"),
    search: z.string().optional().describe("Search in name and description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Filter by reliability rating"),
    limit: z.number().optional().describe("Maximum number of results (default: 50)"),
  }),
});

export const ExecuteMacroTool = z.object({
  name: z.literal("browser_execute_macro"),
  description: z.literal("Execute a stored macro by ID with provided parameters. The macro runs in the page context and returns the result."),
  arguments: z.object({
    id: z.string().describe("Macro ID to execute"),
    params: z.record(z.any()).optional().describe("Parameters to pass to the macro function"),
  }),
});

export const UpdateMacroTool = z.object({
  name: z.literal("browser_update_macro"),
  description: z.literal("Update an existing macro. Creates a new version while preserving the old one. Only the owner can update macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to update"),
    description: z.string().optional().describe("Updated description"),
    parameters: z.record(z.object({
      type: z.enum(["string", "number", "boolean", "object", "array"]),
      description: z.string(),
      required: z.boolean(),
      default: z.any().optional(),
    })).optional().describe("Updated parameters schema"),
    code: z.string().optional().describe("Updated JavaScript code"),
    returnType: z.string().optional().describe("Updated return type description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Updated reliability rating"),
    tags: z.array(z.string()).optional().describe("Updated tags"),
  }),
});

export const DeleteMacroTool = z.object({
  name: z.literal("browser_delete_macro"),
  description: z.literal("Delete a macro by ID. This action cannot be undone. Only the owner can delete macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to delete"),
  }),
});
