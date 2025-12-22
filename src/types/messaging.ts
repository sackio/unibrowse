// Message types for WebSocket communication

export type MessageType<TMessageMap> = keyof TMessageMap & string;

export type MessagePayload<
  TMessageMap,
  TType extends MessageType<TMessageMap>
> = TType extends keyof TMessageMap ? TMessageMap[TType] : never;

// Socket message map defining all browser automation messages
export interface SocketMessageMap {
  // Interaction tools
  browser_click: { element: string; ref: string; tabTarget?: number | string };
  browser_drag: {
    startElement: string;
    startRef: string;
    endElement: string;
    endRef: string;
    tabTarget?: number | string;
  };
  browser_hover: { element: string; ref: string; tabTarget?: number | string };
  browser_type: {
    element: string;
    ref: string;
    text: string;
    submit?: boolean;
    tabTarget?: number | string;
  };
  browser_select_option: {
    element: string;
    ref: string;
    values: string[];
    tabTarget?: number | string;
  };

  // Navigation tools
  browser_navigate: { url: string; tabTarget?: number | string };
  browser_go_back: { tabTarget?: number | string };
  browser_go_forward: { tabTarget?: number | string };
  browser_wait: { time: number };
  browser_press_key: { key: string; tabTarget?: number | string };

  // Information tools
  browser_get_console_logs: Record<string, never>;
  browser_screenshot: { tabTarget?: number | string };
  browser_segmented_screenshot: {
    selectors: string[];
    outputDir?: string;
    prefix?: string;
    includeLabels?: boolean;
    tabTarget?: number | string;
  };
  browser_snapshot: { tabTarget?: number | string };
  getUrl: { tabTarget?: number | string } | undefined;
  getTitle: { tabTarget?: number | string } | undefined;

  // DOM exploration tools
  browser_query_dom: { selector: string; limit?: number; tabTarget?: number | string };
  browser_get_visible_text: {
    selector?: string;
    maxLength?: number;
    tabTarget?: number | string;
  };
  browser_get_computed_styles: {
    selector: string;
    properties?: string[];
    tabTarget?: number | string;
  };
  browser_check_visibility: { selector: string; tabTarget?: number | string };
  browser_get_attributes: {
    selector: string;
    attributes?: string[];
    tabTarget?: number | string;
  };
  browser_count_elements: { selector: string; tabTarget?: number | string };
  browser_get_page_metadata: { tabTarget?: number | string };
  browser_get_filtered_aria_tree: {
    roles?: string[];
    maxDepth?: number;
    interactiveOnly?: boolean;
    tabTarget?: number | string;
  };
  browser_find_by_text: {
    text: string;
    selector?: string;
    exact?: boolean;
    limit?: number;
    tabTarget?: number | string;
  };
  browser_get_form_values: { formSelector?: string; tabTarget?: number | string };
  browser_check_element_state: { selector: string; tabTarget?: number | string };

  // Recording/demonstration tools
  browser_request_user_action: { request: string };

  // Multi-tab management tools
  browser_list_attached_tabs: Record<string, never>;
  browser_set_tab_label: { tabId: number; label: string };
  browser_detach_tab: { tabId: number };
  browser_get_active_tab: Record<string, never>;
  browser_ensure_attached: {
    tabId: number | null;
    label: string | null;
    autoOpenUrl: string | null;
  };

  // Background interaction log tools
  browser_get_interactions: {
    startTime?: number;
    endTime?: number;
    limit?: number;
    offset?: number;
    types?: string[];
    urlPattern?: string;
    selectorPattern?: string;
    sortOrder?: 'asc' | 'desc';
  };
  browser_prune_interactions: {
    before?: number;
    after?: number;
    between?: [number, number];
    keepLast?: number;
    keepFirst?: number;
    removeOldest?: number;
    types?: string[];
    excludeTypes?: string[];
    urlPattern?: string;
    selectorPattern?: string;
  };
  browser_search_interactions: {
    query: string;
    types?: string[];
    startTime?: number;
    endTime?: number;
    limit?: number;
  };
}
