// lanehost/projects — each project's directory in the lanes directory: the
// root it records for the sweep, the listing, and its removal.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { type DiskStep, executeDiskSteps } from "./disks.ts"
import { isProjectKey, type ProjectDisks, projectDisks } from "./layout.ts"
import type { ProjectListed } from "./protocol.ts"

/** The project's root, written beside its disks, for the sweep. */
export async function recordProject(
  disks: ProjectDisks,
  root: string,
): Promise<void> {
  await mkdir(path.dirname(disks.root), { recursive: true })
  await writeFile(disks.root, root)
}

/** Every project in the lanes directory, with the root it recorded. */
export async function listProjects(
  lanesDir: string,
): Promise<readonly ProjectListed[]> {
  const keys = await readdir(path.join(lanesDir, "projects")).catch(
    () => [] as string[],
  )
  const out: ProjectListed[] = []
  for (const key of keys.sort()) {
    if (!isProjectKey(key)) continue
    const root = await readFile(projectDisks(lanesDir, key).root, "utf8").catch(
      () => null,
    )
    out.push({ key, root: root === null || root === "" ? null : root })
  }
  return out
}

/**
 * Each disk a project holds, as one drop each: its lanes, snapshots, inner
 * lanes and folder lanes' states directories, whose read-only copies a
 * plain removal cannot delete.
 */
export function planProjectRemoval(
  disks: ProjectDisks,
  held: {
    readonly lanes: readonly string[]
    readonly snapshots: readonly string[]
    readonly nested: readonly string[]
    readonly states: readonly string[]
  },
): readonly DiskStep[] {
  return [
    ...held.lanes.map(n => ({
      kind: "drop" as const,
      path: `${disks.lanes}/${n}`,
    })),
    ...held.snapshots.map(n => ({
      kind: "drop" as const,
      path: `${disks.snapshots}/${n}`,
    })),
    ...held.nested.map(n => ({
      kind: "drop" as const,
      path: `${disks.nestedDir}/${n}`,
    })),
    ...held.states.map(n => ({
      kind: "drop" as const,
      path: `${disks.statesDir}/${n}`,
    })),
  ]
}

/** A project's disks, all of them, then its directory. */
export async function removeProject(disks: ProjectDisks): Promise<void> {
  const list = (dir: string) => readdir(dir).catch(() => [] as string[])
  await executeDiskSteps(
    planProjectRemoval(disks, {
      lanes: await list(disks.lanes),
      snapshots: await list(disks.snapshots),
      nested: await list(disks.nestedDir),
      states: await list(disks.statesDir),
    }),
  )
  await rm(disks.dir, { recursive: true, force: true })
}
