// e2e/lane-runtime — the suites' runtime, Docker: its CLI, and a
// lane's container and disks read and removed through lanehost, as the host
// does. The lane VM's Docker on the Mac, the host's on Linux, and
// a nested lane's rootless one inside a lane.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { SnapshotId, ThreadId } from "@pinetrie/core"
import {
  LANEHOST_LABEL,
  NESTED_MOUNT,
  projectDisks,
  projectKey,
  ROOTLESS_UID,
} from "@pinetrie/docker"
import { type LanehostCall, ONCE, serverArgs } from "@pinetrie/lanehost"
import { PINETRIE_MOUNT, runtimeNode } from "@pinetrie/lanes"
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

/** The lanes directory, as a host here keeps it. */
const lanesDir = () =>
  planRuntime({
    platform: process.platform,
    nestedMount: existsSync(NESTED_MOUNT),
    stateHome:
      process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  }).lanesDir

/** Where a project's disks are on Docker's machine, as its host keeps them. */
export const dockerDisks = (root: string) =>
  projectDisks(lanesDir(), projectKey(root))

/** The project's lanehost `disks` container, which its host made; throws when there is none. */
function disksContainer(root: string): string {
  const [name] = cli([
    "ps",
    "--filter",
    `label=pinetrie.project=${projectKey(root)}`,
    "--filter",
    `label=${LANEHOST_LABEL}=disks`,
    "--format",
    "{{.Names}}",
  ])
    .split("\n")
    .filter(l => l.trim() !== "")
  if (name === undefined)
    throw new Error(
      `no lanehost disks container for ${root}: has its host started?`,
    )
  return name
}

/** One call to lanehost, as the host makes it, through its one-shot command. */
function lanehostOnce(root: string, call: LanehostCall): unknown {
  const out = cli([
    "exec",
    disksContainer(root),
    ...runtimeNode(`${PINETRIE_MOUNT}/${ONCE}`),
    ...serverArgs("disks", lanesDir(), { rootless: existsSync(NESTED_MOUNT) }),
    JSON.stringify(call),
  ])
  return JSON.parse(out) as unknown
}

/**
 * A script in the project's lanehost `disks` container, with `args`: for a
 * check that reads what a snapshot holds. Its output, or a failure's.
 */
export const inDisks = (
  root: string,
  script: string,
  ...args: string[]
): string =>
  quietly(["exec", disksContainer(root), "sh", "-c", script, "sh", ...args])

/** Whether snapshot `id` of the project at `root` is there. */
export const snapshotExists = (root: string, id: SnapshotId): boolean =>
  lanehostOnce(root, {
    kind: "snapshotExists",
    project: projectKey(root),
    snapshot: id,
  }) === true

export function deleteSnapshot(root: string, id: SnapshotId): void {
  lanehostOnce(root, {
    kind: "disk",
    project: projectKey(root),
    op: { kind: "deleteSnapshots", ids: [id] },
  })
}

/** Remove a lane's container and its disk. */
export function removeLane(root: string, lane: ThreadId): void {
  quietly(["rm", "-f", container(lane)])
  try {
    lanehostOnce(root, {
      kind: "disk",
      project: projectKey(root),
      op: { kind: "delete", lane },
    })
  } catch {
    // No lanehost: its host never made a disk.
  }
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
