#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools } from "@/server";
import * as common from "@/tools/common";
import * as custom from "@/tools/custom";
import * as exploration from "@/tools/exploration";
import * as forms from "@/tools/forms";
import * as interactions from "@/tools/interactions";
import * as recording from "@/tools/recording";
import * as snapshot from "@/tools/snapshot";
import * as tabs from "@/tools/tabs";
import type { Tool } from "@/tools/tool";

import packageJSON from "../package.json";

function setupExitWatchdog(server: Server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15000);
    await server.close();
    process.exit(0);
  });
}

const commonTools: Tool[] = [
  common.pressKey,
  common.scroll,
  common.scrollToElement,
  common.wait,
];

const customTools: Tool[] = [
  custom.evaluate,
  custom.getConsoleLogs,
  custom.getNetworkLogs,
  custom.screenshot,
];

const explorationTools: Tool[] = [
  exploration.queryDOM,
  exploration.getVisibleText,
  exploration.getComputedStyles,
  exploration.checkVisibility,
  exploration.getAttributes,
  exploration.countElements,
  exploration.getPageMetadata,
  exploration.getFilteredAriaTree,
  exploration.findByText,
  exploration.getFormValues,
  exploration.checkElementState,
];

const tabTools: Tool[] = [
  tabs.listTabs,
  tabs.switchTab,
  tabs.createTab,
  tabs.closeTab,
];

const formTools: Tool[] = [
  forms.fillForm,
  forms.submitForm,
];

const recordingTools: Tool[] = [
  recording.requestDemonstration(false),
];

const interactionTools: Tool[] = [
  interactions.getInteractions,
  interactions.pruneInteractions,
  interactions.searchInteractions,
];

const snapshotTools: Tool[] = [
  common.navigate(false),
  common.goBack(false),
  common.goForward(false),
  snapshot.snapshot,
  snapshot.click,
  snapshot.drag,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  ...explorationTools,
  ...tabTools,
  ...formTools,
  ...recordingTools,
  ...interactionTools,
];

const resources: Resource[] = [];

async function createServer(): Promise<Server> {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });
}

/**
 * Note: Tools must be defined *before* calling `createServer` because only declarations are hoisted, not the initializations
 */
program
  .version("Version " + packageJSON.version)
  .name(packageJSON.name)
  .action(async () => {
    const server = await createServer();
    setupExitWatchdog(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
program.parse(process.argv);
