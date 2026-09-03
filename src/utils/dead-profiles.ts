import * as fs from "fs";
import * as path from "path";

/**
 * Delete profile directories left behind by chrome-launcher's EBUSY
 * rename-aside path (`<name>.dead-<epoch>`).
 *
 * ⛔ ASYNC AND FIRE-AND-FORGET, AND THAT IS THE WHOLE LESSON. The first
 * version of this was a synchronous `fs.rmSync` loop. Deployed on 2026-09-03 it
 * ran at server startup over 130 NFS directories that can never be deleted
 * (root_squash — see below); each failure is slow, the loop blocked `main()`
 * before `listen()`, and mcp-server came up unhealthy and stayed there. It is
 * shared LAN-wide, so that took every seat's browser work down with it, and
 * `agents` lost its account-flip path until it was reverted.
 *
 * ⇒ Housekeeping attached to a real code path must be incapable of delaying it.
 * This never blocks, never throws, and stops at a wall-clock deadline whether
 * or not it finished. A sweep that does nothing this time is correct; a sweep
 * that holds up a launch is not.
 *
 * ⛔ MATCHES THE NAME THE RENAME WROTE, AND NOTHING ELSE. `<name>.dead-<epoch>`
 * only, and the age comes from the epoch IN THE NAME, not from mtime — mtime is
 * writable by anything that walks the tree (a backup, an audit, a `du`) and
 * would silently make a live profile look ancient.
 *
 * ⚠️ IT WILL OFTEN REAP NOTHING, AND THAT IS NOT A BUG. Two expected reasons:
 * EBUSY means the kernel still holds the sillyrenamed files that caused the
 * rename — exactly what the rename bought us, so try again later. And on an
 * NFS mount with root_squash (this fleet: /mnt/nas is nfs4 from 192.168.1.207)
 * a profile written by a different uid cannot be removed by this process at
 * all, in which case it needs real root on the host and no amount of retrying
 * here will help.
 */
export async function sweepDeadProfiles(
  profilesDir: string,
  opts: { olderThanMs?: number; maxPerSweep?: number; deadlineMs?: number } = {},
): Promise<{ reaped: number; skipped: number; gaveUp: boolean }> {
  const olderThanMs = opts.olderThanMs ?? 60 * 60 * 1000;
  const maxPerSweep = opts.maxPerSweep ?? 10;
  const deadlineMs = opts.deadlineMs ?? 2000;
  const until = Date.now() + deadlineMs;

  let reaped = 0;
  let skipped = 0;
  let gaveUp = false;
  try {
    const now = Date.now();
    const names = await fs.promises.readdir(profilesDir);
    for (const name of names) {
      if (reaped >= maxPerSweep) { gaveUp = true; break; }
      // ⛔ Checked EVERY iteration, not once. A single rm against a wedged NFS
      // handle can take seconds on its own, so a deadline tested only at the
      // top would be a deadline in name only.
      if (Date.now() > until) { gaveUp = true; break; }

      const m = /\.dead-(\d+)$/.exec(name);
      if (!m) continue;
      const stamped = Number(m[1]);
      if (!Number.isFinite(stamped) || now - stamped < olderThanMs) { skipped++; continue; }
      try {
        await fs.promises.rm(path.join(profilesDir, name), { recursive: true, force: true });
        reaped++;
      } catch {
        // Still held, or not ours to delete. Both mean: not now.
        skipped++;
      }
    }
    if (reaped) console.log(`[sweep] reaped ${reaped} dead profile(s) from ${profilesDir}`);
  } catch {
    // An unreadable profiles dir is the caller's problem to notice, not ours
    // to escalate — we are the janitor, not the door.
  }
  return { reaped, skipped, gaveUp };
}
