import { zodToJsonSchema } from "zod-to-json-schema";

import { RequestDemonstrationTool } from "@/types/tool-schemas";

import type { Tool, ToolFactory } from "./tool";

export const requestDemonstration: ToolFactory = (snapshot) => ({
  schema: {
    name: RequestDemonstrationTool.shape.name.value,
    description: RequestDemonstrationTool.shape.description.value,
    inputSchema: zodToJsonSchema(RequestDemonstrationTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { request } = RequestDemonstrationTool.shape.arguments.parse(params);

    const result = await context.sendSocketMessage("browser_request_demonstration", {
      request
    });

    // Format the recorded demonstration for display
    const actions = result.actions || [];
    const network = result.network || [];

    let summary = `# Demonstration Recording\n\n`;
    summary += `**Request**: ${request}\n`;
    summary += `**Duration**: ${(result.duration / 1000).toFixed(1)}s\n`;
    summary += `**Start URL**: ${result.startUrl}\n`;
    summary += `**End URL**: ${result.endUrl}\n\n`;

    summary += `## Actions Recorded (${actions.length})\n\n`;
    for (const action of actions) {
      summary += `${action.step}. **${action.type}** (${action.timestamp}ms)\n`;
      if (action.element) {
        summary += `   - Element: ${action.element.tagName}`;
        if (action.element.text) summary += ` "${action.element.text}"`;
        summary += `\n   - Selector: \`${action.element.selector}\`\n`;
      }
      if (action.value) {
        summary += `   - Value: "${action.value}"\n`;
      }
      if (action.url) {
        summary += `   - URL: ${action.url}\n`;
      }
      summary += `\n`;
    }

    if (network.length > 0) {
      summary += `\n## Network Activity (${network.length} requests)\n\n`;
      for (const req of network.slice(0, 10)) {  // Limit to first 10 for readability
        summary += `- **${req.method}** ${req.url}\n`;
        if (req.response) {
          summary += `  Status: ${req.response.status}\n`;
        }
      }
      if (network.length > 10) {
        summary += `\n... and ${network.length - 10} more requests\n`;
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
