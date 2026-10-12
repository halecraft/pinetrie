// host/work/runtime — the one place that picks the runtime lanes run on: gather
// the facts, plan (`planRuntime`), and build the `LaneRuntime` lanes of their
// own get. On the Mac, Docker's is the lane VM's, through a lease on a slot of
// it; on Linux, the host's own. Everything after it takes the runtime as given.

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { errorText, type ProjectRecord } from "@pinetrie/core"
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
  type WrittenMachine,
} from "@pinetrie/lanes"
import {
  GVPROXY_HOST_ADDRESS,
  keepLease,
  leaseVm,
  vmStateDir,
} from "@pinetrie/vm"

/** What the host found where it runs: the project, and the runtime its lanes run on. */
export interface Found {
  readonly kind: "found"
  readonly project: ProjectRecord
  readonly runtime: LaneRuntime
  /**
   * Called once by setup, before any lane starts: pine·trie's default image,
   * every host path a lane mounts (on the Mac, shared into this host's slot
   * of the VM), and the ports of the Mac's loopback the project grants its
   * lanes.
   */
  ready(input: {
    readonly defaultImage: string
    readonly mounts: readonly Mount[]
    readonly hostPorts: readonly number[]
  }): Promise<void>
  /** After the lanes stop, at shutdown: on the Mac, the lease ends and the slot empties. */
  close(): Promise<void>
}

/** Why a host with tools cannot run its lanes here, worded with its fix. */
export interface Refused {
  readonly kind: "refused"
  readonly words: string
}

/**
 * Which granted ports of the Mac's loopback lanes may reach. The host's own
 * port is refused, with why: a host bound to loopback takes no key, so a lane
 * reaching it would act as a person (`startHost`).
 */
export function planHostPortGrant(
  ports: readonly number[],
  ownPort: number | null,
): { readonly grant: readonly number[]; readonly refused: readonly string[] } {
  const refused = ports
    .filter(p => p === ownPort)
    .map(
      p =>
        `lanes.hostPorts ${p} is not granted: it is this pine·trie host's own port, which takes no key on loopback`,
    )
  return { grant: ports.filter(p => p !== ownPort), refused }
}

/** What decides which runtime lanes run on. */
export interface RuntimeFacts {
  readonly platform: NodeJS.Platform
  /** Inside a lane granted lanes of its own: its inner lanes' directory is mounted. */
  readonly nestedMount: boolean
  readonly stateHome: string
}

export type RuntimePlan =
  | { readonly kind: "docker-vm"; readonly lanesDir: string }
  | { readonly kind: "docker-host"; readonly lanesDir: string }

/** The data disk's mount in the lane VM (`packages/vm/image/init`). */
export const VM_LANES_DIR = "/var/lib/lanehost"

/**
 * Docker: in the lane VM on the Mac, and the host's own on Linux. Inside a
 * lane, its inner lanes' directory is the lanes directory.
 */
export function planRuntime(f: RuntimeFacts): RuntimePlan {
  if (f.platform === "darwin")
    return { kind: "docker-vm", lanesDir: VM_LANES_DIR }
  return {
    kind: "docker-host",
    lanesDir: f.nestedMount
      ? NESTED_MOUNT
      : path.join(f.stateHome, "pinetrie", "lanes"),
  }
}

/**
 * Find the project in `dir`, and the runtime its lanes run on: Docker, in
 * the lane VM on the Mac and the host's own on Linux. Null with no tools
 * (`dir` null). Refused, with its words, where lanes cannot run: a folder
 * with no jj repo, or a runtime that cannot run them. Read before pi's
 * setup, which loads from its root.
 */
export async function findProject(input: {
  /** The project's folder, whose root is found from it; null with no tools. */
  readonly dir: string | null
  /** The port this host listens on, refused to lanes; null when it is not known yet. */
  readonly ownPort?: number | null
  /** The user config's `lanes.vm.slots`, as written. */
  readonly machine: WrittenMachine
  readonly log: (line: string) => void
}): Promise<Found | Refused | null> {
  if (input.dir === null) return null
  return runtimeFound(
    input.dir,
    input.machine,
    input.log,
    input.ownPort ?? null,
  )
}

const refusedWith = (words: string): Refused => ({ kind: "refused", words })

async function runtimeFound(
  dir: string,
  written: WrittenMachine,
  log: (line: string) => void,
  ownPort: number | null,
): Promise<Found | Refused> {
  const { machine, refused } = machineConfig(written)
  for (const r of refused) log(`[host] ${r}`)
  const env = process.env
  const planned = planRuntime({
    platform: process.platform,
    nestedMount: existsSync(NESTED_MOUNT),
    stateHome: env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  })
  const root = planRoot(await prepareProjectDir(dir))
  if ("refused" in root) return refusedWith(root.refused)
  const project: ProjectRecord = { root: root.ok }
  return planned.kind === "docker-vm"
    ? vmFound(project, root.ok, planned.lanesDir, machine.slots, log, ownPort)
    : hostDockerFound(project, root.ok, planned.lanesDir, log)
}

/** Docker on this machine (Linux): its socket, paths as they are. */
async function hostDockerFound(
  project: ProjectRecord,
  root: string,
  lanesDir: string,
  log: (line: string) => void,
): Promise<Found | Refused> {
  const host = process.env.DOCKER_HOST
  const target: DockerTarget = {
    socket: host?.startsWith("unix://")
      ? host.slice("unix://".length)
      : "/var/run/docker.sock",
    pathOf: p => p,
    labels: {},
    sshAgent: process.env.SSH_AUTH_SOCK ?? null,
    hostAddress: null,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, lanesDir))
  if (refusal !== null) return refusedWith(dockerWords(refusal))
  const runtime = dockerRuntime({ target, lanesDir, root, log })
  log(`[host] lanes run on Docker, their disks in ${lanesDir}`)
  return {
    kind: "found",
    project,
    runtime,
    ready: async ({ mounts, hostPorts }) => {
      runtime.serveFrom(mounts)
      sweptLog(await runtime.sweepProjects(), log)
      if (hostPorts.length > 0)
        log(
          "[host] lanes.hostPorts applies to the Mac's lane VM: on Linux a lane reaches the host's services bound to all interfaces, at Docker's bridge gateway",
        )
    },
    close: async () => {},
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
  ownPort: number | null,
): Promise<Found | Refused> {
  const leaseNow = () =>
    leaseVm({
      stateDir: vmStateDir(process.env, homedir()),
      slots,
      agent: process.env.SSH_AUTH_SOCK ?? null,
      log,
    })
  const leased = await leaseNow().catch((error: unknown) =>
    refusedWith(errorText(error)),
  )
  if ("words" in leased) return leased
  const first = leased
  /** The lease held now: a new one after the VM stopped under this host. */
  let current = first
  let pathOf: ((source: string) => string) | null = null
  // What follows the slot is read through `current`, each time a lane is
  // made, so a lane made after a new lease is on the new slot.
  const target: DockerTarget = {
    socket: first.docker,
    pathOf: source => {
      if (pathOf === null)
        throw new Error("this host's slot in the lane VM is not filled yet")
      return pathOf(source)
    },
    get labels() {
      return { [SLOT_LABEL]: String(current.slot) }
    },
    get sshAgent() {
      return `/run/pinetrie/ssh-${current.slot}.sock`
    },
    hostAddress: GVPROXY_HOST_ADDRESS,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, null))
  if (refusal !== null) {
    await first.close()
    return refusedWith(dockerWords(refusal))
  }
  /** A slot's containers left by a host that died holding it. */
  const sweep = async (lease: typeof first) => {
    const left = await sweepSlot(target, lease.slot)
    if (left.length > 0)
      log(
        `[host] removed ${left.length} containers left in slot ${lease.slot} by a host that stopped holding it`,
      )
  }
  await sweep(first)
  const runtime = dockerRuntime({ target, lanesDir, root, log })
  /** What setup gave `ready`, for each lease after the first. */
  let given: { mounts: readonly Mount[]; hostPorts: readonly number[] } | null =
    null
  /** The slot filled with every directory lanes mount, and the project's grant. */
  async function fillAndGrant(lease: typeof first): Promise<void> {
    if (given === null) return
    const filled = await lease.fill(
      given.mounts.map(m => ({ source: m.source, readOnly: m.readonly })),
    )
    pathOf = filled.pathOf
    // Before any lane starts: the grant replaces whatever a host of this
    // project set before.
    const { grant, refused } = planHostPortGrant(given.hostPorts, ownPort)
    for (const r of refused) log(`[host] ${r}`)
    await runtime.grantHostPorts(grant)
    if (grant.length > 0)
      log(
        `[host] lanes may reach these ports of your Mac's loopback, at ${GVPROXY_HOST_ADDRESS}: ${grant.join(", ")}`,
      )
  }
  const kept = keepLease({
    first,
    lease: leaseNow,
    // A new VM: its slot swept and filled as the first was, and the grant
    // written again. Each lane is made again at its next start.
    async settle(next) {
      current = next
      pathOf = null
      runtime.vmRestarted()
      await sweep(next)
      await fillAndGrant(next)
    },
    log,
  })
  return {
    kind: "found",
    project,
    runtime,
    async ready({ mounts, hostPorts }) {
      given = { mounts, hostPorts }
      runtime.serveFrom(mounts)
      await fillAndGrant(current)
      sweptLog(await runtime.sweepProjects(), log)
    },
    close: () => kept.close(),
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
  /** The VM's Docker answers, through the launcher's `docker.sock`. */
  readonly vmDocker: boolean
  /** A Docker on this machine answers (`docker version`): any vendor's. */
  readonly hostDocker: boolean
}

/** Where the VM's image is built: the first Docker found. */
export type Builder =
  | { readonly kind: "docker-vm" }
  | { readonly kind: "docker-host" }
  | { readonly kind: "none" }

/**
 * The VM's own Docker if it runs; else a Docker on this machine, on any
 * platform: the one way to build a Mac's first image, or a new one while
 * its VM is stopped, since the VM starts only from the current image
 * (`planVm`'s `no-image`). The build runs one throwaway container with no
 * mount, so any Docker does (`packages/vm/build.ts`).
 */
export function planBuilder(f: BuilderFacts): Builder {
  if (f.vmDocker) return { kind: "docker-vm" }
  if (f.hostDocker) return { kind: "docker-host" }
  return { kind: "none" }
}

/** Why the image cannot be built here, worded with what would let it. */
export const BUILDER_WORDS =
  "no Docker to build the lane VM's image in: start a Docker on this machine (`docker version` answers), or the lane VM if it has an image"
