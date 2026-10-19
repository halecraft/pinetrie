// vm/prune — after a build, removing what no longer serves: older images,
// launchers, builders and pins, and what a dead process left half-written.
// Whatever a running launcher names in its arguments stays, from any state
// directory (`planPrune`).

import { execFile } from "node:child_process"
import { readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { isAlive, readBuilderPins, readImageSources } from "./build.ts"
import { gvproxyPath, readGvproxyPin } from "./gvproxy.ts"
import { imageKey, type PruneEntry, planPrune } from "./plan.ts"
import { BUILDER, gatherBinary, LAUNCHER } from "./swift.ts"

const OWNED = /\.(?:tmp|old)-(\d+)$/

async function gatherEntries(stateDir: string): Promise<readonly PruneEntry[]> {
  const entries: PruneEntry[] = []
  for (const d of ["images", "bin", "builder"]) {
    const dir = path.join(stateDir, d)
    for (const name of await readdir(dir).catch(() => [])) {
      const p = path.join(dir, name)
      const owned = OWNED.exec(name)?.[1]
      const locked = name.endsWith(".lock")
        ? Number.parseInt(await readFile(p, "utf8").catch(() => ""), 10)
        : Number.NaN
      const owner =
        owned !== undefined
          ? Number(owned)
          : Number.isNaN(locked)
            ? null
            : locked
      entries.push({ path: p, owner })
    }
  }
  return entries
}

/**
 * The command lines of every running launcher, whatever its state
 * directory; null when `ps` cannot say. Read by the prune, and for a
 * launcher that does not answer `status` (`gatherRunningVm`).
 */
export const runningLaunchers = (): Promise<readonly string[] | null> =>
  new Promise(resolve =>
    execFile("ps", ["-axo", "command"], (error, stdout) =>
      resolve(
        error === null
          ? stdout.split("\n").filter(l => /\/launcher-[0-9a-f]+ /.test(l))
          : null,
      ),
    ),
  )

/** The names of what the current sources use. */
async function currentNames(stateDir: string): Promise<ReadonlySet<string>> {
  const [sources, pins, gvproxy, launcher, builder] = await Promise.all([
    readImageSources(),
    readBuilderPins(),
    readGvproxyPin(),
    gatherBinary(stateDir, LAUNCHER),
    gatherBinary(stateDir, BUILDER),
  ])
  return new Set([
    imageKey(sources),
    path.basename(launcher.binary),
    path.basename(builder.binary),
    path.basename(gvproxyPath(stateDir, gvproxy)),
    path.basename(pins.kernel.url),
    path.basename(pins.root.url),
    `Image-${pins.kernel.sha256.slice(0, 16)}`,
  ])
}

/**
 * Remove what `planPrune` finds no longer serves, and return it. Without
 * `ps`'s list of running launchers nothing is removed: an image one runs
 * from would go with the rest.
 */
export async function pruneVmState(
  stateDir: string,
): Promise<readonly string[]> {
  const [entries, current, running] = await Promise.all([
    gatherEntries(stateDir),
    currentNames(stateDir),
    runningLaunchers(),
  ])
  if (running === null) return []
  const removed = planPrune({ entries, current, running, alive: isAlive })
  for (const p of removed) await rm(p, { recursive: true, force: true })
  return removed
}
