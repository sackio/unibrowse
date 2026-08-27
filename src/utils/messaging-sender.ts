import { WebSocket } from "ws";
import type { MessageType, MessagePayload } from "@/types/messaging";

const MESSAGE_RESPONSE_TYPE = "messageResponse";

interface SocketMessage<TType extends string = string, TPayload = any> {
  id: string;
  type: TType;
  payload: TPayload;
}

interface SocketMessageResponse {
  type: typeof MESSAGE_RESPONSE_TYPE;
  payload: {
    requestId: string;
    result?: any;
    error?: string;
  };
}

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
}

function addSocketMessageResponseListener(
  ws: WebSocket,
  typeListener: (message: SocketMessageResponse) => void | Promise<void>
): () => void {
  const listener = async (event: any) => {
    const message = JSON.parse(event.data.toString());
    if (message.type !== MESSAGE_RESPONSE_TYPE) {
      return;
    }
    await typeListener(message);
  };
  ws.addEventListener("message", listener);
  return () => ws.removeEventListener("message", listener);
}

export function createSocketMessageSender<TMessageMap>(ws: WebSocket) {
  async function sendSocketMessage<T extends MessageType<TMessageMap>>(
    type: T,
    payload: MessagePayload<TMessageMap, T>,
    options: { timeoutMs?: number } = { timeoutMs: 30000 }
  ): Promise<any> {
    const { timeoutMs } = options;
    const id = generateId();
    const message: SocketMessage<T> = { id, type, payload };

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        removeSocketMessageResponseListener();
        ws.removeEventListener("error", errorHandler);
        ws.removeEventListener("close", cleanup);
        if (timeoutId) clearTimeout(timeoutId);
      };

      let timeoutId: NodeJS.Timeout | undefined;
      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(
            new Error(`WebSocket response timeout after ${timeoutMs}ms`)
          );
        }, timeoutMs);
      }

      const removeSocketMessageResponseListener =
        addSocketMessageResponseListener(
          ws,
          (responseMessage: SocketMessageResponse) => {
            const { payload: responsePayload } = responseMessage;
            if (responsePayload.requestId !== id) {
              return;
            }
            const { result, error } = responsePayload;
            // ⛔ PRESENCE, not truthiness. `if (error)` treated an empty or
            // undefined error string as SUCCESS and resolved with `result`,
            // which in a failure is also undefined — so a failed call came
            // back as a silent success carrying nothing. That is how a
            // create-tab failure reached callers as an empty message they
            // could not distinguish from a permission refusal or a dead
            // browser (2026-08-27, agents + shopping).
            //
            // The extension now sends a described error for every failure
            // (extension/error-detail.js), but this branch must not depend on
            // that: an older extension build is still out there, and one that
            // sends `error: ""` must not be read as having succeeded.
            if (error !== undefined && error !== null) {
              const text =
                typeof error === "string" && error.trim().length > 0
                  ? error
                  : `${type} failed, but the extension reported no error detail ` +
                    `(received ${JSON.stringify(error)}). This usually means the throw was ` +
                    `not an Error object. If this browser is running an extension build ` +
                    `older than 2026-08-27, reload it to get described errors.`;
              reject(new Error(text));
            } else {
              resolve(result);
            }
            cleanup();
          }
        );

      const errorHandler = (_event: any) => {
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
