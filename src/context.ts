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
   * Get the currently active tab ID (where debugger is attached)
   */
  get activeTabId(): number | null {
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
  async ensureAttached(tabId?: number): Promise<number> {
    // Send message to extension to ensure attachment
    const result = await this.sendSocketMessage("browser_ensure_attached", {
      tabId: tabId ?? null,
    });

    // Update our cached active tab ID
    this._activeTabId = result.tabId;

    return result.tabId;
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
