import { zodToJsonSchema } from "zod-to-json-schema";

import { RequestUserActionTool } from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool, ToolFactory } from "./tool";

/**
 * Request the user to perform an action in the browser
 * Shows a notification and overlay with instructions. User can complete or reject the
 * request. Captures all interactions from request to completion via the background log.
 * More flexible than requestDemonstration - use this for both learning workflows and
 * getting user assistance. Returns grouped interactions by type with timestamps and details.
 */
export const requestUserAction: ToolFactory = (snapshot) => ({
  schema: {
    name: RequestUserActionTool.shape.name.value,
    description: RequestUserActionTool.shape.description.value,
    inputSchema: zodToJsonSchema(RequestUserActionTool.shape.arguments),
  },
  handle: async (context, params) => {
    try {
      await context.ensureAttached();
      const { request, timeout } = RequestUserActionTool.shape.arguments.parse(params);

      // Calculate WebSocket timeout: use user's timeout if specified, otherwise 5 minutes default
      const wsTimeoutMs = timeout ? timeout * 1000 : 300000; // 5 minutes default

      // Send request to browser and wait for user response
      const result = await context.sendSocketMessage(
        "browser_request_user_action",
        { request },
        { timeoutMs: wsTimeoutMs }
      );

      // Format the result
      const interactions = result.interactions || [];
      const status = result.status; // 'completed', 'rejected', 'timeout'
      const feedback = result.feedback;

    let summary = `# User Action Request\n\n`;
    summary += `**Request**: ${request}\n`;
    summary += `**Status**: ${status}\n`;
    summary += `**Duration**: ${(result.duration / 1000).toFixed(1)}s\n`;
    summary += `**Start Time**: ${new Date(result.startTime).toISOString()}\n`;
    summary += `**End Time**: ${new Date(result.endTime).toISOString()}\n`;

    if (feedback) {
      summary += `**User Feedback**: ${feedback}\n`;
    }
    summary += `\n`;

    if (status === 'rejected') {
      summary += `The user rejected this request.\n`;
      if (feedback) {
        summary += `\n**Reason provided**: ${feedback}\n`;
      }
    } else if (status === 'timeout') {
      summary += `The request timed out after ${timeout || 300}s.\n`;
    } else {
      summary += `## Interactions Captured (${interactions.length})\n\n`;

      if (interactions.length === 0) {
        summary += `No interactions were captured during this period.\n`;
      } else {
        // Group interactions by type for better readability
        const grouped = interactions.reduce((acc, interaction) => {
          const type = interaction.type;
          if (!acc[type]) acc[type] = [];
          acc[type].push(interaction);
          return acc;
        }, {});

        for (const [type, items] of Object.entries(grouped)) {
          summary += `### ${type} (${items.length})\n`;
          for (const interaction of items.slice(0, 10)) { // Show first 10 of each type
            const time = new Date(interaction.timestamp).toISOString().split('T')[1].slice(0, -1);
            summary += `- **${time}** `;

            if (interaction.selector) {
              summary += `\`${interaction.selector}\` `;
            }
            if (interaction.element?.tagName) {
              summary += `<${interaction.element.tagName}> `;
            }
            if (interaction.element?.text) {
              summary += `"${interaction.element.text.slice(0, 50)}" `;
            }
            if (interaction.key) {
              summary += `Key: ${interaction.key} `;
            }
            if (interaction.value) {
              summary += `Value: "${interaction.value.slice(0, 50)}" `;
            }
            if (interaction.url) {
              summary += `URL: ${interaction.url} `;
            }
            summary += `\n`;
          }
          if (items.length > 10) {
            summary += `... and ${items.length - 10} more ${type} interactions\n`;
          }
          summary += `\n`;
          }
        }
      }

      return textResponse(summary);
    } catch (error) {
      return errorResponse(`Failed to request user action: ${error.message}`, false, error);
    }
  },
});
