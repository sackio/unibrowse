#!/usr/bin/env node
import {
  CloseTabTool,
  CreateTabTool,
  FillFormTool,
  GetInteractionsTool,
  ListTabsTool,
  PruneInteractionsTool,
  RequestDemonstrationTool,
  SearchInteractionsTool,
  SubmitFormTool,
  SwitchTabTool,
  appConfig,
  checkElementState,
  checkVisibility,
  click,
  countElements,
  createServerWithTools,
  drag,
  evaluate,
  findByText,
  getAttributes,
  getComputedStyles,
  getConsoleLogs,
  getFilteredAriaTree,
  getFormValues,
  getNetworkLogs,
  getPageMetadata,
  getVisibleText,
  goBack,
  goForward,
  hover,
  navigate,
  package_default,
  pressKey,
  queryDOM,
  screenshot,
  scroll,
  scrollToElement,
  selectOption,
  snapshot,
  type,
  wait
} from "./chunk-K3YQ5BOV.js";

// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// src/tools/forms.ts
import zodToJsonSchema from "zod-to-json-schema";
var fillForm = {
  schema: {
    name: FillFormTool.shape.name.value,
    description: FillFormTool.shape.description.value,
    inputSchema: zodToJsonSchema(FillFormTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = FillFormTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_fill_form", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Filled ${validatedParams.fields.length} form fields`
        }
      ]
    };
  }
};
var submitForm = {
  schema: {
    name: SubmitFormTool.shape.name.value,
    description: SubmitFormTool.shape.description.value,
    inputSchema: zodToJsonSchema(SubmitFormTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = SubmitFormTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_submit_form", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Submitted form "${validatedParams.element}"`
        }
      ]
    };
  }
};

// src/tools/interactions.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getInteractions = {
  schema: {
    name: GetInteractionsTool.shape.name.value,
    description: GetInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = GetInteractionsTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_get_interactions", validatedParams);
    const interactions = result.interactions || [];
    const totalCount = result.totalCount || 0;
    const bufferSize = result.bufferSize || 0;
    let summary = `# Interaction Log

`;
    summary += `**Retrieved**: ${interactions.length} of ${totalCount} total interactions
`;
    summary += `**Buffer size**: ${bufferSize} interactions
`;
    if (validatedParams.startTime || validatedParams.endTime) {
      summary += `**Time range**: `;
      if (validatedParams.startTime) {
        summary += `${validatedParams.startTime < 0 ? `${validatedParams.startTime}ms ago` : new Date(validatedParams.startTime).toISOString()}`;
      }
      if (validatedParams.endTime) {
        summary += ` to ${validatedParams.endTime < 0 ? `${validatedParams.endTime}ms ago` : new Date(validatedParams.endTime).toISOString()}`;
      }
      summary += `
`;
    }
    if (validatedParams.types && validatedParams.types.length > 0) {
      summary += `**Filtered by types**: ${validatedParams.types.join(", ")}
`;
    }
    summary += `
## Interactions

`;
    for (const interaction of interactions) {
      const timestamp = new Date(interaction.timestamp).toISOString();
      summary += `**${interaction.type}** (${timestamp})
`;
      if (interaction.url) {
        summary += `  - URL: ${interaction.url}
`;
      }
      if (interaction.element) {
        summary += `  - Element: ${interaction.element.tagName}`;
        if (interaction.element.text) summary += ` "${interaction.element.text}"`;
        summary += `
`;
        if (interaction.element.selector) {
          summary += `  - Selector: \`${interaction.element.selector}\`
`;
        }
      }
      if (interaction.value) {
        summary += `  - Value: "${interaction.value}"
`;
      }
      if (interaction.key) {
        summary += `  - Key: ${interaction.key}
`;
      }
      if (interaction.x !== void 0 && interaction.y !== void 0) {
        summary += `  - Position: (${interaction.x}, ${interaction.y})
`;
      }
      summary += `
`;
    }
    if (interactions.length === 0) {
      summary += `No interactions found matching the specified criteria.
`;
    }
    return {
      content: [
        {
          type: "text",
          text: summary
        }
      ]
    };
  }
};
var pruneInteractions = {
  schema: {
    name: PruneInteractionsTool.shape.name.value,
    description: PruneInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(PruneInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = PruneInteractionsTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_prune_interactions", validatedParams);
    const removedCount = result.removedCount || 0;
    const remainingCount = result.remainingCount || 0;
    let summary = `# Interaction Log Pruned

`;
    summary += `**Removed**: ${removedCount} interactions
`;
    summary += `**Remaining**: ${remainingCount} interactions

`;
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
      criteria.push(`types: ${validatedParams.types.join(", ")}`);
    }
    if (validatedParams.excludeTypes) {
      criteria.push(`excluded types: ${validatedParams.excludeTypes.join(", ")}`);
    }
    if (validatedParams.urlPattern) {
      criteria.push(`URL pattern: ${validatedParams.urlPattern}`);
    }
    if (validatedParams.selectorPattern) {
      criteria.push(`selector pattern: ${validatedParams.selectorPattern}`);
    }
    if (criteria.length > 0) {
      summary += `**Criteria**: ${criteria.join(", ")}
`;
    }
    return {
      content: [
        {
          type: "text",
          text: summary
        }
      ]
    };
  }
};
var searchInteractions = {
  schema: {
    name: SearchInteractionsTool.shape.name.value,
    description: SearchInteractionsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(SearchInteractionsTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = SearchInteractionsTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage("browser_search_interactions", validatedParams);
    const interactions = result.interactions || [];
    const totalMatches = result.totalMatches || 0;
    let summary = `# Interaction Search Results

`;
    summary += `**Query**: "${validatedParams.query}"
`;
    summary += `**Found**: ${interactions.length} of ${totalMatches} total matches

`;
    if (validatedParams.types && validatedParams.types.length > 0) {
      summary += `**Filtered by types**: ${validatedParams.types.join(", ")}
`;
    }
    summary += `## Matches

`;
    for (const interaction of interactions) {
      const timestamp = new Date(interaction.timestamp).toISOString();
      summary += `**${interaction.type}** (${timestamp})
`;
      if (interaction.url) {
        summary += `  - URL: ${interaction.url}
`;
      }
      if (interaction.element) {
        summary += `  - Element: ${interaction.element.tagName}`;
        if (interaction.element.text) summary += ` "${interaction.element.text}"`;
        summary += `
`;
        if (interaction.element.selector) {
          summary += `  - Selector: \`${interaction.element.selector}\`
`;
        }
      }
      if (interaction.value) {
        summary += `  - Value: "${interaction.value}"
`;
      }
      if (interaction.matchedField) {
        summary += `  - Matched in: ${interaction.matchedField}
`;
      }
      summary += `
`;
    }
    if (interactions.length === 0) {
      summary += `No interactions found matching "${validatedParams.query}".
`;
    }
    return {
      content: [
        {
          type: "text",
          text: summary
        }
      ]
    };
  }
};

// src/tools/recording.ts
import { zodToJsonSchema as zodToJsonSchema3 } from "zod-to-json-schema";
var requestDemonstration = (snapshot2) => ({
  schema: {
    name: RequestDemonstrationTool.shape.name.value,
    description: RequestDemonstrationTool.shape.description.value,
    inputSchema: zodToJsonSchema3(RequestDemonstrationTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { request, timeout } = RequestDemonstrationTool.shape.arguments.parse(params);
    const wsTimeoutMs = timeout ? timeout * 1e3 : void 0;
    const result = await context.sendSocketMessage(
      "browser_request_demonstration",
      { request },
      { timeoutMs: wsTimeoutMs }
    );
    const actions = result.actions || [];
    const network = result.network || [];
    let summary = `# Demonstration Recording

`;
    summary += `**Request**: ${request}
`;
    summary += `**Duration**: ${(result.duration / 1e3).toFixed(1)}s
`;
    summary += `**Start URL**: ${result.startUrl}
`;
    summary += `**End URL**: ${result.endUrl}

`;
    summary += `## Actions Recorded (${actions.length})

`;
    for (const action of actions) {
      summary += `${action.step}. **${action.type}** (${action.timestamp}ms)
`;
      if (action.element) {
        summary += `   - Element: ${action.element.tagName}`;
        if (action.element.text) summary += ` "${action.element.text}"`;
        summary += `
   - Selector: \`${action.element.selector}\`
`;
      }
      if (action.value) {
        summary += `   - Value: "${action.value}"
`;
      }
      if (action.url) {
        summary += `   - URL: ${action.url}
`;
      }
      summary += `
`;
    }
    if (network.length > 0) {
      summary += `
## Network Activity (${network.length} requests)

`;
      for (const req of network.slice(0, 10)) {
        summary += `- **${req.method}** ${req.url}
`;
        if (req.response) {
          summary += `  Status: ${req.response.status}
`;
        }
      }
      if (network.length > 10) {
        summary += `
... and ${network.length - 10} more requests
`;
      }
    }
    return {
      content: [
        {
          type: "text",
          text: summary
        }
      ]
    };
  }
});

// src/tools/tabs.ts
import zodToJsonSchema4 from "zod-to-json-schema";
var listTabs = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema4(ListTabsTool.shape.arguments)
  },
  handle: async (context) => {
    const tabs = await context.sendSocketMessage("browser_list_tabs", {});
    return {
      content: [
        {
          type: "text",
          text: `Open tabs:
${JSON.stringify(tabs, null, 2)}`
        }
      ]
    };
  }
};
var switchTab = {
  schema: {
    name: SwitchTabTool.shape.name.value,
    description: SwitchTabTool.shape.description.value,
    inputSchema: zodToJsonSchema4(SwitchTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = SwitchTabTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_switch_tab", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Switched to tab ${validatedParams.tabId}`
        }
      ]
    };
  }
};
var createTab = {
  schema: {
    name: CreateTabTool.shape.name.value,
    description: CreateTabTool.shape.description.value,
    inputSchema: zodToJsonSchema4(CreateTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = CreateTabTool.shape.arguments.parse(params);
    const result = await context.sendSocketMessage(
      "browser_create_tab",
      validatedParams
    );
    return {
      content: [
        {
          type: "text",
          text: `Created new tab ${result.tabId}${validatedParams.url ? ` at ${validatedParams.url}` : ""}`
        }
      ]
    };
  }
};
var closeTab = {
  schema: {
    name: CloseTabTool.shape.name.value,
    description: CloseTabTool.shape.description.value,
    inputSchema: zodToJsonSchema4(CloseTabTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = CloseTabTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_close_tab", validatedParams);
    return {
      content: [
        {
          type: "text",
          text: `Closed tab ${validatedParams.tabId}`
        }
      ]
    };
  }
};

// src/index.ts
function setupExitWatchdog(server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15e3);
    await server.close();
    process.exit(0);
  });
}
var commonTools = [
  pressKey,
  scroll,
  scrollToElement,
  wait
];
var customTools = [
  evaluate,
  getConsoleLogs,
  getNetworkLogs,
  screenshot
];
var explorationTools = [
  queryDOM,
  getVisibleText,
  getComputedStyles,
  checkVisibility,
  getAttributes,
  countElements,
  getPageMetadata,
  getFilteredAriaTree,
  findByText,
  getFormValues,
  checkElementState
];
var tabTools = [
  listTabs,
  switchTab,
  createTab,
  closeTab
];
var formTools = [
  fillForm,
  submitForm
];
var recordingTools = [
  requestDemonstration(false)
];
var interactionTools = [
  getInteractions,
  pruneInteractions,
  searchInteractions
];
var snapshotTools = [
  navigate(false),
  goBack(false),
  goForward(false),
  snapshot,
  click,
  drag,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
  ...tabTools,
  ...formTools,
  ...recordingTools,
  ...interactionTools
];
var resources = [];
async function createServer() {
  return createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
}
program.version("Version " + package_default.version).name(package_default.name).action(async () => {
  const server = await createServer();
  setupExitWatchdog(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
});
program.parse(process.argv);
