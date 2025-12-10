import { spawn, type ChildProcess } from "child_process";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as path from "path";
import * as fs from "fs";
import { LaunchIsolatedChromeTool } from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

/**
 * Track spawned Chrome processes
 */
const launchedProcesses = new Map<number, ChildProcess>();

/**
 * Find Chrome executable on the system
 */
function findChromeExecutable(): string | null {
  const possiblePaths = [
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  // Try which/where commands
  try {
    const { execSync } = require("child_process");
    const commands = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];

    for (const cmd of commands) {
      try {
        const result = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
          encoding: "utf-8",
        }).trim();
        if (result && fs.existsSync(result)) {
          return result;
        }
      } catch {
        // Continue to next command
      }
    }
  } catch {
    // Failed to find Chrome
  }

  return null;
}

/**
 * Launch Chrome in isolated mode with the Browser MCP extension
 * Creates an isolated profile separate from the user's main browser, useful for testing,
 * automation, and development. The extension will auto-connect to the MCP server.
 */
export const launchIsolatedChrome: Tool = {
  schema: {
    name: LaunchIsolatedChromeTool.shape.name.value,
    description: LaunchIsolatedChromeTool.shape.description.value,
    inputSchema: zodToJsonSchema(LaunchIsolatedChromeTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = LaunchIsolatedChromeTool.shape.arguments.parse(params);

      // Find Chrome executable
      const chromeBin = findChromeExecutable();
      if (!chromeBin) {
        return errorResponse(
          "Could not find Chrome or Chromium executable. " +
          "Please install Chrome/Chromium or set the path manually.", false
        );
      }

      // Determine project root (go up from src/tools/)
      const projectRoot = path.resolve(__dirname, "../..", max_tokens);
      const extensionDir = path.join(projectRoot, "extension");
      const profilesDir = path.join(projectRoot, ".chrome-profiles");

      // Verify extension directory exists
      if (!fs.existsSync(extensionDir)) {
        return errorResponse(
          `Extension directory not found at ${extensionDir}`, false
        );
      }

      // Create profiles directory if it doesn't exist
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true }, max_tokens);
      }

      // Set up profile directory
      const profileName = validatedParams.profileName || "browser-mcp-test";
      const profileDir = path.join(profilesDir, profileName);

      // Default to fresh profile (delete existing data)
      const freshProfile = validatedParams.freshProfile !== false;

      // Delete existing profile if freshProfile is true
      if (freshProfile && fs.existsSync(profileDir)) {
        fs.rmSync(profileDir, { recursive: true, force: true });
      }

      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // Determine URLs to open
      let urls: string[];
      if (!validatedParams.url) {
        urls = ["chrome://extensions/"];
      } else if (Array.isArray(validatedParams.url)) {
        urls = validatedParams.url;
      } else {
        urls = [validatedParams.url];
      }

      // Build Chrome launch arguments
      const chromeArgs = [
        `--user-data-dir=${profileDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-features=TranslateUI",
        "--disable-default-apps",
      ];

      // Add window dimensions if specified
      if (validatedParams.width && validatedParams.height) {
        chromeArgs.push(`--window-size=${validatedParams.width},${validatedParams.height}`);
      }

      // Add headless mode if specified
      if (validatedParams.headless) {
        chromeArgs.push("--headless=new");
        chromeArgs.push("--disable-gpu");
      }

      // Add URLs to open
      chromeArgs.push(...urls);

      // Spawn Chrome process
      const chromeProcess = spawn(chromeBin, chromeArgs, {
        detached: true,
        stdio: "ignore",
      });

      // Unref the process so it doesn't keep the Node.js process alive
      chromeProcess.unref();

      // Track the process
      if (chromeProcess.pid) {
        launchedProcesses.set(chromeProcess.pid, chromeProcess);
      }

      // Build response message
      let message = `✓ Chrome launched in isolated mode\n`;
      message += `  Profile: ${profileName} ${freshProfile ? "(fresh - no cookies/history)" : "(persistent)"}\n`;
      message += `  Profile Directory: ${profileDir}\n`;
      message += `  Extension: ${extensionDir}\n`;
      message += `  PID: ${chromeProcess.pid}\n`;
      message += `  URLs: ${urls.join(", ")}\n`;
      if (validatedParams.headless) {
        message += `  Mode: Headless\n`;
      }
      message += `\nThe extension will auto-connect to the MCP server at localhost:9010`;

      return textResponse(message, max_tokens);
    } catch (error) {
      const { max_tokens } = params || {};
      return errorResponse(
        `Failed to launch isolated Chrome: ${error.message}`, false, error
      , max_tokens);
    }
  },
};
