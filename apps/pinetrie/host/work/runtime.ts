// host/work/runtime — the one place that picks the runtime lanes run on
// (ADR-0103): gather the facts, plan (`planRuntime`), and build the
// `LaneRuntime` lanes of their own get. On the Mac, Docker's is the lane VM's,
// through a lease on a slot of it; on Linux, the host's own. Everything after
// it takes the runtime as given.

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { containerRuntime, prepareContainerHost } from "@pinetrie/container"
import type { ProjectRecord } from "@pinetrie/core"
import {
  type DockerTarget,
  dockerRuntime,
  dockerWords,
  gatherDockerHost,
  NESTED_MOUNT,
  planDockerHost,
  SLOT_LABEL,
  sweepSlot,
} from "@pinetrie/docker"
import {
  type LaneRuntime,
  type Mount,
  machineConfig,
  planRoot,
  prepareProjectDir,
  type RuntimeChoice,
  type WrittenMachine,
} from "@pinetrie/lanes"
import { leaseVm, vmStateDir } from "@pinetrie/vm"
import { type Convert, converter } from "./convert.ts"

/** What the host found where it runs: the project, and its lanes' runtime when they have their own. */
export interface Found {
  readonly project: ProjectRecord
  readonly runtime: LaneRuntime | null
  /**
   * Called once by setup, before any lane starts: pine·trie's default image
   * (`container` trims a stopped lane's disk with it), and every host path
   * a lane mounts (on the Mac, shared into this host's slot of the VM).
   */
  ready(input: {
    readonly defaultImage: string
    readonly mounts: readonly Mount[]
  }): Promise<void>
  /** After the lanes stop, at shutdown: on the Mac, the lease ends and the slot empties. */
  close(): Promise<void>
  /** pre-docker: converts a lane made under `container`; null where there is none to read. */
  readonly convert: Convert | null
}

/** Thrown when the chosen runtime cannot run lanes here; startup stops with its words. */
export class RuntimeRefused extends Error {}

/**
 * The project as the host keeps it. `PINETRIE_LANES=0` (`defaultDirect`)
 * changes a new root lane's default, never whether a lane may have its own
 * copy. Pure.
 */
export function projectOf(
  found: Pick<Found, "project"> | null,
  defaultDirect: boolean,
): ProjectRecord | null {
  if (found === null) return null
  const { project } = found
  return project.kind === "lanes" && defaultDirect
    ? { ...project, rootDefault: "direct" }
    : project
}

/** What decides which runtime lanes run on. */
export interface RuntimeFacts {
  readonly platform: NodeJS.Platform
  /** `lanes.runtime` from the user config (`machineConfig`). */
  readonly choice: RuntimeChoice
  /** Inside a lane granted lanes of its own: its inner lanes' directory is mounted. */
  readonly nestedMount: boolean
  readonly stateHome: string
}

export type RuntimePlan =
  | { readonly kind: "container" }
  | { readonly kind: "docker-vm"; readonly lanesDir: string }
  | { readonly kind: "docker-host"; readonly lanesDir: string }

/** The data disk's mount in the lane VM (`packages/vm/image/init`). */
export const VM_LANES_DIR = "/var/lib/lanehost"

/**
 * `container` when the user chose it; Docker otherwise, in the lane VM on
 * the Mac and the host's own on Linux. Inside a lane, its inner lanes'
 * directory is the lanes directory.
 */
export function planRuntime(f: RuntimeFacts): RuntimePlan {
  if (f.choice === "container") return { kind: "container" }
  if (f.platform === "darwin")
    return { kind: "docker-vm", lanesDir: VM_LANES_DIR }
  return {
    kind: "docker-host",
    lanesDir: f.nestedMount
      ? NESTED_MOUNT
      : path.join(f.stateHome, "pinetrie", "lanes"),
  }
}

const NONE: Pick<Found, "ready" | "close" | "convert"> = {
  ready: async () => {},
  close: async () => {},
  convert: null,
}

/**
 * Find the project in `dir`, and whether its lanes can have their own copies,
 * on the runtime the user config chooses. Null with no tools (`dir` null).
 * Read before pi's setup, which loads from its root. A Docker that cannot run
 * lanes throws `RuntimeRefused`.
 */
export async function findProject(input: {
  /** The project's folder, whose root is found from it; null with no tools. */
  readonly dir: string | null
  /** `PINETRIE_LANES=0`: a new root lane works directly by default. */
  readonly defaultDirect: boolean
  /** False: lanes never get containers here, and no runtime is asked. */
  readonly containers: boolean
  /** A runtime's refusal: thrown (`stop`), or the project works directly with its words. */
  readonly runtimeRefused?: "stop" | "direct"
  /** The user config's `lanes.runtime` and `lanes.vm.slots`, as written. */
  readonly machine: WrittenMachine
  readonly log: (line: string) => void
}): Promise<Found | null> {
  if (input.dir === null) return null
  const dir = input.dir
  const found: Found = input.containers
    ? await runtimeFound(dir, input.machine, input.log).catch(error => {
        if (
          !(error instanceof RuntimeRefused) ||
          input.runtimeRefused !== "direct"
        )
          throw error
        return {
          project: { kind: "direct", root: dir, reason: error.message },
          runtime: null,
          ...NONE,
        } satisfies Found
      })
    : {
        project: {
          kind: "direct",
          root: input.dir,
          reason: "lanes of their own are off for this host",
        },
        runtime: null,
        ...NONE,
      }
  const project = projectOf(found, input.defaultDirect)
  return project === null ? null : { ...found, project }
}

async function runtimeFound(
  dir: string,
  written: WrittenMachine,
  log: (line: string) => void,
): Promise<Found> {
  const { machine, refused } = machineConfig(written)
  for (const r of refused) log(`[host] ${r}`)
  const env = process.env
  const planned = planRuntime({
    platform: process.platform,
    choice: machine.runtime,
    nestedMount: existsSync(NESTED_MOUNT),
    stateHome: env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  })
  if (planned.kind === "container") return containerFound(dir)
  const root = planRoot(await prepareProjectDir(dir), dir)
  if ("direct" in root)
    return {
      project: { kind: "direct", root: root.direct, reason: root.reason },
      runtime: null,
      ...NONE,
    }
  const project: ProjectRecord = {
    kind: "lanes",
    root: root.ok,
    rootDefault: "own",
  }
  return planned.kind === "docker-vm"
    ? vmFound(project, root.ok, planned.lanesDir, machine.slots, log)
    : hostDockerFound(project, root.ok, planned.lanesDir, log)
}

async function containerFound(dir: string): Promise<Found> {
  const { project, paths } = await prepareContainerHost(dir)
  if (paths === null) return { project, runtime: null, ...NONE }
  const tools = Promise.withResolvers<string>()
  return {
    project,
    runtime: containerRuntime({ paths, trimImage: () => tools.promise }),
    ready: async ({ defaultImage }) => tools.resolve(defaultImage),
    close: async () => {},
    convert: null,
  }
}

/** Docker on this machine (Linux): its socket, paths as they are. */
async function hostDockerFound(
  project: ProjectRecord,
  root: string,
  lanesDir: string,
  log: (line: string) => void,
): Promise<Found> {
  const host = process.env.DOCKER_HOST
  const target: DockerTarget = {
    socket: host?.startsWith("unix://")
      ? host.slice("unix://".length)
      : "/var/run/docker.sock",
    pathOf: p => p,
    labels: {},
    sshAgent: process.env.SSH_AUTH_SOCK ?? null,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, lanesDir))
  if (refusal !== null) throw new RuntimeRefused(dockerWords(refusal))
  const runtime = dockerRuntime({ target, lanesDir, root })
  log(`[host] lanes run on Docker, their disks in ${lanesDir}`)
  return {
    project,
    runtime,
    ready: async () => {
      sweptLog(await runtime.sweepProjects(), log)
    },
    close: async () => {},
    convert: null,
  }
}

/**
 * Docker in this user's lane VM (the Mac): a lease on a slot, the slot's
 * containers left by a host that died holding it removed, and the slot
 * filled when setup knows every directory lanes mount.
 */
async function vmFound(
  project: ProjectRecord,
  root: string,
  lanesDir: string,
  slots: number,
  log: (line: string) => void,
): Promise<Found> {
  const lease = await leaseVm({
    stateDir: vmStateDir(process.env, homedir()),
    slots,
    agent: process.env.SSH_AUTH_SOCK ?? null,
    log,
  }).catch(error => {
    throw new RuntimeRefused(
      error instanceof Error ? error.message : String(error),
    )
  })
  let pathOf: ((source: string) => string) | null = null
  const target: DockerTarget = {
    socket: lease.docker,
    pathOf: source => {
      if (pathOf === null)
        throw new Error("this host's slot in the lane VM is not filled yet")
      return pathOf(source)
    },
    labels: { [SLOT_LABEL]: String(lease.slot) },
    sshAgent: `/run/pinetrie/ssh-${lease.slot}.sock`,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, null))
  if (refusal !== null) {
    await lease.close()
    throw new RuntimeRefused(dockerWords(refusal))
  }
  const left = await sweepSlot(target, lease.slot)
  if (left.length > 0)
    log(
      `[host] removed ${left.length} containers left in slot ${lease.slot} by a host that stopped holding it`,
    )
  const runtime = dockerRuntime({ target, lanesDir, root })
  // pre-docker: lanes made under `container` move over at their first start,
  // while `container` runs to read them.
  const { paths } = await prepareContainerHost(root)
  if (paths === null)
    log(
      "[host] Apple's container is not running: a lane made under it cannot move to Docker until it does",
    )
  return {
    project,
    runtime,
    async ready({ mounts }) {
      const filled = await lease.fill(
        mounts.map(m => ({ source: m.source, readOnly: m.readonly })),
      )
      pathOf = filled.pathOf
      sweptLog(await runtime.sweepProjects(), log)
    },
    close: () => lease.close(),
    convert: paths === null ? null : converter({ paths, docker: runtime, log }),
  }
}

const sweptLog = (keys: readonly string[], log: (line: string) => void) => {
  if (keys.length > 0)
    log(
      `[host] removed the lanes of ${keys.length} projects whose folders are gone`,
    )
}

/** What decides where the VM's image is built. */
export interface BuilderFacts {
  readonly platform: NodeJS.Platform
  /** The VM's Docker answers, through the launcher's `docker.sock`. */
  readonly vmDocker: boolean
  /** The host's own Docker answers. */
  readonly hostDocker: boolean
  /** Apple's `container` is running. */
  readonly container: boolean
}

/** Where the VM's image is built: the first Linux runtime found. */
export type Builder =
  | { readonly kind: "docker-vm" }
  | { readonly kind: "docker-host" }
  | { readonly kind: "container" }
  | { readonly kind: "none"; readonly platform: NodeJS.Platform }

/**
 * The VM's own Docker if it runs; else the host's Docker on Linux (on the
 * Mac, a Docker of another vendor is not asked); else Apple's `container`.
 */
export function planBuilder(f: BuilderFacts): Builder {
  if (f.vmDocker) return { kind: "docker-vm" }
  if (f.platform === "linux" && f.hostDocker) return { kind: "docker-host" }
  if (f.container) return { kind: "container" }
  return { kind: "none", platform: f.platform }
}

/** Why the image cannot be built here, worded with what would let it. */
export function builderWords(b: Extract<Builder, { kind: "none" }>): string {
  return b.platform === "darwin"
    ? "no Linux runtime to build the VM image in: start Apple's `container` (`container system start`)"
    : "no Linux runtime to build the VM image in: Docker does not answer (`docker version`)"
}
