import { zodToJsonSchema } from "zod-to-json-schema";

import { RequestUserActionTool } from "@/types/tool-schemas";

import type { Tool, ToolFactory } from "./tool";

export const requestUserAction: ToolFactory = (snapshot) => ({
  schema: {
    name: RequestUserActionTool.shape.name.value,
    description: RequestUserActionTool.shape.description.value,
    inputSchema: zodToJsonSchema(RequestUserActionTool.shape.arguments),
  },
  handle: async (context, params) => {
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

    let summary = `# User Action Request\n\n`;
    summary += `**Request**: ${request}\n`;
    summary += `**Status**: ${status}\n`;
    summary += `**Duration**: ${(result.duration / 1000).toFixed(1)}s\n`;
    summary += `**Start Time**: ${new Date(result.startTime).toISOString()}\n`;
    summary += `**End Time**: ${new Date(result.endTime).toISOString()}\n\n`;

    if (status === 'rejected') {
      summary += `The user rejected this request.\n`;
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

    return {
      content: [
        {
          type: "text",
          text: summary,
        },
      ],
    };
  },
});
