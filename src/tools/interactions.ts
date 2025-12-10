import { zodToJsonSchema } from "zod-to-json-schema";

import {
  GetInteractionsTool,
  PruneInteractionsTool,
  SearchInteractionsTool
} from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Retrieve user interactions from the background audit log
 * Retrieves interactions that have been continuously recorded in the background while
 * connected to a tab. Supports flexible filtering by time range, interaction types,
 * URL patterns, and selector patterns. Can paginate results with offset and limit.
 * Returns formatted markdown summary of interactions with timestamps, URLs, elements, and values.
 */
export const getInteractions: Tool = {
  schema: {
    name: GetInteractionsTool.shape.name.value,
    description: GetInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetInteractionsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = GetInteractionsTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_get_interactions", validatedParams);

    const interactions = result.interactions || [];
    const totalCount = result.totalCount || 0;
    const bufferSize = result.bufferSize || 0;

    let summary = `# Interaction Log\n\n`;
    summary += `**Retrieved**: ${interactions.length} of ${totalCount} total interactions\n`;
    summary += `**Buffer size**: ${bufferSize} interactions\n`;

    if (validatedParams.startTime || validatedParams.endTime) {
      summary += `**Time range**: `;
      if (validatedParams.startTime) {
        summary += `${validatedParams.startTime < 0 ? `${validatedParams.startTime}ms ago` : new Date(validatedParams.startTime).toISOString()}`;
      }
      if (validatedParams.endTime) {
        summary += ` to ${validatedParams.endTime < 0 ? `${validatedParams.endTime}ms ago` : new Date(validatedParams.endTime).toISOString()}`;
      }
      summary += `\n`;
    }

    if (validatedParams.types && validatedParams.types.length > 0) {
      summary += `**Filtered by types**: ${validatedParams.types.join(', ')}\n`;
    }

    summary += `\n## Interactions\n\n`;

    for (const interaction of interactions) {
      const timestamp = new Date(interaction.timestamp).toISOString();
      summary += `**${interaction.type}** (${timestamp})\n`;

      if (interaction.url) {
        summary += `  - URL: ${interaction.url}\n`;
      }

      if (interaction.element) {
        summary += `  - Element: ${interaction.element.tagName}`;
        if (interaction.element.text) summary += ` "${interaction.element.text}"`;
        summary += `\n`;
        if (interaction.element.selector) {
          summary += `  - Selector: \`${interaction.element.selector}\`\n`;
        }
      }

      if (interaction.value) {
        summary += `  - Value: "${interaction.value}"\n`;
      }

      if (interaction.key) {
        summary += `  - Key: ${interaction.key}\n`;
      }

      if (interaction.x !== undefined && interaction.y !== undefined) {
        summary += `  - Position: (${interaction.x}, ${interaction.y})\n`;
      }

      summary += `\n`;
    }

      if (interactions.length === 0) {
        summary += `No interactions found matching the specified criteria.\n`;
      }

      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to get interactions: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Remove interactions from the background audit log
 * Allows selective pruning of interactions based on various criteria including time ranges,
 * counts (keep first/last N, remove oldest N), interaction types, URL patterns, and selector
 * patterns. Useful for managing log size and removing irrelevant or sensitive interaction data.
 * Returns summary of how many interactions were removed and how many remain.
 */
export const pruneInteractions: Tool = {
  schema: {
    name: PruneInteractionsTool.shape.name.value,
    description: PruneInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema(PruneInteractionsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = PruneInteractionsTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_prune_interactions", validatedParams);

    const removedCount = result.removedCount || 0;
    const remainingCount = result.remainingCount || 0;

    let summary = `# Interaction Log Pruned\n\n`;
    summary += `**Removed**: ${removedCount} interactions\n`;
    summary += `**Remaining**: ${remainingCount} interactions\n\n`;

    // Describe what was pruned
    const criteria = [];
    if (validatedParams.before) {
      criteria.push(`before ${new Date(validatedParams.before).toISOString()}`);
    }
    if (validatedParams.after) {
      criteria.push(`after ${new Date(validatedParams.after).toISOString()}`);
    }
    if (validatedParams.between) {
      criteria.push(`between ${new Date(validatedParams.between[0]).toISOString()} and ${new Date(validatedParams.between[1]).toISOString()}`);
    }
    if (validatedParams.keepLast) {
      criteria.push(`kept last ${validatedParams.keepLast} interactions`);
    }
    if (validatedParams.keepFirst) {
      criteria.push(`kept first ${validatedParams.keepFirst} interactions`);
    }
    if (validatedParams.removeOldest) {
      criteria.push(`removed oldest ${validatedParams.removeOldest} interactions`);
    }
    if (validatedParams.types) {
      criteria.push(`types: ${validatedParams.types.join(', ')}`);
    }
    if (validatedParams.excludeTypes) {
      criteria.push(`excluded types: ${validatedParams.excludeTypes.join(', ')}`);
    }
    if (validatedParams.urlPattern) {
      criteria.push(`URL pattern: ${validatedParams.urlPattern}`);
    }
    if (validatedParams.selectorPattern) {
      criteria.push(`selector pattern: ${validatedParams.selectorPattern}`);
    }

      if (criteria.length > 0) {
        summary += `**Criteria**: ${criteria.join(', ')}\n`;
      }

      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to prune interactions: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Search the background interaction log using text queries
 * Performs text search across interaction data including selectors, values, URLs, and
 * element text content. Supports filtering by time range and interaction types. Returns
 * matching interactions with highlighted matched fields. Useful for finding specific
 * interactions or understanding what actions were performed related to specific content.
 */
export const searchInteractions: Tool = {
  schema: {
    name: SearchInteractionsTool.shape.name.value,
    description: SearchInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema(SearchInteractionsTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = SearchInteractionsTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_search_interactions", validatedParams);

    const interactions = result.interactions || [];
    const totalMatches = result.totalMatches || 0;

    let summary = `# Interaction Search Results\n\n`;
    summary += `**Query**: "${validatedParams.query}"\n`;
    summary += `**Found**: ${interactions.length} of ${totalMatches} total matches\n\n`;

    if (validatedParams.types && validatedParams.types.length > 0) {
      summary += `**Filtered by types**: ${validatedParams.types.join(', ')}\n`;
    }

    summary += `## Matches\n\n`;

    for (const interaction of interactions) {
      const timestamp = new Date(interaction.timestamp).toISOString();
      summary += `**${interaction.type}** (${timestamp})\n`;

      if (interaction.url) {
        summary += `  - URL: ${interaction.url}\n`;
      }

      if (interaction.element) {
        summary += `  - Element: ${interaction.element.tagName}`;
        if (interaction.element.text) summary += ` "${interaction.element.text}"`;
        summary += `\n`;
        if (interaction.element.selector) {
          summary += `  - Selector: \`${interaction.element.selector}\`\n`;
        }
      }

      if (interaction.value) {
        summary += `  - Value: "${interaction.value}"\n`;
      }

      if (interaction.matchedField) {
        summary += `  - Matched in: ${interaction.matchedField}\n`;
      }

      summary += `\n`;
    }

      if (interactions.length === 0) {
        summary += `No interactions found matching "${validatedParams.query}".\n`;
      }

      return textResponse(summary, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(`Failed to search interactions: ${error.message}`, false, error, max_tokens);
    }
  },
};
