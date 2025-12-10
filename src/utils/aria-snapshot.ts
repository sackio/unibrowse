import { Context } from "@/context";
import { ToolResult } from "@/tools/tool";
import { textResponse } from "./response-helpers";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  tabTarget?: number | string,
  maxTokens?: number,
): Promise<ToolResult> {
  const url = await context.sendSocketMessage("getUrl", tabTarget !== undefined ? { tabTarget } : undefined);
  const title = await context.sendSocketMessage("getTitle", tabTarget !== undefined ? { tabTarget } : undefined);
  const snapshot = await context.sendSocketMessage("browser_snapshot", tabTarget !== undefined ? { tabTarget } : undefined);
  return textResponse(
    `${status ? `${status}\n` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot}
\`\`\`
`,
    maxTokens
  );
}
