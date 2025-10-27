import { Context } from "@/context";
import { ToolResult } from "@/tools/tool";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  tabTarget?: number | string,
): Promise<ToolResult> {
  const url = await context.sendSocketMessage("getUrl", tabTarget !== undefined ? { tabTarget } : undefined);
  const title = await context.sendSocketMessage("getTitle", tabTarget !== undefined ? { tabTarget } : undefined);
  const snapshot = await context.sendSocketMessage("browser_snapshot", tabTarget !== undefined ? { tabTarget } : undefined);
  return {
    content: [
      {
        type: "text",
        text: `${status ? `${status}\n` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot}
\`\`\`
`,
      },
    ],
  };
}
