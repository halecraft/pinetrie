// e2e/lane-runtime — the suites' runtime (`E2E_RUNTIME`, ADR-0103): its CLI,
// and a lane's container and disks read and removed as the runtime keeps
// them. `container`, or Docker: the lane VM's on the Mac, the host's on
// Linux.

import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { LaneName, SnapshotId } from "@pinetrie/core"
import {
  DISKS_CONTAINER,
  NESTED_MOUNT,
  projectDisks,
  projectKey,
  ROOTLESS_UID,
} from "@pinetrie/docker"
import { vmStateDir } from "@pinetrie/vm"
import { planRuntime } from "../host/work/runtime.ts"
import { E2E_RUNTIME } from "./harness.ts"

export const container = (lane: LaneName) => `pinetrie-${lane}`

/** The runtime's CLI: `container`, or docker against the lane VM's socket on the Mac. */
export function runtimeCli(): readonly string[] {
  if (E2E_RUNTIME === "container") return ["container"]
  const host =
    process.platform === "darwin"
      ? `unix://${path.join(vmStateDir(process.env, homedir()), "docker.sock")}`
      : (process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock")
  return ["docker", "-H", host]
}

/** The runtime's CLI with `args`; throws on failure. */
export function cli(args: readonly string[], input?: string): string {
  const [program = "container", ...rest] = runtimeCli()
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
  E2E_RUNTIME === "container"
    ? /"state" *: *"running"/.test(quietly(["inspect", name]))
    : quietly(["inspect", "-f", "{{.State.Running}}", name]).trim() === "true"

export const containerExists = (name: string): boolean =>
  E2E_RUNTIME === "container"
    ? quietly(["list", "-a", "--quiet"]).includes(name)
    : /^[0-9a-f]{12,}$/.test(quietly(["inspect", "-f", "{{.Id}}", name]).trim())

/** Where a project's disks are on Docker's machine, as its host keeps them. */
export function dockerDisks(root: string) {
  const planned = planRuntime({
    platform: process.platform,
    choice: "docker",
    nestedMount: existsSync(NESTED_MOUNT),
    stateHome:
      process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  })
  if (planned.kind === "container") throw new Error("not Docker")
  return projectDisks(planned.lanesDir, projectKey(root))
}

/** A script in Docker's disks helper, with `args`; its output, or a failure's. */
export const inDisks = (script: string, ...args: string[]): string =>
  quietly(["exec", DISKS_CONTAINER, "sh", "-c", script, "sh", ...args])

export const snapshotFile = (root: string, id: SnapshotId) =>
  path.join(root, ".pinetrie", "snapshots", `${id}.img`)

/** Whether snapshot `id` of the project at `root` is there. */
export const snapshotExists = (root: string, id: SnapshotId): boolean =>
  E2E_RUNTIME === "container"
    ? existsSync(snapshotFile(root, id))
    : inDisks('stat -c %i "$1"', dockerDisks(root).snapshot(id)).trim() ===
      "256"

export function deleteSnapshot(root: string, id: SnapshotId): void {
  if (E2E_RUNTIME === "container")
    rmSync(snapshotFile(root, id), { force: true })
  else inDisks('btrfs -q subvolume delete "$1"', dockerDisks(root).snapshot(id))
}

/** Remove a lane's container and its disk. */
export function removeLane(root: string, lane: LaneName): void {
  quietly(["rm", "-f", container(lane)])
  if (E2E_RUNTIME === "container") quietly(["volume", "rm", container(lane)])
  else {
    const disks = dockerDisks(root)
    inDisks(
      'for d in "$@"; do [ ! -e "$d" ] || btrfs -q subvolume delete "$d" 2>/dev/null || rm -rf "$d"; done',
      disks.lane(lane),
      disks.nested(lane),
    )
  }
}

/**
 * Inside a lane granted lanes of its own, inner lanes write as the rootless
 * user (uid 1000): the throwaway project `dir` becomes theirs, so a shared
 * directory takes their writes. The host, root, still writes everywhere.
 * Elsewhere, nothing.
 */
export function ownForInnerLanes(dir: string): void {
  if (E2E_RUNTIME === "docker" && existsSync(NESTED_MOUNT))
    execFileSync("chown", ["-R", `${ROOTLESS_UID}:${ROOTLESS_UID}`, dir])
}
