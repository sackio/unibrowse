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
  // ⚠️ THESE THREE WERE MISSING FROM THIS MAP WHILE THEIR TOOLS SHIPPED AND
  // WORKED. tools/common.ts and tools/recordings.ts have been sending them for
  // a long time; the only effect of the omission was a `tsc` error at every
  // call site, which is part of why this file's error baseline is what it is.
  // Added when Slipway needed them. Shapes are deliberately permissive —
  // every caller forwards a validated params object straight through, so a
  // narrow shape here would turn a working call into a type error rather than
  // catching anything.
  browser_scroll: {
    x?: number;
    y?: number;
    tabTarget?: number | string;
    extensionId?: string;
  };
  browser_start_session_recording: {
    tabTarget?: number | string;
    extensionId?: string;
    [key: string]: unknown;
  };
  // Added 2026-10-12 for the auto-record host exemption: the server has to be
  // able to ASK which recordings are live before it can stop an auto-started
  // one. recordings.ts already sent this message; it was simply absent from the
  // map, so every caller took a TS2345 instead of type checking.
  browser_get_session_recording_state: {
    tabTarget?: number | string;
    extensionId?: string;
    [key: string]: unknown;
  };
  browser_stop_session_recording: {
    tabTarget?: number | string;
    extensionId?: string;
    [key: string]: unknown;
  };
  browser_set_device_metrics: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
    reset?: boolean;
    tabTarget?: number | string;
  };
  browser_set_file_input: {
    selector: string;
    paths: string[];
    tabTarget?: number | string;
    extensionId?: string;
  };

  // Watch — arm/disarm/list a push subscription in the extension. The
  // generalisation of the navigation observer below: any source, plus a cheap
  // declarative prefilter evaluated in the extension so non-matching events
  // never cross the wire. The caller's JS predicate runs on the SERVER — MV3's
  // CSP forbids evaluating a string as JS in a service worker. Matches come
  // back UNSOLICITED as a WATCH_FIRED message, not as a response.
  // See docs/WATCH_DESIGN.md.
  browser_watch_arm: {
    watchId: string;
    source: string;
    /** Declarative matcher applied in the extension; no eval, MV3-CSP-safe. */
    prefilter?: unknown;
    /** Only sent for page-home sources, where it is injected into the page. */
    predicate?: string;
    /** Per-source config for page-home sources (selector, eventName, …). */
    config?: Record<string, unknown>;
    /** The document a page watch belongs to; guards the re-inject path. */
    armedAgainstUrl?: string;
    options?: Record<string, unknown>;
    tabId?: number | null;
    extensionId?: string;
  };
  browser_watch_disarm: { watchId: string };
  browser_watch_list_armed: Record<string, never>;
  browser_watch_rearm: { specs: unknown[] };

  // Navigation observer — routine ctx.observeNavigations() backing primitives.
  // Subscription owns a regex + tabTarget; matches buffer onCommitted events.
  browser_observe_navigations_start: { pattern: string; flags?: string; tabTarget?: number | string };
  browser_observe_navigations_first: { subscriptionId: string; timeoutMs?: number };
  browser_observe_navigations_dispose: { subscriptionId: string };

  // Evaluate JS in the page's MAIN world. Declared here because it is the only
  // source of a tab's LIVE url — both browser_list_attached_tabs and getUrl
  // report tabInfo.url, captured at ATTACH time and never updated on
  // navigation. routine-runner has always sent this type; it was simply
  // undeclared.
  browser_evaluate: { expression: string; tabTarget?: number | string; extensionId?: string };

  // Information tools
  browser_get_console_logs: Record<string, never>;
  browser_screenshot: { tabTarget?: number | string };

  // ⛔ Declared because the captcha relay must foreground its own tab before a
  // retried screenshot: Chrome does not composite a hidden tab, so
  // Page.captureScreenshot waits for a frame that never comes. The extension
  // has always handled this type; it was simply undeclared, which is the same
  // gap browser_evaluate above records.
  browser_switch_tab: { tabId?: number; tabTarget?: number | string; extensionId?: string };
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

  // Realistic input — CDP Input domain, real OS-level events. Declared here
  // because the captcha relay calls both from the SERVER (not from a tool),
  // and an undeclared message type is a compile error at that call site rather
  // than at the tool, where every other caller happens to sit.
  browser_realistic_click: {
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
    clickCount?: number;
    moveFirst?: boolean;
    moveDuration?: number;
    currentX?: number;
    currentY?: number;
    tabTarget?: number | string;
  };
  browser_realistic_type: {
    text: string;
    selector?: string;
    tabTarget?: number | string;
  };

  // Retrieval from a driven browser's authenticated session.
  // ⚠️ Most download tools are absent from this file — a long-standing gap, not
  // a signal that they do not exist. Added here because it is new; do not infer
  // from a sibling's absence that this one is wrong.
  browser_fetch_to_server: {
    url: string;
    filename?: string;
    label?: string;
    tabTarget?: number | string;
  };

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
  /** `live` adds liveUrl/liveTitle/urlChanged/titleChanged per tab. DEFAULTS TRUE at the tool boundary (2026-09-26); the wire field is still explicit. */
  browser_list_attached_tabs: { live?: boolean } | Record<string, never>;
  /**
   * chrome.tabs.query — EVERY tab in the browser, attached or not, which is
   * why it carries no tabTarget. Long called by browser_list_tabs in
   * tools/tabs.ts and long absent from this map; the gap only surfaced when a
   * second caller (Slipway's tab roster) passed a typed payload.
   */
  browser_list_tabs: { extensionId?: string } | Record<string, never>;
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
