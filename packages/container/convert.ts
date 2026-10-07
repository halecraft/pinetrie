// container/convert — pre-docker: a lane's disk read out of `container`, as a
// tar, for its first start under Docker (ADR-0103). Delete with the package.

import type { LaneName, SnapshotId } from "@pinetrie/core"
import { describeFailure, run } from "@pinetrie/lanes"
import { runDisk } from "./cli.ts"
import { snapshotExists, volumeExists } from "./facts.ts"
import { type DiskPaths, laneVolume } from "./plan.ts"

/** GNU tar, which keeps everything a lane's disk holds. */
const READER_IMAGE = "docker.io/library/debian:trixie-slim"

const readerName = (lane: LaneName) => `pinetrie-pre-docker-${lane}`

/** A lane's disk under `container`, open for reading. */
export interface DiskReader {
  /** A host command whose stdout is the disk as a tar. */
  readonly argv: readonly string[]
  /** Remove the reader; the volume stays. */
  close(): Promise<void>
}

/**
 * Open `lane`'s disk under `container`: its volume, or else the newest of
 * `snapshots` (newest first) whose file is there, restored into a volume.
 * Null when it has neither.
 */
export async function openContainerDisk(
  paths: DiskPaths,
  lane: LaneName,
  snapshots: readonly SnapshotId[],
): Promise<DiskReader | null> {
  const volume = laneVolume(lane)
  if (!(await volumeExists(volume))) {
    let from: SnapshotId | null = null
    for (const id of snapshots)
      if (await snapshotExists(paths, id)) {
        from = id
        break
      }
    if (from === null) return null
    await runDisk({ kind: "restore", lane, from }, paths)
  }
  const name = readerName(lane)
  await run("container", ["rm", "-f", name])
  const started = await run("container", [
    "run",
    "-d",
    "--name",
    name,
    "-v",
    `${volume}:/workspace`,
    READER_IMAGE,
    "sleep",
    "infinity",
  ])
  if (!started.ok)
    throw new Error(describeFailure("container run (pre-docker)", started))
  return {
    argv: [
      "container",
      "exec",
      name,
      "tar",
      "-C",
      "/workspace",
      "-cf",
      "-",
      ".",
    ],
    async close() {
      await run("container", ["rm", "-f", name])
    },
  }
}
