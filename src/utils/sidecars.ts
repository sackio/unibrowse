/**
 * More than one chromium-host sidecar, and how a later call finds the right one.
 *
 * ⛔ WHY TWO. The Alpine image pins Chromium 150 and CANNOT BE REBUILT (alpine
 * 3.24 no longer serves that package), while the Chrome for Testing image runs
 * 155 and honours --load-extension. A chromium version is part of the
 * automation contract — a silent 148→149 move once cost three weeks of
 * undiagnosable macro failure — so the two run SIDE BY SIDE and a launch picks
 * one, rather than one replacing the other under everybody's profiles.
 * Ben, #unibrowse 2026-10-23: "make versions for both".
 *
 * ⛔ AND WHY ROUTING IS DERIVED, NOT REMEMBERED. `browser_close_isolated_chrome`
 * and every human-input call arrive with an extensionId and no idea which
 * sidecar spawned it, and mcp-server restarts while those browsers keep running
 * — its lifecycle is not theirs. So an in-memory map of extensionId → sidecar
 * would be empty exactly when it mattered, and the symptom would be a close
 * that reports success having closed nothing. Each sidecar already publishes
 * its own live processes, so we ASK.
 */
export type Sidecar = { name: string; url: string };

const trim = (u: string) => u.replace(/\/$/, "");

/**
 * Configured sidecars, in preference order. The first is the default for a
 * launch that names none, so the existing single-sidecar deployment keeps its
 * exact behaviour when only UNIBROWSE_CHROMIUM_HOST is set.
 */
export function listSidecars(): Sidecar[] {
  const out: Sidecar[] = [];
  const a = process.env.UNIBROWSE_CHROMIUM_HOST;
  const b = process.env.UNIBROWSE_CHROMIUM_HOST_CHROME;
  if (a) out.push({ name: "alpine", url: trim(a) });
  if (b) out.push({ name: "chrome", url: trim(b) });
  return out;
}

export function sidecarByName(name: string | undefined): Sidecar | null {
  const all = listSidecars();
  if (!name) return all[0] || null;
  const hit = all.find((s) => s.name === name);
  if (!hit) {
    throw new Error(
      `sidecar ${JSON.stringify(name)} is not configured. Available: ${all.map((s) => s.name).join(", ") || "none"}. ` +
      `⇒ "alpine" is UNIBROWSE_CHROMIUM_HOST (Chromium 150, pinned); "chrome" is ` +
      `UNIBROWSE_CHROMIUM_HOST_CHROME (Chrome for Testing 155).`,
    );
  }
  return hit;
}

/**
 * Which sidecar is running `extensionId` right now.
 *
 * ⚠️ Asks every configured sidecar and takes the one reporting it ALIVE. A dead
 * entry is not a match: a sidecar remembers processes it has reaped, so matching
 * on presence alone would route input at a browser that has exited and the
 * xdotool call would land on whatever now owns that display.
 */
export async function sidecarFor(extensionId: string): Promise<Sidecar> {
  const all = listSidecars();
  if (!all.length) {
    throw new Error("no chromium-host sidecar configured (UNIBROWSE_CHROMIUM_HOST unset)");
  }
  if (all.length === 1) return all[0];

  const errors: string[] = [];
  for (const s of all) {
    try {
      const resp = await fetch(`${s.url}/processes`);
      if (!resp.ok) { errors.push(`${s.name}: /processes ${resp.status}`); continue; }
      const { processes } = (await resp.json()) as any;
      if ((processes || []).some((p: any) => p.extensionId === extensionId && p.alive)) return s;
    } catch (e: any) {
      errors.push(`${s.name}: ${e.message}`);
    }
  }
  throw new Error(
    `no configured sidecar is running ${extensionId} (asked ${all.map((s) => s.name).join(", ")})` +
    (errors.length ? `; ${errors.join("; ")}` : "") +
    `. ⇒ The browser may have exited, or it belongs to a sidecar this server does not know about.`,
  );
}
