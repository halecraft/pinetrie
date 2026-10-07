// host/work/convert — pre-docker: a lane made under Apple's `container`,
// converted at its first start under Docker (ADR-0103). Its disk, from its
// volume or its newest snapshot, is read as a tar in a `container` and
// written into a new subvolume through Docker's disks helper: two host
// processes piped together, with no capability and no shared disk image.
// The one module that holds both runtimes. Delete with `@pinetrie/container`.

import { spawn } from "node:child_process"
import { type DiskPaths, openContainerDisk } from "@pinetrie/container"
import type { LaneName, SnapshotId } from "@pinetrie/core"
import type { DockerRuntime } from "@pinetrie/docker"

/** Converts a lane, given its snapshots newest first; false when it has nothing to convert. */
export type Convert = (
  lane: LaneName,
  snapshots: readonly SnapshotId[],
) => Promise<boolean>

/** `from`'s stdout into `to`'s stdin; resolves when both exit 0. */
function pipe(from: readonly string[], to: readonly string[]): Promise<void> {
  const start = (
    argv: readonly string[],
    stdio: ["ignore" | "pipe", "pipe" | "ignore", "pipe"],
  ) => spawn(argv[0] ?? "", argv.slice(1), { stdio })
  const reader = start(from, ["ignore", "pipe", "pipe"])
  const writer = start(to, ["pipe", "ignore", "pipe"])
  reader.stdout?.pipe(writer.stdin ?? process.stdout)
  const ended = (p: ReturnType<typeof spawn>, what: string) =>
    new Promise<void>((resolve, reject) => {
      let err = ""
      p.stderr?.on("data", d => {
        err += String(d)
      })
      p.once("error", reject)
      p.once("close", code =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `${what} exited ${code}: ${err.trim().split("\n")[0] ?? ""}`,
              ),
            ),
      )
    })
  return Promise.all([
    ended(reader, "reading the lane's disk"),
    ended(writer, "writing the lane's disk"),
  ]).then(() => {})
}

export function converter(input: {
  readonly paths: DiskPaths
  readonly docker: DockerRuntime
  readonly log: (line: string) => void
}): Convert {
  return async (lane, snapshots) => {
    const reader = await openContainerDisk(input.paths, lane, snapshots)
    if (reader === null) return false
    const started = Date.now()
    try {
      await input.docker.disk({ kind: "create", lane })
      await pipe(reader.argv, input.docker.importArgv(lane)).catch(
        async error => {
          await input.docker.disk({ kind: "delete", lane })
          throw error
        },
      )
    } finally {
      await reader.close()
    }
    input.log(
      `[host] ${lane}'s disk moved from container to Docker in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    )
    return true
  }
}
