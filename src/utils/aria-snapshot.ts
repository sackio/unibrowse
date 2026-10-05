import { Context } from "@/context";
import { ToolResult } from "@/tools/tool";
import { textResponse } from "./response-helpers";

/**
 * Read a tab's LIVE url or title, falling back to the extension's registry.
 *
 * ⛔ NOT `getUrl` / `getTitle` as the primary source. Both handlers answer from
 * the registry — `tabInfo.url` / `tabInfo.title`, captured when the tab was
 * ATTACHED and never updated on navigation; with no `tabTarget` they return
 * `this.state.tabUrl` / `.tabTitle`, which is attach-time too
 * (extension/background.js `handleGetUrl`, `handleGetTitle`). So a tab that
 * navigated after attach produced a snapshot LABELLED WITH THE PAGE IT LEFT
 * while the snapshot body described the page it is actually on — the header and
 * the content disagreeing, with nothing to signal which one lied.
 *
 * ⚠️ SAME FAIL-TOWARD-"NOTHING IS WRONG" CLASS as the stale tab listing that
 * cost `ha` an hour before `504209c`. That fix gave `browser_list_attached_tabs`
 * its `liveUrl` and did NOT touch these two handlers, so this call site kept the
 * bug after its sibling was fixed. `src/server.ts` and `src/tools/watch.ts`
 * already evaluate `location.href` for exactly this reason; aria snapshots were
 * the last caller still trusting the registry.
 *
 * ⚠️ THE FALLBACK IS DELIBERATE, NOT DEFENSIVE CLUTTER. `browser_evaluate` is
 * refused on `chrome://` and other privileged pages, where `getUrl` still
 * answers. A snapshot that worked before must not start FAILING in order to
 * gain a fresher label — a stale label beats no snapshot. The fallback is why
 * this is safe to ship without re-testing every caller.
 *
 * ⚠️ Fixed server-side ON PURPOSE. The defect is in the extension's handlers,
 * but an extension change reaches no running browser without the ↻ on
 * chrome://extensions, and Ben has declined being asked for that again (memo
 * `98c8143f`). Routing around it here ships to every connected browser on the
 * next :9010 restart instead.
 */
async function liveOrRegistry(
  context: Context,
  expression: string,
  fallback: "getUrl" | "getTitle",
  tabTarget?: number | string,
): Promise<unknown> {
  try {
    const payload: Record<string, unknown> = { expression };
    if (tabTarget !== undefined) payload.tabTarget = tabTarget;
    const opts: Record<string, unknown> = { timeoutMs: 5000 };
    if (tabTarget !== undefined) opts.tabTarget = tabTarget;

    const res: any = await context.sendSocketMessage(
      "browser_evaluate",
      payload as any,
      opts as any,
    );
    // browser_evaluate hands back either a bare string or {result}/{value},
    // sometimes JSON-quoted — the same unwrap server.ts and watch.ts do.
    const raw = typeof res === "string" ? res : (res?.result ?? res?.value);
    if (typeof raw === "string" && raw.length > 0) {
      return raw.replace(/^"|"$/g, "");
    }
  } catch {
    // Privileged page, tab gone mid-call, or a wedged service worker. The
    // registry value is stale but present, and is strictly better than failing
    // the whole snapshot.
  }
  return await context.sendSocketMessage(
    fallback,
    tabTarget !== undefined ? { tabTarget } : undefined,
  );
}

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  tabTarget?: number | string,
  maxTokens?: number,
  interactiveOnly: boolean = true,
  maxDepth: number = 5,
): Promise<ToolResult> {
  const url = await liveOrRegistry(context, "location.href", "getUrl", tabTarget);
  const title = await liveOrRegistry(context, "document.title", "getTitle", tabTarget);
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
