// host/work/runtime — the one place that picks the runtime lanes run on: gather
// the facts, plan (`planRuntime`), and build the `LaneRuntime` lanes of their
// own get. On the Mac, Docker's is the lane VM's, through a lease on a slot of
// it; on Linux, the host's own. Everything after it takes the runtime as given.

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { errorText, OBSERVER_SOCKET } from "@pinetrie/core"
import {
  type DockerTarget,
  dockerRootless,
  dockerRuntime,
  dockerWords,
  gatherDockerHost,
  NESTED_MOUNT,
  planDockerHost,
  SLOT_LABEL,
  sweepSlot,
} from "@pinetrie/docker"
import type { Install } from "@pinetrie/install"
import { planObserver } from "@pinetrie/lanehost"
import {
  createQueue,
  type FolderDisks,
  type LaneRuntime,
} from "@pinetrie/lanes"
import type { ProjectRecord } from "@pinetrie/rules"
import {
  GVPROXY_HOST_ADDRESS,
  keepLease,
  leaseExtra,
  leaseVm,
  slotRoot,
  vmStateDir,
} from "@pinetrie/vm"
import {
  createShares,
  type HostShares,
  NO_SHARES,
  planShareAndGrant,
  sharesWords,
  type Wanted,
} from "./shares.ts"

/** What the host found where it runs: the project, and the runtime its lanes run on. */
export interface Found {
  readonly kind: "found"
  /** Where the project is; setup adds the rest of its record. */
  readonly project: Pick<ProjectRecord, "root">
  /** The pine·trie install lanes run from: mounted in each, and lanehost's. */
  readonly install: Install
  readonly runtime: LaneRuntime
  /** A folder project's calls of its disks, beside `runtime`: its adapter's alone. */
  readonly folder: FolderDisks
  /**
   * Called once by setup, before any lane starts: pine·trie's default image,
   * and what lanes may mount and reach, shared and granted as
   * `shareAndGrant` does.
   */
  ready(input: Wanted & { readonly defaultImage: string }): Promise<void>
  /**
   * What lanes may mount and reach now, each time accepted work moves,
   * before the new config is in force: on the Mac, a directory no slot of
   * this host holds goes in a new slot, and changed ports are granted. One
   * call at a time; nothing is done when nothing changed.
   */
  shareAndGrant(wanted: Wanted): Promise<void>
  /** After the lanes stop, at shutdown: on the Mac, the lease ends and the slot empties. */
  close(): Promise<void>
}

/** Why a host with tools cannot run its lanes here, worded with its fix. */
export interface Refused {
  readonly kind: "refused"
  readonly words: string
}

/** What decides which runtime lanes run on. */
interface RuntimeFacts {
  readonly platform: NodeJS.Platform
  /** Inside a lane granted lanes of its own: its inner lanes' directory is mounted. */
  readonly nestedMount: boolean
  readonly stateHome: string
}

type RuntimePlan =
  | { readonly kind: "docker-vm"; readonly lanesDir: string }
  | { readonly kind: "docker-host"; readonly lanesDir: string }

/** The data disk's mount in the lane VM (`packages/vm/image/init`). */
const VM_LANES_DIR = "/var/lib/lanehost"

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
 * (`root` null). Refused, with its words, where a runtime cannot run lanes. Read before pi's
 * setup, which loads from its root.
 */
export async function findProject(input: {
  /** The project's root, its adapter chosen (`host/project.ts`); null with no tools. */
  readonly root: string | null
  /** The pine·trie install lanes run from. */
  readonly install: Install
  /** The port this host listens on, refused to lanes; null when it is not known yet. */
  readonly ownPort?: number | null
  /** How many folders the lane VM shares: `lanes.vm.slots`, settled. */
  readonly slots: number
  /**
   * The host's ssh socket, mounted in every lane that holds an identity. It
   * need not listen yet: Docker binds it as a lane is made, and the launcher
   * connects to it for each of a lane's connections.
   */
  readonly hostSocket: string
  readonly log: (line: string) => void
}): Promise<Found | Refused | null> {
  if (input.root === null) return null
  return runtimeFound(
    input.root,
    input.install,
    input.slots,
    input.hostSocket,
    input.log,
    input.ownPort ?? null,
  )
}

const refusedWith = (words: string): Refused => ({ kind: "refused", words })

async function runtimeFound(
  root: string,
  install: Install,
  slots: number,
  hostSocket: string,
  log: (line: string) => void,
  ownPort: number | null,
): Promise<Found | Refused> {
  const env = process.env
  const planned = planRuntime({
    platform: process.platform,
    nestedMount: existsSync(NESTED_MOUNT),
    stateHome: env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  })
  const project = { root }
  return planned.kind === "docker-vm"
    ? vmFound(project, install, planned.lanesDir, slots, hostSocket, log, ownPort)
    : hostDockerFound(project, install, planned.lanesDir, hostSocket, log)
}

/** Docker on this machine (Linux): its socket, paths as they are. */
async function hostDockerFound(
  project: Found["project"],
  install: Install,
  lanesDir: string,
  hostSocket: string,
  log: (line: string) => void,
): Promise<Found | Refused> {
  const { root } = project
  const host = process.env.DOCKER_HOST
  const target: DockerTarget = {
    socket: host?.startsWith("unix://")
      ? host.slice("unix://".length)
      : "/var/run/docker.sock",
    pathOf: p => p,
    labels: {},
    hostSocket,
    hostAddress: null,
    remoteHostPaths: false,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, lanesDir))
  if (refusal !== null) return refusedWith(dockerWords(refusal))
  const observed = planObserver({
    rootless: await dockerRootless(target),
    forwarded: existsSync(OBSERVER_SOCKET),
  })
  if (observed.kind === "refused") return refusedWith(observed.why)
  const runtime = dockerRuntime({
    target,
    lanesDir,
    root,
    install,
    log,
    observer: observed.kind,
  })
  log(`[host] lanes run on Docker, their disks in ${lanesDir}`)
  let shares = NO_SHARES
  const queue = createQueue()
  const shareAndGrant = (wanted: Wanted) =>
    queue.enqueue(async () => {
      const plan = planShareAndGrant(shares, wanted, null, false)
      if (plan.words.length > 0) shares = { ...shares, toldLinuxPorts: true }
      for (const w of plan.words) log(`[host] ${sharesWords(w)}`)
    })
  return {
    kind: "found",
    project,
    install,
    runtime,
    folder: runtime.folder,
    ready: async ({ mounts, hostPorts }) => {
      runtime.serveFrom(mounts)
      sweptLog(await runtime.sweepProjects(), log)
      await shareAndGrant({ mounts, hostPorts })
    },
    shareAndGrant,
    close: async () => {},
  }
}

/**
 * Docker in this user's lane VM (the Mac): a lease on a slot, the slot's
 * containers left by a host that died holding it removed, the slot filled
 * once setup knows every directory lanes mount, and a slot more for each
 * widening after it. A slot is filled once: refilling it cuts every bind into
 * it, and the host's always holds lanehost's running roles.
 */
async function vmFound(
  project: Found["project"],
  install: Install,
  lanesDir: string,
  slots: number,
  hostSocket: string,
  log: (line: string) => void,
  ownPort: number | null,
): Promise<Found | Refused> {
  const { root } = project
  const stateDir = vmStateDir(process.env, homedir())
  const leaseNow = () => leaseVm({ stateDir, slots, agent: hostSocket, log })
  const leased = await leaseNow().catch((error: unknown) =>
    refusedWith(errorText(error)),
  )
  if ("words" in leased) return leased
  const first = leased
  /** A slot's containers left by a host that died holding it. */
  const sweep = async (slot: number) => {
    const left = await sweepSlot({ socket: first.docker }, slotRoot(slot))
    if (left.length > 0)
      log(
        `[host] removed ${left.length} containers left in slot ${slot} by a host that stopped holding it`,
      )
  }
  // Read by the target each time a lane is made, so a lane made after a
  // new lease is on the new slots. Assigned before the runtime makes any.
  let shares: HostShares | null = null
  const sharesNow = (): HostShares => {
    if (shares === null)
      throw new Error("this host's slot in the lane VM is not filled yet")
    return shares
  }
  const target: DockerTarget = {
    socket: first.docker,
    pathOf: source => sharesNow().pathOf(source),
    get labels() {
      return { [SLOT_LABEL]: String(shares?.slot() ?? first.slot) }
    },
    get hostSocket() {
      return `/run/pinetrie/ssh-${shares?.slot() ?? first.slot}.sock`
    },
    hostAddress: GVPROXY_HOST_ADDRESS,
    remoteHostPaths: true,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, null))
  if (refusal !== null) {
    await first.close()
    return refusedWith(dockerWords(refusal))
  }
  const runtime = dockerRuntime({ target, lanesDir, root, install, log })
  const held = createShares({
    lease: first,
    ownPort,
    sweep,
    extra: dirs => leaseExtra({ stateDir, dirs, sweep, log }),
    grant: async ports => {
      await runtime.grantHostPorts(ports)
    },
    relet: () => runtime.vmRestarted(),
    log,
  })
  shares = held
  const kept = keepLease({
    first,
    lease: leaseNow,
    // A new VM: everything given shared and granted again, as on the first
    // lease. Each lane is made again at its next start.
    settle: next => held.relet(next),
    log,
  })
  return {
    kind: "found",
    project,
    install,
    runtime,
    folder: runtime.folder,
    async ready(wanted) {
      runtime.serveFrom(wanted.mounts)
      await held.share(wanted)
      sweptLog(await runtime.sweepProjects(), log)
    },
    shareAndGrant: held.share,
    async close() {
      await held.close()
      await kept.close()
    },
  }
}

const sweptLog = (keys: readonly string[], log: (line: string) => void) => {
  if (keys.length > 0)
    log(
      `[host] removed the lanes of ${keys.length} projects whose folders are gone`,
    )
}
