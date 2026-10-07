// container/facts — what `container` and the disk it clones on say,
// gathered at startup and for each lane.

import { lstat, mkdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ProjectRecord, SnapshotId } from "@pinetrie/core"
import {
  type ContainerFacts,
  pinetrieDir,
  planRoot,
  prepareProjectDir,
  run,
  SPEC_LABEL,
} from "@pinetrie/lanes"
import {
  type ContainerHostFacts,
  type DiskPaths,
  parseInspect,
  planContainerHost,
  snapshotFile,
} from "./plan.ts"

/** `container`'s own directory, from its status; null when it is not running. */
async function appRoot(): Promise<string | null> {
  const status = await run("container", [
    "system",
    "status",
    "--format",
    "json",
  ])
  if (!status.ok) return null
  try {
    const parsed = JSON.parse(status.stdout) as {
      status?: unknown
      paths?: { appRoot?: unknown }
    }
    return parsed.status === "running" &&
      typeof parsed.paths?.appRoot === "string"
      ? parsed.paths.appRoot
      : null
  } catch {
    return null
  }
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/**
 * Whether a clone into `dir` shares blocks: `/bin/cp -c` of a small file
 * fails across APFS volumes, where it cannot clone.
 */
async function probeClone(dir: string, near: string): Promise<boolean> {
  await mkdir(dir, { recursive: true })
  const a = path.join(near, ".pinetrie-clone-probe")
  const b = path.join(dir, ".clone-probe")
  try {
    await writeFile(a, "probe")
    return (await run("/bin/cp", ["-c", a, b])).ok
  } catch {
    return false
  } finally {
    await rm(a, { force: true })
    await rm(b, { force: true })
  }
}

/** Where lanes' disks and snapshots are, once `container` is known. */
const diskPaths = (app: string, root: string): DiskPaths => ({
  volumes: path.join(app, "volumes"),
  snapshots: pinetrieDir(root).snapshots,
})

/**
 * The project in `dir`, and where lanes' disks are when they can have their
 * own under `container`. Any step that fails makes the project `direct`,
 * naming the first failure.
 */
export async function prepareContainerHost(dir: string): Promise<{
  readonly project: ProjectRecord
  readonly paths: DiskPaths | null
}> {
  const root = planRoot(await prepareProjectDir(dir), dir)
  const installed = (await run("container", ["--version"])).ok
  const app = installed ? await appRoot() : null
  const facts: ContainerHostFacts = {
    root,
    installed,
    running: app !== null,
    kernel:
      app !== null &&
      (await lstat(path.join(app, "kernels", "default.kernel-arm64")).then(
        () => true,
        () => false,
      )),
    clones:
      app !== null &&
      "ok" in root &&
      (await exists(path.join(app, "volumes"))) &&
      (await probeClone(
        diskPaths(app, root.ok).snapshots,
        path.join(app, "volumes"),
      )),
  }
  const project = planContainerHost(facts)
  if (project.kind === "direct" || app === null) return { project, paths: null }
  return { project, paths: diskPaths(app, project.root) }
}

/** A container's state and spec label; missing when it is not there. */
export async function containerFacts(
  container: string,
): Promise<ContainerFacts> {
  const ran = await run("container", ["inspect", container])
  return ran.ok
    ? parseInspect(ran.stdout, SPEC_LABEL)
    : { state: "missing", label: null }
}

/** Whether a `container` volume exists. */
export const volumeExists = async (volume: string): Promise<boolean> =>
  (await run("container", ["volume", "inspect", volume])).ok

export const snapshotExists = (
  paths: DiskPaths,
  id: SnapshotId,
): Promise<boolean> => exists(snapshotFile(paths, id))
