import { Context } from "@/context";
import { ToolResult } from "@/tools/tool";
import { textResponse } from "./response-helpers";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  tabTarget?: number | string,
  maxTokens?: number,
  interactiveOnly: boolean = true,
  maxDepth: number = 5,
): Promise<ToolResult> {
  const url = await context.sendSocketMessage("getUrl", tabTarget !== undefined ? { tabTarget } : undefined);
  const title = await context.sendSocketMessage("getTitle", tabTarget !== undefined ? { tabTarget } : undefined);
  const snapshotParams: Record<string, unknown> = { interactiveOnly, maxDepth };
  if (tabTarget !== undefined) snapshotParams.tabTarget = tabTarget;
  const snapshot = await context.sendSocketMessage("browser_snapshot", snapshotParams);
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
