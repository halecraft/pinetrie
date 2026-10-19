// e2e/lane-runtime — the suites' runtime, Docker: its CLI, and a
// lane's container and disks read and removed through lanehost, as the host
// does. The lane VM's Docker on the Mac, the host's on Linux, and
// a nested lane's rootless one inside a lane.

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
import { command, commandOutput } from "./command.ts"

export const container = (lane: ThreadId) => `pinetrie-${lane}`

/** The docker CLI, against the lane VM's socket on the Mac. */
export function runtimeCli(): readonly string[] {
  const host =
    process.platform === "darwin"
      ? `unix://${path.join(vmStateDir(process.env, homedir()), "docker.sock")}`
      : (process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock")
  return ["docker", "-H", host]
}

/** The runtime's CLI with `args`; rejects on failure (`CommandFailed`). */
export function cli(args: readonly string[], input?: string): Promise<string> {
  const [program = "docker", ...rest] = runtimeCli()
  return command(
    program,
    [...rest, ...args],
    input === undefined ? {} : { input },
  )
}

/** `cli`, with a failure's output as its answer. */
function quietly(args: readonly string[]): Promise<string> {
  const [program = "docker", ...rest] = runtimeCli()
  return commandOutput(program, [...rest, ...args])
}

export const isRunning = async (name: string): Promise<boolean> =>
  (await quietly(["inspect", "-f", "{{.State.Running}}", name])).trim() ===
  "true"

export const containerExists = async (name: string): Promise<boolean> =>
  /^[0-9a-f]{12,}$/.test(
    (await quietly(["inspect", "-f", "{{.Id}}", name])).trim(),
  )

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
async function disksContainer(root: string): Promise<string> {
  const [name] = (
    await cli([
      "ps",
      "--filter",
      `label=pinetrie.project=${projectKey(root)}`,
      "--filter",
      `label=${LANEHOST_LABEL}=disks`,
      "--format",
      "{{.Names}}",
    ])
  )
    .split("\n")
    .filter(l => l.trim() !== "")
  if (name === undefined)
    throw new Error(
      `no lanehost disks container for ${root}: has its host started?`,
    )
  return name
}

/** One call to lanehost, as the host makes it, through its one-shot command. */
async function lanehostOnce(
  root: string,
  call: LanehostCall,
): Promise<unknown> {
  const out = await cli([
    "exec",
    await disksContainer(root),
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
export const inDisks = async (
  root: string,
  script: string,
  ...args: string[]
): Promise<string> =>
  quietly([
    "exec",
    await disksContainer(root),
    "sh",
    "-c",
    script,
    "sh",
    ...args,
  ])

/** Whether snapshot `id` of the project at `root` is there. */
export const snapshotExists = async (
  root: string,
  id: SnapshotId,
): Promise<boolean> =>
  (await lanehostOnce(root, {
    kind: "snapshot-exists",
    project: projectKey(root),
    snapshot: id,
  })) === true

export async function deleteSnapshot(
  root: string,
  id: SnapshotId,
): Promise<void> {
  await lanehostOnce(root, {
    kind: "disk",
    project: projectKey(root),
    op: { kind: "delete-snapshots", ids: [id] },
  })
}

/**
 * Put back a lane's disk as `from`'s clone, as a fork's restore leaves it
 * before the fork's setup runs.
 */
export async function restoreDisk(
  root: string,
  lane: ThreadId,
  from: SnapshotId,
): Promise<void> {
  for (const op of [
    { kind: "delete", lane },
    { kind: "restore", lane, from },
  ] as const)
    await lanehostOnce(root, { kind: "disk", project: projectKey(root), op })
}

/** Remove a lane's container and its disk. */
export async function removeLane(root: string, lane: ThreadId): Promise<void> {
  await quietly(["rm", "-f", container(lane)])
  try {
    await lanehostOnce(root, {
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
export async function ownForInnerLanes(dir: string): Promise<void> {
  if (existsSync(NESTED_MOUNT))
    await command("chown", ["-R", `${ROOTLESS_UID}:${ROOTLESS_UID}`, dir])
}
