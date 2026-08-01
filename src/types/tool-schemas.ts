import { z } from "zod";

/**
 * Multi-tab Tool Schemas - Phase 4 Complete ✅
 *
 * ALL 72 tools now support the tabTarget parameter (except WaitTool and legacy tab management tools).
 *
 * Tools supporting tabTarget (68 tools):
 * - Navigation & Common: Navigate, GoBack, GoForward, PressKey, Scroll, ScrollToElement
 * - Interaction: Click, Drag, Hover, Type, SelectOption, FillForm, SubmitForm
 * - Information: Snapshot, Screenshot, Evaluate, GetConsoleLogs, GetNetworkLogs
 * - DOM Exploration: QueryDOM, GetVisibleText, GetComputedStyles, CheckVisibility,
 *   GetAttributes, CountElements, GetPageMetadata, GetFilteredAriaTree,
 *   FindByText, GetFormValues, CheckElementState
 * - Interaction Log: GetInteractions, PruneInteractions, SearchInteractions
 * - Cookies: GetCookies, SetCookie, DeleteCookie, ClearCookies
 * - Downloads: DownloadFile, GetDownloads, CancelDownload, OpenDownload
 * - Clipboard: GetClipboard, SetClipboard
 * - History: SearchHistory, GetHistoryVisits, DeleteHistory, ClearHistory
 * - System Info: GetVersion, GetSystemInfo, GetBrowserInfo
 * - Network: GetNetworkState, SetNetworkConditions, ClearCache
 * - Bookmarks: GetBookmarks, CreateBookmark, DeleteBookmark, SearchBookmarks
 * - Extensions: ListExtensions, GetExtensionInfo, EnableExtension, DisableExtension
 * - Macros: StoreMacro, ListMacros, ExecuteMacro, UpdateMacro, DeleteMacro
 * - Realistic Input: RealisticMouseMove, RealisticClick, RealisticType
 * - Request User Action: RequestUserAction
 * - Multi-tab Management: ListAttachedTabs, SetTabLabel, DetachTab, GetActiveTab
 *
 * Tools NOT supporting tabTarget (5 tools - global operations):
 * - WaitTool: Timing utility, not tab-specific
 * - ListTabsTool: Lists all browser tabs globally
 * - SwitchTabTool: Switches active Chrome tab
 * - CreateTabTool: Creates new Chrome tab
 * - CloseTabTool: Closes a Chrome tab
 * - CreateWindowTool: Creates new browser window
 */

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

// Schema for optional tab targeting (used across all browser automation tools).
// The `agent` and `takeover` fields here drive the tab-reservation system:
// when an agent passes `agent: "<name>"` on browser_create_tab / browser_attach_tab,
// that tab becomes RESERVED to that agent — other agents calling control tools
// on the same tab while supplying a different `agent` get a `tab-reserved` error
// listing the current owner. They can retry the same call with `takeover: true`
// to forcibly transfer ownership (logged in the tab's history). Callers that do
// NOT supply `agent` get the legacy free-for-all behavior, so existing macros
// and scripts keep working unchanged.
const TabTargetSchema = z.object({
  tabTarget: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      "Optional tab identifier — must be a tab ID or label from browser_list_attached_tabs (NOT a Chrome tab ID from browser_list_tabs). " +
      "If not provided, uses the last-used attached tab. " +
      "Use browser_create_tab or browser_attach_tab to attach a tab before targeting it."
    ),
  agent: z
    .string()
    .optional()
    .describe(
      "Your agent identifier (e.g. your ATC session name: \"shopping\", \"ha\", \"unibrowse\"). " +
      "When supplied on browser_create_tab/browser_attach_tab, reserves the tab to you so other " +
      "agents can't hijack it. When supplied on control tools (navigate/evaluate/click/etc.), the " +
      "server checks ownership and returns a tab-reserved error if a different agent owns the tab. " +
      "Omit for legacy free-for-all behavior (any caller can drive the tab)."
    ),
  takeover: z
    .boolean()
    .optional()
    .describe(
      "Set true to forcibly take over a tab currently reserved by a different agent. The takeover " +
      "is recorded in the tab's reservation history. Requires `agent` to be set. Use sparingly — " +
      "intended for cleanup when the prior owner has died or you genuinely need the tab back."
    ),
  extensionId: z
    .string()
    .optional()
    .describe(
      "Pin this call to a specific extension (host Chrome vs container chromium). Get the id from " +
      "browser_launch_isolated_chrome's response or browser_list_attached_tabs's `extensions` array. " +
      "Omit when only one extension is connected, or when tabTarget refers to a tab the server has " +
      "already routed via TAB_ATTACHED."
    ),
});

// Standalone extensionId field for tools that don't take TabTarget but still
// need to be routed when multiple extensions are connected (browser_list_tabs,
// browser_switch_tab, browser_create_tab, browser_close_tab — all operate on
// a specific Chrome instance's tab registry).
const ExtensionIdSchema = z.object({
  extensionId: z
    .string()
    .optional()
    .describe(
      "Pin this call to a specific extension. Required when multiple extensions are connected; " +
      "if omitted in single-extension mode the only registered extension is used. Get the id from " +
      "browser_launch_isolated_chrome's response or browser_list_attached_tabs's `extensions` array."
    ),
});

// Schema for optional frame targeting (iframes within a page)
const FrameTargetSchema = z.object({
  frameTarget: z
    .string()
    .optional()
    .describe(
      "Optional frame identifier to operate inside an iframe. " +
      "Accepts a CDP frameId string from browser_list_frames, or a CSS selector of an " +
      "<iframe> element (e.g. '#checkout-frame', 'iframe[name=\"payment\"]'). " +
      "Nameless iframes without a stable selector must use frameId from browser_list_frames. " +
      "CDP bypasses same-origin policy — cross-origin iframes are accessible. " +
      "If omitted, operates on the main frame."
    ),
});

// Schema for optional token limiting (used across all tools to control response size)
const MaxTokensSchema = z.object({
  max_tokens: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional maximum tokens for response output (default: 25000). " +
      "Claude Code's default MCP tool response limit is 25,000 tokens. " +
      "Use this to control response size for large outputs (snapshots, screenshots, logs, etc.). " +
      "Set to a lower value to reduce response size or higher value if MAX_MCP_OUTPUT_TOKENS env var is increased."
    ),
});

export const NavigateTool = z.object({
  name: z.literal("browser_navigate"),
  description: z.literal("Navigate to a URL. WHEN tabTarget IS OMITTED, A NEW TAB IS CREATED at the URL (in the background) instead of reusing whichever tab was most recently used — this prevents cross-agent collisions on a shared unibrowse server. The new tab is auto-attached and becomes this caller's last-used tab so a subsequent browser_evaluate / browser_click / etc. without tabTarget hits it. Pass an explicit tabTarget to navigate an existing attached tab. Pass focus=true to bring the auto-created tab to front (default background)."),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to"),
    focus: z.boolean().optional().describe("Only used when tabTarget is omitted (auto-create path). Bring the new tab to front (default: false — opens in background)."),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GoBackTool = z.object({
  name: z.literal("browser_go_back"),
  description: z.literal("Go back to the previous page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const GoForwardTool = z.object({
  name: z.literal("browser_go_forward"),
  description: z.literal("Go forward to the next page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const WaitTool = z.object({
  name: z.literal("browser_wait"),
  description: z.literal("Wait for a specified time in seconds"),
  arguments: z.object({
    time: z.number().default(1).describe("The time to wait in seconds (default: 1)"),
  }).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const ScrollTool = z.object({
  name: z.literal("browser_scroll"),
  description: z.literal("Scroll the page by a specific amount in pixels"),
  arguments: z.object({
    x: z.number().optional().describe("Horizontal scroll amount in pixels (positive = right, negative = left). Default: 0"),
    y: z.number().describe("Vertical scroll amount in pixels (positive = down, negative = up)"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const ScrollToElementTool = z.object({
  name: z.literal("browser_scroll_to_element"),
  description: z.literal("Scroll to make a specific element visible in the viewport"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const SetDeviceMetricsTool = z.object({
  name: z.literal("browser_set_device_metrics"),
  description: z.literal(
    "Override the attached tab's viewport size and mobile flag via CDP " +
    "(Emulation.setDeviceMetricsOverride). Useful for multi-breakpoint UI " +
    "audits without relaunching chromium — e.g. step through 390x844 / " +
    "768x1024 / 1280x800 in one session. Pass `reset:true` to clear the " +
    "override and restore the renderer's natural size. Width/height/mobile " +
    "are ignored when reset is true."
  ),
  arguments: z.object({
    width: z.number().int().min(1).optional().describe(
      "Viewport width in CSS pixels (1+). Required unless `reset: true`."
    ),
    height: z.number().int().min(1).optional().describe(
      "Viewport height in CSS pixels (1+). Required unless `reset: true`."
    ),
    deviceScaleFactor: z.number().min(0).default(1).describe(
      "Device pixel ratio (0 = use system default). Default: 1."
    ),
    mobile: z.boolean().default(false).describe(
      "Whether to emulate as a mobile device. Affects @media queries, " +
      "touch-event firing, viewport meta-tag handling. Default: false."
    ),
    reset: z.boolean().default(false).describe(
      "Clear any active device-metrics override (Emulation.clearDeviceMetricsOverride). " +
      "When true, width/height/deviceScaleFactor/mobile are ignored."
    ),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const SetFileInputTool = z.object({
  name: z.literal("browser_set_file_input"),
  description: z.literal(
    "Attach local file(s) to an <input type=file> via CDP DOM.setFileInputFiles — " +
    "the ONLY way to programmatically populate a file input (JS cannot set input.files " +
    "for security). Resolves the input by CSS selector, sets its files, and fires " +
    "'input'+'change' so the page/form reacts. CRITICAL: the paths must be ABSOLUTE and " +
    "exist ON THE BROWSER'S HOST filesystem — for isolated chromes that's the chromium-host " +
    "sidecar container, where the bind-mounted profiles dir is visible at " +
    "/app/.chrome-profiles/... (stage files there so the sidecar chrome can read them). " +
    "For a multi-file input pass several paths; for single-file inputs pass one. " +
    "Selector must match exactly one <input type=file>. " +
    "VERIFYING SUCCESS: do NOT rely on input.files afterward — React/controlled forms " +
    "consume the File into state and CLEAR input.files synchronously, so files.length==0 " +
    "is NORMAL and NOT a failure (the tool returns `count`=what was set, plus `landed`+a " +
    "`note` when the input was cleared); confirm via the form's own filename chip/UI. " +
    "SELECTORS on framework forms: the real <input type=file> is often hidden behind a " +
    "styled dropzone/button and keyed by `id` (which may contain dots/brackets) rather than " +
    "`name` — target the underlying input via input[id=\"...\"], not the visible button."
  ),
  arguments: z.object({
    selector: z.string().describe(
      "CSS selector for the target <input type=file> (e.g. 'input[type=file]', " +
      "'#idFront', 'input[name=\"receipt\"]'). Must resolve to exactly one file input."
    ),
    paths: z.array(z.string()).min(1).describe(
      "Absolute file path(s) on the BROWSER HOST (the chromium-host sidecar container for " +
      "isolated chromes), e.g. ['/app/.chrome-profiles/_uploads/foo/id-front.jpg']. Order preserved. " +
      "One path for a normal input; multiple for a `multiple` input."
    ),
  }).merge(TabTargetSchema).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const ListTabsTool = z.object({
  name: z.literal("browser_list_tabs"),
  description: z.literal("List all open Chrome browser tabs. NOTE: The tabIds returned here are Chrome tab IDs, only usable with browser_switch_tab and browser_close_tab. For targeting tabs in operations like browser_navigate/browser_snapshot, use browser_list_attached_tabs instead."),
  arguments: z.object({}).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const SwitchTabTool = z.object({
  name: z.literal("browser_switch_tab"),
  description: z.literal("Switch to a specific browser tab. Accepts either a numeric tabId or a tabTarget label (from browser_list_attached_tabs)."),
  arguments: z.object({
    tabId: z.number().optional().describe("Numeric Chrome tab ID to switch to"),
    tabTarget: z.union([z.string(), z.number()]).optional().describe("Tab label or ID (resolves via attached tab registry)"),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema).refine(d => d.tabId !== undefined || d.tabTarget !== undefined, {
    message: "Provide either tabId (number) or tabTarget (label/id)",
  }),
});

export const CreateTabTool = z.object({
  name: z.literal("browser_create_tab"),
  description: z.literal("Create a new browser tab and automatically attach it for control. Returns tabId and label that can be used as tabTarget in subsequent operations. NEW TABS OPEN IN THE BACKGROUND BY DEFAULT — the user's currently-focused tab stays focused so agent work doesn't disrupt user flow. Pass focus=true to override and bring the new tab to front. Use incognito=true for a fresh anonymous session (no cookies, history, or login state from the main profile). Requires 'Allow in incognito' to be enabled for unibrowse in chrome://extensions. When you pass `agent` the new tab is reserved to you so other agents can't drive it."),
  arguments: z.object({
    url: z.string().optional().describe("URL to open in the new tab (default: about:blank)"),
    incognito: z.boolean().optional().describe("Open tab in an incognito window for a fresh anonymous session. All incognito tabs share one persistent incognito window. Requires extension to be allowed in incognito (chrome://extensions)."),
    focus: z.boolean().optional().describe("Bring the new tab to front and focus it (default: false — opens in background so user flow isn't disrupted)."),
    agent: z.string().optional().describe("Your agent identifier; if supplied, the newly-created tab is reserved to you so other agents can't drive it without passing takeover:true."),
    takeover: z.boolean().optional().describe("Used together with agent: if the new tab's id collides with an existing reservation (rare), set true to forcibly take ownership."),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const CloseTabTool = z.object({
  name: z.literal("browser_close_tab"),
  description: z.literal("Close a specific browser tab. Accepts either a numeric tabId (from browser_list_tabs / browser_create_tab) or a tabTarget label (from browser_list_attached_tabs). Prefer tabTarget when you have a label."),
  arguments: z.object({
    tabId: z.number().optional().describe("Numeric Chrome tab ID to close"),
    tabTarget: z.union([z.string(), z.number()]).optional().describe("Tab label or ID (resolves via attached tab registry)"),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema).refine(d => d.tabId !== undefined || d.tabTarget !== undefined, {
    message: "Provide either tabId (number) or tabTarget (label/id)",
  }),
});

export const CreateWindowTool = z.object({
  name: z.literal("browser_create_window"),
  description: z.literal("Create a new browser window. Opens in the BACKGROUND by default — the user's currently-focused window stays in front so agent work doesn't disrupt user flow. Pass focused=true to bring the new window to front."),
  arguments: z.object({
    url: z.union([z.string(), z.array(z.string())]).optional().describe("URL or array of URLs to open in the new window (default: about:blank)"),
    focused: z.boolean().optional().describe("Whether the new window should be focused / brought to front (default: false — opens in background so user flow isn't disrupted)."),
    incognito: z.boolean().optional().describe("Whether to open in incognito/private mode (default: false)"),
    width: z.number().optional().describe("Window width in pixels"),
    height: z.number().optional().describe("Window height in pixels"),
  }).merge(MaxTokensSchema),
});

export const FillFormTool = z.object({
  name: z.literal("browser_fill_form"),
  description: z.literal("Fill multiple form fields at once, including forms inside iframes via frameTarget."),
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
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
});

export const SubmitFormTool = z.object({
  name: z.literal("browser_submit_form"),
  description: z.literal("Submit a form"),
  arguments: ElementSchema.merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GetNetworkLogsTool = z.object({
  name: z.literal("browser_get_network_logs"),
  description: z.literal("Get captured network requests/responses. Pass tabTarget to scope to a single tab (avoids cross-tab leakage that used to happen because the log was global). Pass since=<epoch ms> to skip stale entries from earlier in the session. The underlying buffer is capped at 1000 entries (rolling) so a long-lived session can't accumulate megabytes of stale traffic."),
  arguments: z.object({
    filter: z.string().optional().describe("Optional filter to match URLs (e.g., 'api', '.json')"),
    since: z.number().int().nonnegative().optional().describe("Only return entries with timestamp >= this epoch-ms value. Useful to skip stale entries from prior navigations."),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const SnapshotTool = z.object({
  name: z.literal("browser_snapshot"),
  description: z.literal(
    "Capture accessibility snapshot of the current page or a specific iframe. " +
    "Use this for getting references to elements to interact with. " +
    "Defaults to interactive elements only (buttons, links, inputs, etc.) to minimize context usage. " +
    "Set interactiveOnly: false for the full tree. " +
    "Use frameTarget to snapshot the contents of a specific iframe."
  ),
  arguments: z.object({
    interactiveOnly: z.boolean().default(true).describe("Only include interactive elements (buttons, links, inputs, etc.). Default: true. Set to false for the full accessibility tree."),
    maxDepth: z.number().default(5).describe("Maximum depth to traverse in the accessibility tree. Default: 5."),
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
});

export const ClickTool = z.object({
  name: z.literal("browser_click"),
  description: z.literal("Perform click on a web page element, including elements inside iframes via frameTarget."),
  arguments: ElementSchema.merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
});

export const HoverTool = z.object({
  name: z.literal("browser_hover"),
  description: z.literal("Hover over element on page, including elements inside iframes via frameTarget."),
  arguments: ElementSchema.merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
});

export const TypeTool = z.object({
  name: z.literal("browser_type"),
  description: z.literal("Type text into editable element, including inputs inside iframes via frameTarget."),
  arguments: ElementSchema.extend({
    text: z.string().describe("Text to type into the element"),
    submit: z
      .boolean()
      .describe("Whether to submit entered text (press Enter after)"),
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const ScreenshotTool = z.object({
  name: z.literal("browser_screenshot"),
  description: z.literal("Take a screenshot of the current page"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const SegmentedScreenshotTool = z.object({
  name: z.literal("browser_segmented_screenshot"),
  description: z.literal(
    "Capture multiple screenshots of specific page elements based on CSS selectors. " +
    "Each selector will produce a separate PNG image file saved to disk. " +
    "Elements are automatically scrolled into view before capture. " +
    "Returns array of file paths (not base64) to minimize context usage."
  ),
  arguments: z.object({
    selectors: z
      .array(z.string())
      .min(1)
      .describe(
        "Array of CSS selectors identifying elements to capture " +
        "(e.g., ['.header', '.main', '.footer']). " +
        "Each element will be captured as a separate image."
      ),
    outputDir: z
      .string()
      .optional()
      .describe("Output directory for screenshots (default: /tmp)"),
    prefix: z
      .string()
      .optional()
      .describe("Filename prefix (default: 'segment')"),
    includeLabels: z
      .boolean()
      .optional()
      .describe(
        "Include element ID or first class name in filename " +
        "(default: false)"
      ),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GetConsoleLogsTool = z.object({
  name: z.literal("browser_get_console_logs"),
  description: z.literal("Get the console logs from the browser"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const EvaluateTool = z.object({
  name: z.literal("browser_evaluate"),
  description: z.literal(
    "Evaluate JavaScript expression in the page or inside a specific iframe. " +
    "Use frameTarget with a frameId from browser_list_frames to execute inside an iframe. " +
    "CDP bypasses same-origin policy, so cross-origin iframes are accessible."
  ),
  arguments: z.object({
    expression: z
      .string()
      .describe("JavaScript expression to evaluate in page context"),
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
});

export const ListFramesTool = z.object({
  name: z.literal("browser_list_frames"),
  description: z.literal(
    "List all frames (iframes) in the current page. " +
    "Returns frameId, url, parentFrameId, name, and best-effort iframeSelector for each frame. " +
    "Use the frameId with browser_evaluate, browser_click, browser_type, browser_snapshot, " +
    "browser_query_dom, and browser_fill_form via their frameTarget parameter to operate inside a frame. " +
    "CDP bypasses same-origin policy — cross-origin iframes are accessible."
  ),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const GetErrorsTool = z.object({
  name: z.literal("browser_get_errors"),
  description: z.literal(
    "Get a unified error report across all attached browser tabs and the extension background. " +
    "Returns page-level errors/warnings (from all tabs), background handler errors, tab health status, " +
    "and a summary. Use 'since' to filter to errors after a timestamp. " +
    "Designed for the heal/diagnostic workflow — call this first when something seems wrong."
  ),
  arguments: z.object({
    since: z.number().optional().describe("Only return errors after this Unix ms timestamp"),
    levelsOnly: z.array(z.string()).optional().describe("Filter page errors to these levels (e.g. ['error']). Defaults to error+warning."),
  }).merge(MaxTokensSchema),
});

export const ReloadExtensionTool = z.object({
  name: z.literal("browser_reload_extension"),
  description: z.literal(
    "Reload the unibrowse Chrome extension (calls chrome.runtime.reload()). " +
    "Use this to recover from extension crashes, stale state, or after background.js errors. " +
    "The extension will reconnect automatically within ~2 seconds. " +
    "All attached tab sessions will need to be re-established after reload."
  ),
  arguments: z.object({}).merge(MaxTokensSchema),
});

// DOM Exploration Tools

export const QueryDOMTool = z.object({
  name: z.literal("browser_query_dom"),
  description: z.literal(
    "Query DOM elements by CSS selector and return basic info without full ARIA tree. " +
    "Use frameTarget to query inside a specific iframe."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector to query elements"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of elements to return (default: 10)"),
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const CheckVisibilityTool = z.object({
  name: z.literal("browser_check_visibility"),
  description: z.literal(
    "Check if element is visible, hidden, in viewport, or has specific display state"
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const CountElementsTool = z.object({
  name: z.literal("browser_count_elements"),
  description: z.literal("Count number of elements matching a CSS selector"),
  arguments: z.object({
    selector: z.string().describe("CSS selector to count matching elements"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GetPageMetadataTool = z.object({
  name: z.literal("browser_get_page_metadata"),
  description: z.literal(
    "Get page metadata including title, description, Open Graph tags, schema.org data, etc."
  ),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const GetFilteredAriaTreeTool = z.object({
  name: z.literal("browser_get_filtered_aria_tree"),
  description: z.literal(
    "Get ARIA tree with filters to reduce token usage (e.g. only interactive elements, specific roles, max depth). " +
    "Use frameTarget to get the ARIA tree of a specific iframe."
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
  }).merge(TabTargetSchema).merge(FrameTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const CheckElementStateTool = z.object({
  name: z.literal("browser_check_element_state"),
  description: z.literal(
    "Check element state: enabled/disabled, checked/unchecked, selected, readonly, required, etc."
  ),
  arguments: z.object({
    selector: z.string().describe("CSS selector for the target element"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const RequestUserActionTool = z.object({
  name: z.literal("browser_request_user_action"),
  description: z.literal(
    "Request the user to perform an action in the browser. Shows a notification and overlay with instructions. User can complete or reject the request. Captures all interactions from request to completion via the background log. More flexible than request_demonstration - use this for both learning workflows AND getting user assistance."
  ),
  arguments: z.object({
    request: z.string().describe("Clear instructions for what you want the user to do (e.g., 'Please navigate to your shopping cart and add an item')"),
    timeout: z.number().optional().describe("Maximum time to wait for user response in seconds (default: 300s = 5 minutes). After timeout, request is automatically cancelled."),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const DeleteCookieTool = z.object({
  name: z.literal("browser_delete_cookie"),
  description: z.literal("Delete a specific cookie"),
  arguments: z.object({
    url: z.string().describe("URL of the cookie to delete"),
    name: z.string().describe("Name of the cookie to delete"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const CancelDownloadTool = z.object({
  name: z.literal("browser_cancel_download"),
  description: z.literal("Cancel a download in progress"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to cancel"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const OpenDownloadTool = z.object({
  name: z.literal("browser_open_download"),
  description: z.literal("Open a downloaded file"),
  arguments: z.object({
    downloadId: z.number().describe("ID of the download to open"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

// Clipboard Tools
export const GetClipboardTool = z.object({
  name: z.literal("browser_get_clipboard"),
  description: z.literal("Read text from the clipboard"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const SetClipboardTool = z.object({
  name: z.literal("browser_set_clipboard"),
  description: z.literal("Write text to the clipboard"),
  arguments: z.object({
    text: z.string().describe("Text to write to the clipboard"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GetHistoryVisitsTool = z.object({
  name: z.literal("browser_get_history_visits"),
  description: z.literal("Get visit details for a URL"),
  arguments: z.object({
    url: z.string().describe("URL to get visit history for"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const DeleteHistoryTool = z.object({
  name: z.literal("browser_delete_history"),
  description: z.literal("Delete specific URLs from history"),
  arguments: z.object({
    urls: z.array(z.string()).describe("URLs to delete from history"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

// System Information Tools
export const GetVersionTool = z.object({
  name: z.literal("browser_get_version"),
  description: z.literal("Get browser version information"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const GetSystemInfoTool = z.object({
  name: z.literal("browser_get_system_info"),
  description: z.literal("Get system information including OS, platform, and architecture"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const GetBrowserInfoTool = z.object({
  name: z.literal("browser_get_browser_info"),
  description: z.literal("Get browser capabilities and information"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

// Network Tools
export const GetNetworkStateTool = z.object({
  name: z.literal("browser_get_network_state"),
  description: z.literal("Get current network connection state"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const ClearCacheTool = z.object({
  name: z.literal("browser_clear_cache"),
  description: z.literal("Clear browser cache"),
  arguments: z.object({
    cacheStorage: z
      .boolean()
      .optional()
      .describe("Clear cache storage (default: true)"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const DeleteBookmarkTool = z.object({
  name: z.literal("browser_delete_bookmark"),
  description: z.literal("Delete a bookmark by ID"),
  arguments: z.object({
    id: z.string().describe("Bookmark ID to delete"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

// Extension Management Tools
export const ListExtensionsTool = z.object({
  name: z.literal("browser_list_extensions"),
  description: z.literal("List all installed browser extensions"),
  arguments: TabTargetSchema.merge(MaxTokensSchema),
});

export const GetExtensionInfoTool = z.object({
  name: z.literal("browser_get_extension_info"),
  description: z.literal("Get detailed information about a specific extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const EnableExtensionTool = z.object({
  name: z.literal("browser_enable_extension"),
  description: z.literal("Enable a disabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to enable"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const DisableExtensionTool = z.object({
  name: z.literal("browser_disable_extension"),
  description: z.literal("Disable an enabled extension"),
  arguments: z.object({
    id: z.string().describe("Extension ID to disable"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

// Macro Management Tools
export const StoreMacroTool = z.object({
  name: z.literal("browser_store_macro"),
  description: z.literal(
    "Store a new executable JavaScript macro for site-specific automation. " +
    "Macros are reusable routines that encapsulate common workflows. Two kinds: " +
    "`page` macros (default) run in the page's MAIN-world context via Runtime.evaluate — " +
    "they can do DOM work but can't trigger real OS input or call other browser_* tools. " +
    "`routine` macros run host-side in the mcp-server Node runtime with a `ctx` handle " +
    "that exposes the browser tool surface as awaitable calls (ctx.navigate, ctx.evaluate, " +
    "ctx.realisticClick, ctx.waitForUrl, ...). Routines can sequence real CDP input + " +
    "navigation + page-JS into a single reusable flow. SECURITY NOTE: routine macros " +
    "execute with full mcp-server process privileges (filesystem, network, env). Treat " +
    "routine-kind authoring as admin-equivalent — only store routines you'd run as the server."
  ),
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
    code: z.string().describe(
      "JavaScript function code. Page-kind: `(params) => { /* page-JS, DOM only */ return result; }`. " +
      "Routine-kind: `async (params, ctx) => { /* sequence ctx.* tool calls + JS */ return result; }`."
    ),
    kind: z.enum(["page", "routine"]).optional().describe(
      "Execution model. 'page' (default) = legacy in-page eval, DOM-only, no real input. " +
      "'routine' = host-side runner with ctx tool handle (navigate/evaluate/realisticClick/" +
      "waitForUrl/etc.) composable inside the macro. Routines are admin-trust code."
    ),
    returnType: z.string().describe("Description of what the macro returns"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Reliability rating (default: untested)"),
    tags: z.array(z.string()).optional().describe("Tags for filtering and search"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GetMacroTool = z.object({
  name: z.literal("browser_get_macro"),
  description: z.literal("Fetch a stored macro's full source by id, including the JavaScript code body, parameter schema, description, usage statistics, and reliability rating. Read-only — use this to inspect or iterate on a macro before patching with browser_update_macro. Complements browser_list_macros (which returns metadata only)."),
  arguments: z.object({
    id: z.string().describe("Macro ID to fetch"),
  }).merge(MaxTokensSchema),
});

export const ExecuteMacroTool = z.object({
  name: z.literal("browser_execute_macro"),
  description: z.literal("Execute a stored macro by ID with provided parameters. The macro runs in the page context and returns the result. Pass timeout_ms (default 30000, max 120000) to extend the WebSocket-level wait for long-running macros — the previous default 30s ceiling could not be overridden from the caller."),
  arguments: z.object({
    id: z.string().describe("Macro ID to execute"),
    params: z.record(z.any()).optional().describe("Parameters to pass to the macro function"),
    timeout_ms: z.number().int().positive().max(120000).optional().describe("WebSocket-level timeout for this call in ms (default 30000, max 120000). Use for macros known to take longer than 30s (e.g. multi-step network waits)."),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
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
    kind: z.enum(["page", "routine"]).optional().describe(
      "Promote/demote between execution kinds (see browser_store_macro for semantics). Omit to leave unchanged."
    ),
    returnType: z.string().optional().describe("Updated return type description"),
    reliability: z.enum(["high", "medium", "low", "untested"]).optional().describe("Updated reliability rating"),
    tags: z.array(z.string()).optional().describe("Updated tags"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const DeleteMacroTool = z.object({
  name: z.literal("browser_delete_macro"),
  description: z.literal("Delete a macro by ID. This action cannot be undone. Only the owner can delete macros."),
  arguments: z.object({
    id: z.string().describe("Macro ID to delete"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const RealisticMouseMoveTool = z.object({
  name: z.literal("browser_realistic_mouse_move"),
  description: z.literal("Move mouse cursor along a natural bezier curve path to target coordinates. More human-like than instant positioning. Uses CDP Input domain for OS-level events."),
  arguments: z.object({
    x: z.number().describe("Target X coordinate"),
    y: z.number().describe("Target Y coordinate"),
    duration: z.number().optional().describe("Movement duration in milliseconds (default: 500)"),
    currentX: z.number().optional().describe("Current mouse X position (default: 0)"),
    currentY: z.number().optional().describe("Current mouse Y position (default: 0)"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const RealisticClickTool = z.object({
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
    currentY: z.number().optional().describe("Current mouse Y position for movement calculation (default: 0)"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const RealisticTypeTool = z.object({
  name: z.literal("browser_realistic_type"),
  description: z.literal("Type text with realistic human-like timing and optional typos. Variable delays between keystrokes. Uses CDP Input domain for OS-level keyboard events."),
  arguments: z.object({
    text: z.string().describe("Text to type"),
    minDelay: z.number().optional().describe("Minimum delay between keystrokes in ms (default: 50)"),
    maxDelay: z.number().optional().describe("Maximum delay between keystrokes in ms (default: 150)"),
    mistakeChance: z.number().optional().describe("Probability of making a typo that gets corrected, 0-1 (default: 0)"),
    pressEnter: z.boolean().optional().describe("Whether to press Enter after typing (default: false)"),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

// ==================== VIDEO RECORDING TOOLS ====================

export const StartVideoRecordingTool = z.object({
  name: z.literal("browser_start_video_recording"),
  description: z.literal(
    "Start recording video of the current tab using Chrome's tab capture API. " +
    "Records a WebM video of exactly what is visible in the tab. " +
    "After starting, use any browser interaction tools (scroll, click, mouse move, type, navigate) to create scripted page interactions — all will be captured in the video. " +
    "Call browser_stop_video_recording when done to save the video to a file."
  ),
  arguments: z.object({}).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const StopVideoRecordingTool = z.object({
  name: z.literal("browser_stop_video_recording"),
  description: z.literal(
    "Stop the active tab video recording and save it to a file. " +
    "Returns the path to the saved WebM video file. " +
    "The video captures everything that happened in the tab since browser_start_video_recording was called."
  ),
  arguments: z.object({
    output_path: z
      .string()
      .optional()
      .describe("File path to save the video. Defaults to /tmp/unibrowse_video_<timestamp>.webm"),
  }).merge(MaxTokensSchema),
});

// ==================== MULTI-TAB MANAGEMENT TOOLS ====================

export const ListAttachedTabsTool = z.object({
  name: z.literal("browser_list_attached_tabs"),
  description: z.literal(
    "List all tabs that have debugger attached with their labels and IDs. " +
    "Use this to find valid tabTarget values for browser_navigate, browser_snapshot, browser_click, and all other tab-targeting operations. " +
    "Only attached tabs can be targeted — use browser_attach_tab or browser_create_tab to attach new tabs."
  ),
  arguments: z.object({}).merge(MaxTokensSchema),
});

export const SetTabLabelTool = z.object({
  name: z.literal("browser_set_tab_label"),
  description: z.literal(
    "Set or update a tab's label. Labels are used to identify tabs in a human-readable way."
  ),
  arguments: z.object({
    tabTarget: z
      .union([z.number(), z.string()])
      .describe("Tab identifier (tab ID or current label) of the tab to update"),
    label: z.string().describe("The new label for the tab"),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const DetachTabTool = z.object({
  name: z.literal("browser_detach_tab"),
  description: z.literal(
    "Detach debugger from a specific tab. This removes the tab from the list of attached tabs. Accepts either a numeric tabId or a tabTarget label."
  ),
  arguments: z.object({
    tabId: z.number().optional().describe("Numeric Chrome tab ID to detach"),
    tabTarget: z.union([z.string(), z.number()]).optional().describe("Tab label or ID (resolves via attached tab registry)"),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema).refine(d => d.tabId !== undefined || d.tabTarget !== undefined, {
    message: "Provide either tabId (number) or tabTarget (label/id)",
  }),
});

export const GetActiveTabTool = z.object({
  name: z.literal("browser_get_active_tab"),
  description: z.literal(
    "Get information about the currently active (last-used) tab. " +
    "Returns tab ID, label, URL, and last used timestamp."
  ),
  arguments: z.object({}).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const AttachTabTool = z.object({
  name: z.literal("browser_attach_tab"),
  description: z.literal(
    "Attach debugger to a browser tab. Can attach to an existing tab by ID or open a new tab with a URL. " +
    "Use this to start controlling a tab before performing operations on it. When you pass `agent`, the tab " +
    "is reserved to you and other agents will get a tab-reserved error on attempted control."
  ),
  arguments: z.object({
    tabId: z
      .number()
      .optional()
      .describe("The tab ID to attach to (if attaching to existing tab)"),
    autoOpenUrl: z
      .string()
      .optional()
      .describe("URL to open in a new tab and attach to (if opening new tab)"),
    label: z
      .string()
      .optional()
      .describe("Optional label to assign to the tab after attaching"),
    agent: z
      .string()
      .optional()
      .describe("Your agent identifier; if supplied, the attached tab is reserved to you."),
    takeover: z
      .boolean()
      .optional()
      .describe("When attaching to a tab already reserved by a different agent, set true to forcibly transfer ownership."),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const ReserveTabTool = z.object({
  name: z.literal("browser_reserve_tab"),
  description: z.literal(
    "Explicitly reserve an already-attached tab for an agent. Useful when claiming a tab someone else created or previously released. " +
    "Requires `agent`. Returns tab-reserved if another agent owns it and `takeover` isn't set; pass takeover:true to forcibly transfer (logged in tab history)."
  ),
  arguments: z.object({
    tabTarget: z.union([z.number(), z.string()]).describe("Tab ID or label to reserve"),
    agent: z.string().describe("Your agent identifier"),
    takeover: z.boolean().optional().describe("Forcibly take over from the current owner"),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

export const ReleaseTabTool = z.object({
  name: z.literal("browser_release_tab"),
  description: z.literal(
    "Release the reservation on a tab so another agent can claim it. The owner is logged in the tab's history. " +
    "If `agent` is supplied, only the matching owner may release; if omitted, the release is permissive."
  ),
  arguments: z.object({
    tabTarget: z.union([z.number(), z.string()]).describe("Tab ID or label to release"),
    agent: z.string().optional().describe("Your agent identifier (must match the current owner unless omitted)"),
  }).merge(ExtensionIdSchema).merge(MaxTokensSchema),
});

// ==================== RECORDINGS TOOLS ====================

const RecordingStepSchema = z.object({
  id: z.number().describe("1-based sequential step ID"),
  type: z.string().describe("Interaction type: click, input, keydown, scroll, etc."),
  timestamp: z.number().describe("Milliseconds offset from recording startTime"),
  url: z.string().optional().describe("Page URL when this step occurred"),
  element: z.object({
    selector: z.string().optional(),
    tagName: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
  }).optional().describe("Element context"),
  note: z.string().optional().describe("User annotation for this step"),
  value: z.string().optional().describe("Input value (for input/change events)"),
  key: z.string().optional().describe("Key name (for keydown events)"),
  x: z.number().optional().describe("Click X coordinate"),
  y: z.number().optional().describe("Click Y coordinate"),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  // Selector capture step fields (type === 'selector_capture')
  name: z.string().optional().describe("User-assigned name for the captured data point"),
  description: z.string().optional().describe("What this selector captures"),
  selector: z.string().optional().describe("The chosen CSS selector"),
  matchCount: z.number().optional().describe("Number of page elements matched"),
  selectorOptions: z.array(z.object({
    strategy: z.string(),
    selector: z.string(),
    count: z.number(),
  })).optional(),
  elements: z.array(z.object({
    tagName: z.string(),
    text: z.string().optional(),
  })).optional(),
  region: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number()
  }).optional(),
});

export const SaveRecordingTool = z.object({
  name: z.literal("browser_save_recording"),
  description: z.literal(
    "Save a user interaction recording to MongoDB for later retrieval by agents. " +
    "Called internally by the extension after the user reviews and confirms a recording."
  ),
  arguments: z.object({
    sessionId: z.string().describe("Session ID from the recording session"),
    title: z.string().describe("User-provided title for the recording"),
    description: z.string().optional().describe("Optional description of what the recording demonstrates"),
    tags: z.array(z.string()).optional().describe("Tags for categorization and search"),
    startUrl: z.string().optional().describe("URL where the recording started"),
    startTime: z.number().describe("Unix timestamp (ms) when recording started"),
    endTime: z.number().describe("Unix timestamp (ms) when recording ended"),
    duration: z.number().describe("Recording duration in milliseconds"),
    steps: z.array(RecordingStepSchema).describe("Array of recorded interaction steps"),
  }),
});

export const ListRecordingsTool = z.object({
  name: z.literal("browser_list_recordings"),
  description: z.literal(
    "List saved session recordings from MongoDB. Returns metadata for each: title, description, tags, " +
    "startUrl, duration, pages visited, network request count, interaction count, and annotations. " +
    "Use browser_get_recording with includeEvents=true to get full events for analysis."
  ),
  arguments: z.object({
    search: z.string().optional().describe("Search term to match against title and description"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns recordings matching any tag)"),
    startUrl: z.string().optional().describe("Filter by starting URL (partial match)"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 50)"),
  }).merge(MaxTokensSchema),
});

export const GetRecordingTool = z.object({
  name: z.literal("browser_get_recording"),
  description: z.literal(
    "Get a saved session recording by ID. Returns metadata by default. " +
    "Use includeInteractions/includeNetwork/includeStats to fetch event data, with optional filtering by time range, " +
    "interaction type, selector, URL pattern, HTTP method/status, and limit/offset pagination. " +
    "includeEvents=true is shorthand for includeInteractions+includeNetwork. " +
    "Use browser_list_recordings to find IDs."
  ),
  arguments: z.object({
    id: z.string().describe("The recording ID to retrieve"),
    // what to include
    includeEvents: z.boolean().optional().describe("Shorthand for includeInteractions=true + includeNetwork=true."),
    includeInteractions: z.boolean().optional().describe("Include user interaction events (clicks, scrolls, inputs, navigations)."),
    includeNetwork: z.boolean().optional().describe("Include network request/response entries."),
    includeStats: z.boolean().optional().describe("Include summary statistics: counts by interaction type, top URLs, network error rate, time span."),
    includeAnnotations: z.boolean().optional().describe(
      "Include user-drawn annotations (pencil / rectangle / lasso) captured during the recording. " +
      "Each annotation has: id, timestamp, tool, shape, bbox, viewport, domTargets (ranked list of " +
      "DOM elements under the shape — xpath + css + text), note, pageUrl, pageTitle, and " +
      "screenshotPng (base64 PNG of the cropped area, often 100-300KB). Agents use this to understand " +
      "what ben highlighted + what he wants done."
    ),
    annotationStripScreenshots: z.boolean().optional().describe(
      "When includeAnnotations is true, drop the base64 screenshot PNGs from each annotation (keep " +
      "only metadata + shape + note + domTargets). Use this when you just want the annotation list for " +
      "navigation and don't need the visuals — saves response token budget."
    ),
    // time range
    startTime: z.number().optional().describe("Filter events at or after this Unix timestamp (ms)."),
    endTime: z.number().optional().describe("Filter events at or before this Unix timestamp (ms)."),
    // interaction filters
    interactionTypes: z.array(z.string()).optional().describe("Filter interactions by kind, e.g. ['click', 'scroll', 'mousemove', 'dom_mutation', 'keydown', 'navigate']."),
    selectorPattern: z.string().optional().describe("Regex applied to interaction selector strings."),
    // network filters
    networkUrlPattern: z.string().optional().describe("Regex applied to network entry URLs."),
    networkMethod: z.string().optional().describe("Filter network entries by HTTP method (GET, POST, etc.)."),
    networkStatusMin: z.number().optional().describe("Keep network entries with status >= this value."),
    networkStatusMax: z.number().optional().describe("Keep network entries with status <= this value."),
    // pagination
    limit: z.number().optional().describe("Max interactions or network entries to return (default: 100)."),
    offset: z.number().optional().describe("Skip first N results for pagination (default: 0)."),
    // body size controls — finance reported a single 80KB+ response body blowing
    // past MCP's 25k-token cap even with limit=30. Two knobs:
    bodyMaxBytes: z.number().optional().describe(
      "Truncate each request/response body to this many bytes (default: no truncation). " +
      "When applied, the truncated body has `...[truncated N more bytes]` appended so the " +
      "consumer knows it's incomplete. Use this to inspect many entries without hitting the " +
      "MCP response token cap (~25k)."
    ),
    excludeBodies: z.boolean().optional().describe(
      "When true, requestBody and responseBody are dropped entirely from network entries; " +
      "headers, status, URL, method, and timing are preserved. Use for metadata-only sweeps " +
      "(find candidate URLs/methods first, then re-fetch with bodyMaxBytes for specific ones)."
    ),
  }).merge(MaxTokensSchema),
});

export const UpdateRecordingTool = z.object({
  name: z.literal("browser_update_recording"),
  description: z.literal(
    "Update the title, description, or tags of a saved session recording. " +
    "Use this to annotate sessions after reviewing them."
  ),
  arguments: z.object({
    id: z.string().describe("The recording ID to update"),
    title: z.string().optional().describe("New title for the recording"),
    description: z.string().optional().describe("Description of what this session demonstrates"),
    tags: z.array(z.string()).optional().describe("Tags for categorization (replaces existing tags)"),
  }).merge(MaxTokensSchema),
});

export const DeleteRecordingTool = z.object({
  name: z.literal("browser_delete_recording"),
  description: z.literal(
    "Delete a saved user interaction recording by ID."
  ),
  arguments: z.object({
    id: z.string().describe("The recording ID to delete"),
  }).merge(MaxTokensSchema),
});

export const GetRecordingScreenshotTool = z.object({
  name: z.literal("browser_get_recording_screenshot"),
  description: z.literal(
    "Get a screenshot of a session recording at a specific timestamp. " +
    "Two modes: 'video' extracts a frame from the recorded video using ffmpeg (fast, full-page); " +
    "'dom' replays rrweb events in a live browser tab and screenshots the reconstructed DOM " +
    "(supports selector highlighting, works even without video). " +
    "'auto' uses video if available, falls back to dom. " +
    "Returns a PNG image. Use browser_get_recording to find timestamps from interactions/network entries."
  ),
  arguments: z.object({
    id: z.string().describe("Recording ID"),
    timestamp: z.number().describe("Unix timestamp in ms to render. Use 0 for the start of the recording."),
    selector: z.string().optional().describe("CSS selector to highlight in the DOM replay (dom/auto mode). Draws a red outline around the matched element."),
    mode: z.enum(["video", "dom", "auto"]).optional().describe("Screenshot source: 'video' (ffmpeg frame), 'dom' (rrweb replay), 'auto' (default — video if available, else dom)."),
    tabId: z.number().optional().describe("For video mode with multi-tab recordings: which tab's video to use. Defaults to primaryTabId."),
  }).merge(MaxTokensSchema),
});

// ==================== SESSION RECORDING TOOLS ====================

export const StartSessionRecordingTool = z.object({
  name: z.literal("browser_start_session_recording"),
  description: z.literal(
    "Start a rich session recording on the targeted browser tab. Captures: full DOM mutations (rrweb), " +
    "all XHR/fetch network traffic with request/response bodies, mouse interactions, and tab video. " +
    "Survives cross-domain navigation — if the recorded tab navigates, the recording follows it. " +
    "Returns a sessionId. Use browser_stop_session_recording when done — the review URL is returned " +
    "and a review tab opens automatically (pass openReview:false on stop to suppress). " +
    "Pin to a specific browser via extensionId in multi-extension mode; use tabTarget to record a " +
    "non-active tab. Agents can use this to show ben what they did during a multi-step flow."
  ),
  arguments: z.object({}).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const StopSessionRecordingTool = z.object({
  name: z.literal("browser_stop_session_recording"),
  description: z.literal(
    "Stop the active session recording, save all captured data (DOM events, network traffic, video) " +
    "to the server, and return the review URL. By default a review tab opens automatically; pass " +
    "openReview:false to suppress (useful for headless agent flows where opening a tab in the sidecar " +
    "would just be noise). Review URL is always returned in the response regardless."
  ),
  arguments: z.object({
    openReview: z.boolean().optional().describe(
      "Whether to auto-open the review page in a new tab when the recording stops (default: true). " +
      "Pass false for headless / programmatic flows that just want the reviewUrl back without polluting " +
      "the browser with a new tab."
    ),
  }).merge(TabTargetSchema).merge(MaxTokensSchema),
});

export const GetSessionRecordingStateTool = z.object({
  name: z.literal("browser_get_session_recording_state"),
  description: z.literal(
    "Check whether a session recording is currently in progress on the targeted browser. Returns " +
    "{ isRecording, sessionId?, startedAt?, primaryTabId?, rrwebEventCount?, networkEntryCount? } so " +
    "agents can decide whether to start, stop, or extend. Useful at the start of a flow to avoid " +
    "double-starting, or before stop to know whether a stop call would actually do anything."
  ),
  arguments: z.object({}).merge(TabTargetSchema).merge(MaxTokensSchema),
});

// ==================== CHROME LAUNCHER TOOL ====================

export const LaunchIsolatedChromeTool = z.object({
  name: z.literal("browser_launch_isolated_chrome"),
  description: z.literal(
    "Launch Chrome in isolated mode with the Browser MCP extension pre-loaded. " +
    "Creates an isolated profile separate from your main browser, useful for testing, " +
    "automation, and development. The extension will auto-connect to the MCP server."
  ),
  arguments: z.object({
    profileName: z
      .string()
      .optional()
      .describe("Name for the isolated profile (default: 'unibrowse-test'). " +
               "Each profile is stored separately in .chrome-profiles/"),
    url: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("URL or array of URLs to open on launch (default: chrome://extensions/)"),
    width: z
      .number()
      .optional()
      .describe("Window width in pixels"),
    height: z
      .number()
      .optional()
      .describe("Window height in pixels"),
    headless: z
      .boolean()
      .optional()
      .describe(
        "Launch in headless / no-user-window-pollution mode (default: false). " +
        "When the chromium-host sidecar is active (UNIBROWSE_CHROMIUM_HOST set on the server), " +
        "`headless: true` routes through the sidecar with Xvfb-headful rendering — giving you " +
        "a fully isolated chromium (no user-Chrome interaction) AND a real-browser fingerprint " +
        "that defeats Auth0/Cloudflare/Akamai anti-bot gates. If you specifically need the " +
        "lighter --headless=new flag (faster, but detectable, suitable only for pure scraping " +
        "where anti-bot doesn't matter), pass `realHeadless: true` as well."
      ),
    realHeadless: z
      .boolean()
      .optional()
      .describe(
        "Opt into chromium's `--headless=new` flag instead of Xvfb-headful when `headless: true` " +
        "is set and the sidecar is active. Lighter / faster, but anti-bot detectable. Only useful " +
        "for pure scraping where the target doesn't fingerprint headless Chrome."
      ),
    autoAttach: z
      .boolean()
      .optional()
      .describe(
        "After spawn, automatically attach the URL tab(s) to the unibrowse debugger so the agent " +
        "can immediately drive them with browser_navigate/evaluate/click/etc without a separate " +
        "browser_attach_tab call. Default true. When true, the response includes `tabId` (first url) " +
        "and `tabIds` (all urls). When false (or when no url was provided), only `extensionId` is " +
        "returned and the caller must attach explicitly."
      ),
    agent: z
      .string()
      .optional()
      .describe(
        "Your agent identifier. When supplied, attached tabs are reserved to you so other agents " +
        "can't drive them without takeover. Forwarded to the implicit browser_create_tab calls " +
        "that auto-attach the launch URLs."
      ),
    freshProfile: z
      .boolean()
      .optional()
      .describe("Always start with a fresh profile, DELETING any existing data (cookies, history, auth). " +
               "Default: TRUE — note the destructive value is the default. Set to false to persist " +
               "profile data between sessions. Profiles on the sidecar's persistent allowlist refuse " +
               "to be wiped by this flag alone; see forceProfileName."),
    forceProfileName: z
      .string()
      .optional()
      .describe("Override for wiping a PERSISTENT profile with freshProfile:true. Must equal profileName " +
               "verbatim, which is deliberate friction: a plain boolean force flag gets set once in a " +
               "wrapper and silently inherited by every later call. Persistent profiles hold long-lived " +
               "auth that is expensive to rebuild — prefer a freshProfile:false restart, which reuses the " +
               "profile and self-heals. Overrides are logged and the owning session is DM'd."),
  }).merge(MaxTokensSchema),
});

export const CloseIsolatedChromeTool = z.object({
  name: z.literal("browser_close_isolated_chrome"),
  description: z.literal(
    "Shut down an isolated chromium launched by browser_launch_isolated_chrome, freeing its processes " +
    "and its paired Xvfb display. This is the destroy counterpart to that tool — without it every " +
    "launched instance leaks until someone reaps it by hand (browser_close_tab only reaps renderers " +
    "and returns success while the browser lives on). PROCESS-ONLY: never deletes the profile " +
    "directory, so auth state survives and the instance can be relaunched with freshProfile:false."
  ),
  arguments: z.object({
    extensionId: z
      .string()
      .optional()
      .describe("extensionId of the instance to close, as returned by browser_launch_isolated_chrome " +
               "or browser_list_attached_tabs. Either this or profileName is required."),
    profileName: z
      .string()
      .optional()
      .describe("Profile name of the instance to close (e.g. 'swap-ben'). More reliable than " +
               "extensionId for instances launched before the current mcp-server started. " +
               "Either this or extensionId is required."),
    forceProfileName: z
      .string()
      .optional()
      .describe("Required to close an instance whose profile is on the persistent allowlist. Must equal " +
               "the profile name verbatim. Persistent profiles are long-lived on purpose (e.g. auth " +
               "brokers that look idle by design); closing one is cheap to recover from but should be " +
               "deliberate. The owning session is notified."),
    caller: z
      .string()
      .optional()
      .describe("Your agent identifier, recorded in the override audit line and the owner notification."),
  }).merge(MaxTokensSchema),
});
