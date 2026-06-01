import { spawn, type ChildProcess } from "child_process";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { LaunchIsolatedChromeTool } from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";
import type { Tool } from "./tool";

// __dirname is not defined in ESM bundles; recompute it from the module URL.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

      // Resolve the extension directory. In dev mode, src/tools/ lives two
      // levels under repo root; in the production bundle, __dirname is /app/dist
      // and extension/ sits next to it at /app/extension. Probe both layouts
      // (and an absolute /app fallback for safety) and pick the first that
      // contains a manifest.json.
      const candidates = [
        path.resolve(__dirname, "..", "extension"),         // /app/extension when run from /app/dist
        path.resolve(__dirname, "..", "..", "extension"),   // <repo>/extension when run from <repo>/src/tools
        "/app/extension",
      ];
      let extensionDir: string | null = null;
      for (const c of candidates) {
        try {
          if (fs.existsSync(path.join(c, "manifest.json"))) { extensionDir = c; break; }
        } catch { /* ignore */ }
      }
      if (!extensionDir) {
        return errorResponse(
          `Extension directory not found (searched: ${candidates.join(", ")})`, false
        );
      }
      // Profiles live next to the extension dir for portability
      const profilesDir = path.join(path.dirname(extensionDir), ".chrome-profiles");

      // Create profiles directory if it doesn't exist
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true }, max_tokens);
      }

      // Set up profile directory
      const profileName = validatedParams.profileName || "unibrowse-test";
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

      // Detect "we're running inside a container" and add the flags Chrome
      // needs to survive there. The big two:
      //   --no-sandbox: container kernel namespacing collides with Chrome's
      //                 own sandbox; without this the renderer exits at start.
      //   --disable-dev-shm-usage: default /dev/shm in docker is 64MB; Chrome
      //                 mmap's much more and falls over. Use /tmp instead.
      const inContainer = fs.existsSync("/.dockerenv") || process.env.UNIBROWSE_FORCE_CHROME_NOSANDBOX === "1";
      if (inContainer) {
        chromeArgs.push("--no-sandbox", "--disable-dev-shm-usage");
      }

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
