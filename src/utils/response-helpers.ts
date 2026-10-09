/**
 * Response Helper Utilities
 * Standardized response formatters for MCP tool handlers
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Tiktoken, encodingForModel } from "js-tiktoken";

/**
 * Default maximum tokens for MCP tool responses
 * Reads from MAX_MCP_OUTPUT_TOKENS environment variable if set
 * Falls back to 25,000 tokens (Claude Code's default limit)
 * @see https://github.com/anthropics/claude-code/issues/9152
 */
export const DEFAULT_MAX_TOKENS = process.env.MAX_MCP_OUTPUT_TOKENS
  ? parseInt(process.env.MAX_MCP_OUTPUT_TOKENS, 10)
  : 25000;

/**
 * Token encoder singleton for Claude models
 */
let tokenEncoder: Tiktoken | null = null;

/**
 * Get or initialize the token encoder
 * Uses cl100k_base encoding (used by Claude models)
 */
function getTokenEncoder(): Tiktoken {
  if (!tokenEncoder) {
    tokenEncoder = encodingForModel("gpt-4"); // cl100k_base encoding
  }
  return tokenEncoder;
}

/**
 * Estimate token count for a string
 * @param text - Text to count tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string | undefined | null): number {
  if (text == null) return 0;
  try {
    const encoder = getTokenEncoder();
    return encoder.encode(text).length;
  } catch (error) {
    // Fallback to rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * Truncate text to fit within token limit
 * @param text - Text to truncate
 * @param maxTokens - Maximum number of tokens
 * @returns Truncated text with truncation notice if truncated
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);

  if (currentTokens <= maxTokens) {
    return text;
  }

  // Binary search to find the right truncation point
  let left = 0;
  let right = text.length;
  let bestLength = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const truncated = text.substring(0, mid);
    const tokens = estimateTokens(truncated);

    if (tokens <= maxTokens - 100) { // Reserve ~100 tokens for truncation notice
      bestLength = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  const truncated = text.substring(0, bestLength);
  const truncationNotice = `\n\n[... Response truncated: ${currentTokens} tokens → ${maxTokens} tokens limit. Original size: ${text.length} chars, truncated to: ${bestLength} chars ...]`;

  return truncated + truncationNotice;
}

/**
 * Create a JSON response with formatted output
 * @param data - Data to stringify as JSON
 * @param pretty - Whether to pretty-print with indentation (default: true)
 * @param maxTokens - Optional maximum tokens for response (default: DEFAULT_MAX_TOKENS)
 * @returns MCP tool result with JSON text content
 * @example
 * return jsonResponse({ tabs: [1, 2, 3] });
 */
export function jsonResponse(
  data: any,
  pretty = true,
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  // JSON.stringify(undefined) returns undefined (not a string) — coerce to 'null'
  let text = JSON.stringify(data, null, pretty ? 2 : 0) ?? "null";

  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

/**
 * Create a plain text response
 * @param text - Text content to return
 * @param maxTokens - Optional maximum tokens for response (default: DEFAULT_MAX_TOKENS)
 * @returns MCP tool result with text content
 * @example
 * return textResponse("Action completed successfully");
 */
export function textResponse(
  text: string,
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

/**
 * Create an image response (e.g., screenshot)
 * @param base64Data - Base64-encoded image data
 * @param mimeType - MIME type of image (default: "image/png")
 * @param maxTokens - Optional maximum tokens for response (default: DEFAULT_MAX_TOKENS)
 * @returns MCP tool result with image content
 * @example
 * return imageResponse(screenshotBase64, "image/png");
 */
export function imageResponse(
  base64Data: string,
  mimeType = "image/png",
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  // Check if base64 data exceeds token limit
  if (maxTokens && maxTokens > 0) {
    const currentTokens = estimateTokens(base64Data);
    if (currentTokens > maxTokens) {
      // If image is too large, return error message instead
      const errorMsg = `[Image Response Truncated]\n\nImage size (${currentTokens} tokens) exceeds maximum allowed tokens (${maxTokens}).\n\nOriginal data size: ${base64Data.length} characters\nEstimated tokens: ${currentTokens}\nLimit: ${maxTokens} tokens\n\nConsider:\n1. Reducing screenshot area\n2. Taking screenshot of specific element instead of full page\n3. Using lower quality/resolution\n4. Increasing MAX_MCP_OUTPUT_TOKENS environment variable`;

      return {
        content: [
          {
            type: "text",
            text: errorMsg,
          },
        ],
      };
    }
  }

  return {
    content: [
      {
        type: "image",
        data: base64Data,
        mimeType,
      },
    ],
  };
}

/**
 * Create an error response
 * @param message - Error message
 * @param includeStack - Whether to include stack trace (default: false)
 * @param error - Original error object for stack trace
 * @param maxTokens - Optional maximum tokens for response (default: DEFAULT_MAX_TOKENS)
 * @returns MCP tool result marked as error
 * @example
 * return errorResponse("Failed to click element", true, err);
 */
/**
 * ── EXPLAIN THE ONE ERROR THAT NAMES A SYMPTOM AND HIDES ITS CAUSE ──────────
 *
 * Chrome raises "Cannot access a chrome-extension:// URL of different
 * extension" from chrome.debugger.attach(), and it does NOT say which
 * extension, so the message is unactionable on its own. What a caller actually
 * experiences is a sequence: a call succeeds, the next one reports the debugger
 * detached, every call after that carries this string, and finally the tab
 * disappears from the registry ("No tab found") because the reattach retries
 * gave up — so by the time anyone investigates, the evidence is gone.
 *
 * MEASURED 2026-10-09: `freelance` hit this four times on office's desktop
 * Chrome (realistic_click into a form field OK → realistic_type → "debugger
 * detached" → this string on every later call → tab gone), on the normal
 * profile AND in incognito, while the identical flow worked on a container
 * sidecar with no other extensions installed. It cost four round trips and two
 * wrong hypotheses, mine included, because nothing in any response said what to
 * look at.
 *
 * ⛔ DELIBERATELY NAMES NO CULPRIT. `extension/popup.js` rewrites this same
 * string as "likely a New Tab override or PDF viewer" — and the comment at
 * extension/background.js's attach race records that this error was ALREADY
 * once mistaken for a permanent New Tab override. A confident wrong cause is
 * worse than none: it is what stops the next person looking. This says what
 * class of thing does it and which call identifies the actual one.
 *
 * ⚠️ The extension knows the detach REASON (chrome.debugger.onDetach gives it)
 * and only console.logs it, so it reaches neither the server nor the caller.
 * Surfacing it needs an extension change, which reaches no browser without a
 * reload. This enrichment is server-side on purpose: it ships to every browser
 * on the next restart.
 */
const DIFFERENT_EXTENSION_URL =
  /Cannot access a chrome-extension:\/\/ URL of different extension/i;

function explainIfKnown(message: string): string {
  if (!DIFFERENT_EXTENSION_URL.test(message)) return message;
  return (
    message +
    "\n\n⚠️ WHAT THIS MEANS: the debugger tried to attach to a page or frame owned by a DIFFERENT " +
    "extension, and Chrome refuses that. Chrome does not say which extension, so this message alone " +
    "cannot name the cause." +
    "\n\nCOMMON CAUSE: an installed extension that injects a chrome-extension:// iframe into the page " +
    "— a password manager's inline autofill menu, a form filler, a New Tab or PDF override. These " +
    "appear on focus or on typing, which is why a click can succeed and the next call fail." +
    "\n\n⛔ THE EVIDENCE DISAPPEARS: once reattach retries give up, the tab leaves the attached-tab " +
    "registry and later calls say \"No tab found\" instead. Investigate BEFORE that." +
    "\n\nWHAT TO DO:" +
    "\n  1. browser_list_frames({tabTarget, extensionId}) on the NEXT call after the one that " +
    "succeeded — it names every frame's origin, including the chrome-extension:// one." +
    "\n  2. browser_list_extensions({extensionId}) names what is installed and could be injecting." +
    "\n  3. browser_detach_tab then browser_attach_tab is the cheap unwedge if the tab still exists." +
    "\n  4. A browser profile with no other extensions (a container sidecar) does not have this " +
    "problem. ⛔ Do NOT disable someone's extension to test this without asking them first."
  );
}

export function errorResponse(
  message: string,
  includeStack = false,
  error?: Error,
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  let text = explainIfKnown(message);

  if (includeStack && error?.stack) {
    text += `\n\nStack trace:\n${error.stack}`;
  }

  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: true,
  };
}

/**
 * Create a success response with formatted message
 * @param action - Action that was performed
 * @param details - Optional additional details
 * @param maxTokens - Optional maximum tokens for response (default: DEFAULT_MAX_TOKENS)
 * @returns MCP tool result with success message
 * @example
 * return successResponse("Clicked button", { element: "Submit" });
 */
export function successResponse(
  action: string,
  details?: Record<string, any>,
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  let text = `✓ ${action}`;

  if (details && Object.keys(details).length > 0) {
    text += `\n\nDetails:\n${JSON.stringify(details, null, 2)}`;
  }

  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

/**
 * Create a formatted list response
 * @param title - List title
 * @param items - Array of items to display
 * @param format - Formatting function for each item (default: JSON.stringify)
 * @param maxTokens - Optional maximum tokens for response (default: DEFAULT_MAX_TOKENS)
 * @returns MCP tool result with formatted list
 * @example
 * return listResponse("Open Tabs", tabs, (t) => `${t.id}: ${t.title}`);
 */
export function listResponse(
  title: string,
  items: any[],
  format?: (item: any) => string,
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  const formatter = format || ((item) => JSON.stringify(item));

  let text = `${title} (${items.length}):\n\n`;

  if (items.length === 0) {
    text += "No items found.";
  } else {
    text += items.map((item, i) => `${i + 1}. ${formatter(item)}`).join("\n");
  }

  if (maxTokens && maxTokens > 0) {
    text = truncateToTokens(text, maxTokens);
  }

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}
