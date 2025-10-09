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

export const RequestDemonstrationTool = z.object({
  name: z.literal("browser_request_demonstration"),
  description: z.literal(
    "Ask the user to demonstrate how to perform a task. Shows a notification in the browser with a Start button. Records all DOM interactions and network activity until the user clicks Done or presses Ctrl+Shift+D."
  ),
  arguments: z.object({
    request: z.string().describe("Description of what you want the user to demonstrate (e.g., 'Please add an item to your cart')"),
    timeout: z.number().optional().describe("Maximum time to wait for the demonstration in seconds (default: no timeout - waits indefinitely). Specify a timeout only if you need to limit the duration."),
  }),
});
