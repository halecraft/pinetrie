// e2e/lane-runtime — the suites' runtime, Docker (ADR-0103): its CLI, and a
// lane's container and disks read and removed as the runtime keeps them. The
// lane VM's Docker on the Mac, the host's on Linux, and a nested lane's
// rootless one inside a lane.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { SnapshotId, ThreadId } from "@pinetrie/core"
import {
  DISKS_CONTAINER,
  NESTED_MOUNT,
  projectDisks,
  projectKey,
  ROOTLESS_UID,
} from "@pinetrie/docker"
import { vmStateDir } from "@pinetrie/vm"
import { planRuntime } from "../host/work/runtime.ts"

export const container = (lane: ThreadId) => `pinetrie-${lane}`

/** The docker CLI, against the lane VM's socket on the Mac. */
export function runtimeCli(): readonly string[] {
  const host =
    process.platform === "darwin"
      ? `unix://${path.join(vmStateDir(process.env, homedir()), "docker.sock")}`
      : (process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock")
  return ["docker", "-H", host]
}

/** The runtime's CLI with `args`; throws on failure. */
export function cli(args: readonly string[], input?: string): string {
  const [program = "docker", ...rest] = runtimeCli()
  return execFileSync(program, [...rest, ...args], {
    stdio: "pipe",
    ...(input === undefined ? {} : { input }),
  }).toString()
}

/** `cli`, with a failure as its output. */
function quietly(args: readonly string[]): string {
  try {
    return cli(args)
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer }
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`
  }
}

export const isRunning = (name: string): boolean =>
  quietly(["inspect", "-f", "{{.State.Running}}", name]).trim() === "true"

export const containerExists = (name: string): boolean =>
  /^[0-9a-f]{12,}$/.test(quietly(["inspect", "-f", "{{.Id}}", name]).trim())

/** Where a project's disks are on Docker's machine, as its host keeps them. */
export function dockerDisks(root: string) {
  const { lanesDir } = planRuntime({
    platform: process.platform,
    nestedMount: existsSync(NESTED_MOUNT),
    stateHome:
      process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  })
  return projectDisks(lanesDir, projectKey(root))
}

/** A script in Docker's disks helper, with `args`; its output, or a failure's. */
export const inDisks = (script: string, ...args: string[]): string =>
  quietly(["exec", DISKS_CONTAINER, "sh", "-c", script, "sh", ...args])

/** Whether snapshot `id` of the project at `root` is there. */
export const snapshotExists = (root: string, id: SnapshotId): boolean =>
  inDisks('stat -c %i "$1"', dockerDisks(root).snapshot(id)).trim() === "256"

export function deleteSnapshot(root: string, id: SnapshotId): void {
  inDisks('btrfs -q subvolume delete "$1"', dockerDisks(root).snapshot(id))
}

/** Remove a lane's container and its disk. */
export function removeLane(root: string, lane: ThreadId): void {
  quietly(["rm", "-f", container(lane)])
  const disks = dockerDisks(root)
  inDisks(
    'for d in "$@"; do [ ! -e "$d" ] || btrfs -q subvolume delete "$d" 2>/dev/null || rm -rf "$d"; done',
    disks.lane(lane),
    disks.nested(lane),
  )
}

/**
 * Whose a lane's writes in a shared directory are: the person's, the host's
 * own user; in a lane granted lanes of its own, the rootless user's, whose
 * root an inner lane's is, and whom the suites hand shared directories to.
 */
export const lanesWriteAs = (): number | undefined =>
  existsSync(NESTED_MOUNT) ? ROOTLESS_UID : process.getuid?.()

/**
 * Inside a lane granted lanes of its own, inner lanes write as the rootless
 * user (uid 1000): a path they write (a shared directory, a probe's) becomes
 * theirs. Never a repository: git refuses one another user owns, and the
 * host, root, runs jj and git in it. Elsewhere, nothing.
 */
export function ownForInnerLanes(dir: string): void {
  if (existsSync(NESTED_MOUNT))
    execFileSync("chown", ["-R", `${ROOTLESS_UID}:${ROOTLESS_UID}`, dir])
}
