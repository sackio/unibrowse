/**
 * Where a profile's stable extensionId is recorded, and how to read that
 * mapping in BOTH directions.
 *
 * ⛔ WHY THIS IS ITS OWN FILE. The forward direction (profileName →
 * extensionId) has lived in chrome-launcher since the id was made stable. The
 * reverse direction is what `browser_close_isolated_chrome` needs, and it is
 * needed in sidecars.ts — which chrome-launcher imports. Putting the reverse
 * lookup in either of those files would either duplicate the path or create an
 * import cycle, and a duplicated path is the kind of thing that rots silently:
 * the two copies disagree the first time someone moves the registry, and the
 * symptom is a close that cannot find a browser that is plainly running.
 *
 * ⚠️ The registry lives OUTSIDE profileDir on purpose. An earlier version kept
 * it at <profileDir>/.unibrowse-identity.json, which `freshProfile` deletes —
 * and freshProfile defaults to TRUE, so the id rotated on every launch.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Candidate roots, in the order the server should prefer them.
 *
 * ⛔ COMPUTED LAZILY, AND NOT FROM `__dirname`. The build emits ESM (tsup
 * --format esm, and /app/package.json is "type": "module"), where `__dirname`
 * does not exist. A `const` at module scope referencing it threw
 * `ReferenceError: __dirname is not defined in ES module scope` on IMPORT, so
 * mcp-server crash-looped on startup — it took the whole server down, not just
 * this feature, because the error fires before anything can catch it.
 * ⇒ Derive the directory from import.meta.url, inside a function, and tolerate
 * failure: a path we cannot compute must degrade to "no registry", never throw.
 */
function roots(): string[] {
  let here: string;
  try {
    here = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    here = process.cwd();
  }
  return [
    "/app/.chrome-profiles",
    path.resolve(here, "..", "..", ".chrome-profiles"),
  ];
}

export function profilesRoot(): string | null {
  try {
    return roots().find((r) => fs.existsSync(r)) ?? null;
  } catch {
    return null;
  }
}

export function identitiesDir(): string | null {
  const root = profilesRoot();
  return root ? path.join(root, ".unibrowse-identities") : null;
}

/** Profile names are caller-supplied, so flatten to a safe filename. */
export function identityFileFor(profileName: string): string | null {
  const dir = identitiesDir();
  if (!dir) return null;
  return path.join(dir, `${profileName.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

/**
 * Which profile minted `extensionId`, or null if nothing here claims it.
 *
 * ⭐ THIS IS WHAT MAKES A CLOSE SURVIVE A LATE REGISTRATION. The sidecar only
 * learns a pid's extensionId when mcp-server POSTs it to
 * /processes/<pid>/extension, and that only happens if the extension
 * registered while the launch call was still waiting. A browser whose
 * extension comes up AFTER the launch returns keeps `extensionId: null` on its
 * sidecar record for the rest of its life — so resolving a sidecar by
 * extensionId alone could never find it, and the browser leaked a Chrome and
 * an Xvfb display until someone noticed by hand.
 *
 * MEASURED 2026-10-23: 5 of 7 live browsers on the office alpine sidecar were
 * in exactly that state, and `browser_close_isolated_chrome` could not close
 * any of them. The id, however, is DERIVED FROM THE PROFILE NAME and written
 * here before the browser ever starts — so this mapping is available even when
 * the browser never registered at all.
 */
export function profileNameForExtensionId(extensionId: string): string | null {
  const dir = identitiesDir();
  if (!dir || !fs.existsSync(dir)) return null;
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (parsed?.extensionId === extensionId && parsed?.profileName) {
        return String(parsed.profileName);
      }
    } catch {
      // A corrupt entry is skipped, not fatal: one unreadable file must not
      // make every other profile unclosable.
    }
  }
  return null;
}
