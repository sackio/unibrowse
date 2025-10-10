/**
 * Response Helper Utilities
 * Standardized response formatters for MCP tool handlers
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Create a JSON response with formatted output
 * @param data - Data to stringify as JSON
 * @param pretty - Whether to pretty-print with indentation (default: true)
 * @returns MCP tool result with JSON text content
 * @example
 * return jsonResponse({ tabs: [1, 2, 3] });
 */
export function jsonResponse(data: any, pretty = true): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, pretty ? 2 : 0),
      },
    ],
  };
}

/**
 * Create a plain text response
 * @param text - Text content to return
 * @returns MCP tool result with text content
 * @example
 * return textResponse("Action completed successfully");
 */
export function textResponse(text: string): CallToolResult {
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
 * @returns MCP tool result with image content
 * @example
 * return imageResponse(screenshotBase64, "image/png");
 */
export function imageResponse(
  base64Data: string,
  mimeType = "image/png"
): CallToolResult {
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
 * @returns MCP tool result marked as error
 * @example
 * return errorResponse("Failed to click element", true, err);
 */
export function errorResponse(
  message: string,
  includeStack = false,
  error?: Error
): CallToolResult {
  let text = message;

  if (includeStack && error?.stack) {
    text += `\n\nStack trace:\n${error.stack}`;
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
 * @returns MCP tool result with success message
 * @example
 * return successResponse("Clicked button", { element: "Submit" });
 */
export function successResponse(
  action: string,
  details?: Record<string, any>
): CallToolResult {
  let text = `✓ ${action}`;

  if (details && Object.keys(details).length > 0) {
    text += `\n\nDetails:\n${JSON.stringify(details, null, 2)}`;
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
 * @returns MCP tool result with formatted list
 * @example
 * return listResponse("Open Tabs", tabs, (t) => `${t.id}: ${t.title}`);
 */
export function listResponse(
  title: string,
  items: any[],
  format?: (item: any) => string
): CallToolResult {
  const formatter = format || ((item) => JSON.stringify(item));

  let text = `${title} (${items.length}):\n\n`;

  if (items.length === 0) {
    text += "No items found.";
  } else {
    text += items.map((item, i) => `${i + 1}. ${formatter(item)}`).join("\n");
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
