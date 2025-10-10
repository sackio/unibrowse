// Message types for WebSocket communication

export type MessageType<TMessageMap> = keyof TMessageMap & string;

export type MessagePayload<
  TMessageMap,
  TType extends MessageType<TMessageMap>
> = TType extends keyof TMessageMap ? TMessageMap[TType] : never;

// Socket message map defining all browser automation messages
export interface SocketMessageMap {
  // Interaction tools
  browser_click: { element: string; ref: string };
  browser_drag: {
    startElement: string;
    startRef: string;
    endElement: string;
    endRef: string;
  };
  browser_hover: { element: string; ref: string };
  browser_type: { element: string; ref: string; text: string; submit?: boolean };
  browser_select_option: { element: string; ref: string; values: string[] };

  // Navigation tools
  browser_navigate: { url: string };
  browser_go_back: Record<string, never>;
  browser_go_forward: Record<string, never>;
  browser_wait: { time: number };
  browser_press_key: { key: string };

  // Information tools
  browser_get_console_logs: Record<string, never>;
  browser_screenshot: Record<string, never>;
  browser_snapshot: Record<string, never>;
  getUrl: undefined;
  getTitle: undefined;

  // DOM exploration tools
  browser_query_dom: { selector: string; limit?: number };
  browser_get_visible_text: { selector?: string; maxLength?: number };
  browser_get_computed_styles: { selector: string; properties?: string[] };
  browser_check_visibility: { selector: string };
  browser_get_attributes: { selector: string; attributes?: string[] };
  browser_count_elements: { selector: string };
  browser_get_page_metadata: Record<string, never>;
  browser_get_filtered_aria_tree: {
    roles?: string[];
    maxDepth?: number;
    interactiveOnly?: boolean;
  };
  browser_find_by_text: {
    text: string;
    selector?: string;
    exact?: boolean;
    limit?: number;
  };
  browser_get_form_values: { formSelector?: string };
  browser_check_element_state: { selector: string };

  // Recording/demonstration tools
  browser_request_user_action: { request: string };

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
