#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools } from "@/server";
import * as bookmarks from "@/tools/bookmarks";
import * as clipboard from "@/tools/clipboard";
import * as common from "@/tools/common";
import * as cookies from "@/tools/cookies";
import * as custom from "@/tools/custom";
import * as downloads from "@/tools/downloads";
import * as extensions from "@/tools/extensions";
import * as exploration from "@/tools/exploration";
import * as forms from "@/tools/forms";
import * as history from "@/tools/history";
import * as interactions from "@/tools/interactions";
import * as network from "@/tools/network";
import * as snapshot from "@/tools/snapshot";
import * as system from "@/tools/system";
import * as tabs from "@/tools/tabs";
import * as userAction from "@/tools/user-action";
import * as macros from "@/tools/macros";
import * as realisticInput from "@/tools/realistic-input";
import * as multiTabManagement from "@/tools/multi-tab-management";
import * as chromeLauncher from "@/tools/chrome-launcher";
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
  tabs.createWindow,
];

const formTools: Tool[] = [
  forms.fillForm,
  forms.submitForm,
];

const recordingTools: Tool[] = [
  userAction.requestUserAction(false),
];

const interactionTools: Tool[] = [
  interactions.getInteractions,
  interactions.pruneInteractions,
  interactions.searchInteractions,
];

const cookieTools: Tool[] = [
  cookies.getCookies,
  cookies.setCookie,
  cookies.deleteCookie,
  cookies.clearCookies,
];

const downloadTools: Tool[] = [
  downloads.downloadFile,
  downloads.getDownloads,
  downloads.cancelDownload,
  downloads.openDownload,
];

const clipboardTools: Tool[] = [
  clipboard.getClipboard,
  clipboard.setClipboard,
];

const historyTools: Tool[] = [
  history.searchHistory,
  history.getHistoryVisits,
  history.deleteHistory,
  history.clearHistory,
];

const systemTools: Tool[] = [
  system.getVersion,
  system.getSystemInfo,
  system.getBrowserInfo,
  chromeLauncher.launchIsolatedChrome,
];

const networkTools: Tool[] = [
  network.getNetworkState,
  network.setNetworkConditions,
  network.clearCache,
];

const bookmarkTools: Tool[] = [
  bookmarks.getBookmarks,
  bookmarks.createBookmark,
  bookmarks.deleteBookmark,
  bookmarks.searchBookmarks,
];

const extensionTools: Tool[] = [
  extensions.listExtensions,
  extensions.getExtensionInfo,
  extensions.enableExtension,
  extensions.disableExtension,
];

const macroTools: Tool[] = [
  macros.storeMacro,
  macros.listMacros,
  macros.executeMacro,
  macros.updateMacro,
  macros.deleteMacro,
];

const realisticInputTools: Tool[] = [
  realisticInput.realisticMouseMove,
  realisticInput.realisticClick,
  realisticInput.realisticType,
];

const multiTabTools: Tool[] = [
  multiTabManagement.listAttachedTabs,
  multiTabManagement.setTabLabel,
  multiTabManagement.detachTab,
  multiTabManagement.getActiveTab,
  multiTabManagement.attachTab,
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
  ...cookieTools,
  ...downloadTools,
  ...clipboardTools,
  ...historyTools,
  ...systemTools,
  ...networkTools,
  ...bookmarkTools,
  ...extensionTools,
  ...macroTools,
  ...realisticInputTools,
  ...multiTabTools,
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
