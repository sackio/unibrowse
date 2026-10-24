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
import { profileNameForExtensionId } from "./profile-identity.ts";

export type Sidecar = {
  name: string;
  url: string;
  /**
   * Where the browsers THIS sidecar launches should dial back to, as a ws(s)
   * URL. Optional, and absent means the deployment-wide
   * UNIBROWSE_CHROMIUM_SERVER_HINT (default `ws://mcp-server:9010/ws`).
   *
   * ⛔ IT CANNOT BE ONE GLOBAL VALUE, and that is what broke the k8s sidecar.
   * The default is a docker-compose SERVICE NAME, resolvable only on
   * `unibrowse_unibrowse-network`. mcp-server puts that hint in the
   * `/__unibrowse_seed` URL it hands the sidecar, and the seed page is the ONLY
   * way a freshly-launched browser learns where its server is — `config.js` in
   * the extension is the unbaked source default (office's sidecars bind-mount
   * the very same file and work fine BECAUSE of the seed, which is why an
   * unbaked config.js is not the fault it looks like).
   * ⇒ A pod on the barn cluster was handed `http://mcp-server:9010/...`, could
   * not resolve it, got no config, and fell back to `ws://localhost:9010/ws`
   * INSIDE THE POD — nothing there. The browser came up, the extension loaded,
   * and it never registered: alive, healthy-looking, undriveable.
   * MEASURED 2026-10-24: zero extensions connected from any cluster IP across
   * 480s, while `cluster` measured a WebSocket upgrade from inside that pod to
   * ws://192.168.1.199:9010/ws returning 101. Reachable, and never dialed.
   */
  serverHint?: string;
};

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

  // ⭐ ADDITIONAL SIDECARS, named by the deployment rather than by this file.
  // Two hardcoded names could not express a third location at all — a sidecar
  // running in the barn k8s cluster had no way to be addressed, and the only
  // workarounds were a code change or re-pointing one of the two env vars.
  // ⛔ That second one is a trap worth naming: UNIBROWSE_CHROMIUM_HOST_CHROME is
  // the shared "chrome" slot, so re-pointing it silently moves EVERY seat's
  // Chrome-155 launches somewhere else.
  //
  //   UNIBROWSE_SIDECARS='[{"name":"k8s","url":"http://unibrowse-sidecar.unibrowse:9020",
  //                          "serverHint":"ws://192.168.1.199:9010/ws"}]'
  //
  // ⚠️ Appended, never prepended: the FIRST entry is the default for a launch
  // that names none, so putting these ahead of the env-var pair would silently
  // redirect every existing unnamed caller.
  const extra = process.env.UNIBROWSE_SIDECARS;
  if (extra) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extra);
    } catch (e: any) {
      // ⛔ Loud, not ignored. A typo here would otherwise present as "that
      // sidecar is not configured" from somewhere far away, and the operator
      // would go looking at the cluster instead of at the variable.
      throw new Error(
        `UNIBROWSE_SIDECARS is not valid JSON (${e.message}). Expected ` +
        `[{"name":"k8s","url":"http://host:9020"}].`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`UNIBROWSE_SIDECARS must be a JSON array, got ${typeof parsed}.`);
    }
    for (const row of parsed) {
      const name = String((row as any)?.name ?? "").trim();
      const url = String((row as any)?.url ?? "").trim();
      if (!name || !url) {
        throw new Error(`UNIBROWSE_SIDECARS entries need both name and url: ${JSON.stringify(row)}`);
      }
      if (!/^https?:\/\//.test(url)) {
        throw new Error(`UNIBROWSE_SIDECARS url must be http(s): ${JSON.stringify(url)}`);
      }
      // ⚠️ Validated here rather than at use. A bad hint does not fail the
      // launch — the browser starts, loads a seed page that is not there, and
      // silently never registers. That is the exact failure this field exists
      // to fix, so it must not be reachable through a typo in the variable.
      const serverHint = String((row as any)?.serverHint ?? "").trim();
      if (serverHint && !/^wss?:\/\/[^/]+\/ws$/.test(serverHint)) {
        throw new Error(
          `UNIBROWSE_SIDECARS serverHint must be a ws(s)://host:port/ws URL: ${JSON.stringify(serverHint)}. ` +
          `⇒ It is what the sidecar's browsers dial back on, and mcp-server derives the ` +
          `/__unibrowse_seed base from it by swapping ws→http and dropping /ws.`,
        );
      }
      if (out.some((s) => s.name === name)) {
        // Shadowing "alpine" or "chrome" would make the same name mean two
        // different machines depending on which lookup ran.
        throw new Error(`UNIBROWSE_SIDECARS name ${JSON.stringify(name)} is already taken.`);
      }
      out.push(serverHint ? { name, url: trim(url), serverHint } : { name, url: trim(url) });
    }
  }
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
  const seen: Array<{ sidecar: string; processes: any[] }> = [];
  for (const s of all) {
    try {
      const resp = await fetch(`${s.url}/processes`);
      if (!resp.ok) { errors.push(`${s.name}: /processes ${resp.status}`); continue; }
      const { processes } = (await resp.json()) as any;
      seen.push({ sidecar: s.name, processes: processes || [] });
      if ((processes || []).some((p: any) => p.extensionId === extensionId && p.alive)) return s;
    } catch (e: any) {
      errors.push(`${s.name}: ${e.message}`);
    }
  }

  // ⭐ FALL BACK TO THE PROFILE NAME, because a sidecar often does not know the
  // extensionId at all. It learns one only when mcp-server POSTs
  // /processes/<pid>/extension, and that happens only if the extension
  // registered while the launch call was still waiting. A browser that
  // registers AFTER the launch returns keeps `extensionId: null` for the rest
  // of its life — and resolving by extensionId alone then fails forever, so
  // the browser could never be closed and leaked a Chrome plus an Xvfb
  // display. MEASURED 2026-10-23: 5 of 7 live browsers on the office alpine
  // sidecar were in that state and none of them was closable.
  //
  // The id is DERIVED FROM THE PROFILE NAME and written to the identity
  // registry before the browser starts, so this mapping exists even for a
  // browser that never registered.
  const profileName = profileNameForExtensionId(extensionId);
  if (profileName) {
    for (const { sidecar, processes } of seen) {
      if (processes.some((p: any) => p.profileName === profileName && p.alive)) {
        const hit = all.find((s) => s.name === sidecar);
        if (hit) return hit;
      }
    }
  }

  throw new Error(
    `no configured sidecar is running ${extensionId} (asked ${all.map((s) => s.name).join(", ")})` +
    (profileName
      ? `; it belongs to profile ${JSON.stringify(profileName)}, and no sidecar reports a live process for that either`
      : `; no identity file claims that extensionId, so it was not minted by this server`) +
    (errors.length ? `; ${errors.join("; ")}` : "") +
    `. ⇒ The browser may have exited, or it belongs to a sidecar this server does not know about.`,
  );
}
