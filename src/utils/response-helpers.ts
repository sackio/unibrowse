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
export function estimateTokens(text: string): number {
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
  let text = JSON.stringify(data, null, pretty ? 2 : 0);

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
export function errorResponse(
  message: string,
  includeStack = false,
  error?: Error,
  maxTokens: number = DEFAULT_MAX_TOKENS
): CallToolResult {
  let text = message;

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
