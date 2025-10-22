import { WebSocket } from "ws";

import { mcpConfig } from "@/config/mcp.config";
import {
  MessagePayload,
  MessageType,
  SocketMessageMap,
} from "@/types/messaging";
import { createSocketMessageSender } from "@/utils/messaging-sender";

const noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Browser MCP extension icon in the browser toolbar and clicking the 'Connect' button.`;

export class Context {
  private _ws: WebSocket | undefined;
  private _activeTabId: number | null = null;

  get ws(): WebSocket {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }

  set ws(ws: WebSocket) {
    this._ws = ws;
  }

  hasWs(): boolean {
    return !!this._ws;
  }

  /**
   * Get the currently active (last-used) tab ID
   * Note: With multi-tab support, this only tracks the most recently used tab
   */
  get activeTabId(): number | null {
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
  async ensureAttached(options?: {
    tabId?: number;
    label?: string;
    autoOpenUrl?: string;
  }): Promise<{ tabId: number; label: string }> {
    // Send message to extension to ensure attachment
    const result = await this.sendSocketMessage("browser_ensure_attached", {
      tabId: options?.tabId ?? null,
      label: options?.label ?? null,
      autoOpenUrl: options?.autoOpenUrl ?? null,
    });

    // Update our cached active tab ID (for backwards compatibility)
    this._activeTabId = result.tabId;

    return result;
  }

  async sendSocketMessage<T extends MessageType<SocketMessageMap>>(
    type: T,
    payload: MessagePayload<SocketMessageMap, T>,
    options: { timeoutMs?: number } = { timeoutMs: 30000 },
  ) {
    const { sendSocketMessage } = createSocketMessageSender<SocketMessageMap>(
      this.ws,
    );
    try {
      return await sendSocketMessage(type, payload, options);
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
}
