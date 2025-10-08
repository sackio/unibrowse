#!/usr/bin/env node
import {
  CloseTabTool,
  CreateTabTool,
  FillFormTool,
  ListTabsTool,
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
} from "./chunk-UDEF7NOT.js";

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

// src/tools/tabs.ts
import zodToJsonSchema2 from "zod-to-json-schema";
var listTabs = {
  schema: {
    name: ListTabsTool.shape.name.value,
    description: ListTabsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(ListTabsTool.shape.arguments)
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
    inputSchema: zodToJsonSchema2(SwitchTabTool.shape.arguments)
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
    inputSchema: zodToJsonSchema2(CreateTabTool.shape.arguments)
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
    inputSchema: zodToJsonSchema2(CloseTabTool.shape.arguments)
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
  ...formTools
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
