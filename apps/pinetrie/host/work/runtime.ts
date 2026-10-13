// host/work/runtime — the one place that picks the runtime lanes run on: gather
// the facts, plan (`planRuntime`), and build the `LaneRuntime` lanes of their
// own get. On the Mac, Docker's is the lane VM's, through a lease on a slot of
// it; on Linux, the host's own. Everything after it takes the runtime as given.

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { errorText, OBSERVER_SOCKET, type ProjectRecord } from "@pinetrie/core"
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
import { planObserver } from "@pinetrie/lanehost"
import {
  type LaneRuntime,
  type Mount,
  machineConfig,
  planRoot,
  prepareProjectDir,
  type WrittenMachine,
} from "@pinetrie/lanes"
import {
  type Fill,
  GVPROXY_HOST_ADDRESS,
  keepLease,
  type Lease,
  leaseExtra,
  leaseVm,
  planShares,
  planWidening,
  type ShareDir,
  sharePaths,
  slotRoot,
  vmStateDir,
} from "@pinetrie/vm"

/** What the host found where it runs: the project, and the runtime its lanes run on. */
export interface Found {
  readonly kind: "found"
  /** Where the project is; setup adds the rest of its record. */
  readonly project: Pick<ProjectRecord, "root">
  readonly runtime: LaneRuntime
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

/** What lanes of this host may mount, and the ports of the Mac's loopback they may reach. */
export interface Wanted {
  readonly mounts: readonly Mount[]
  readonly hostPorts: readonly number[]
}

/** What the host has shared and granted on its lease (on Linux, only what it said). */
export interface Shares {
  /** Every slot filled on this lease, the host's first. */
  readonly fills: readonly Fill[]
  /**
   * The ports of the last grant written, as accepted work named them (the
   * host's own included, which is never written); null when none was
   * written on this lease.
   */
  readonly granted: readonly number[] | null
  /** The directories a widening got no slot for, and why: not asked again while they are what is new. */
  readonly refused: {
    readonly dirs: readonly ShareDir[]
    readonly why: string
  } | null
  /** On Linux, whether the host has said its ports apply to nothing. */
  readonly toldLinuxPorts: boolean
}

export const NO_SHARES: Shares = {
  fills: [],
  granted: null,
  refused: null,
  toldLinuxPorts: false,
}

/** What `shareAndGrant` says, worded by `sharesWords`. */
export type SharesWords =
  | {
      readonly kind: "widened"
      readonly slot: number
      readonly dirs: readonly string[]
    }
  | {
      readonly kind: "no-slot"
      readonly dirs: readonly string[]
      readonly why: string
    }
  | { readonly kind: "own-port"; readonly port: number }
  | { readonly kind: "linux-ports" }

export function sharesWords(w: SharesWords): string {
  switch (w.kind) {
    case "widened":
      return `shared with lanes from their next start, through slot ${w.slot} of the lane VM: ${w.dirs.join(", ")}`
    case "no-slot":
      return `not shared with lanes until this host restarts, since the lane VM gave it no slot for them (${w.why}): ${w.dirs.join(", ")}`
    case "own-port":
      return `lanes.hostPorts ${w.port} is not granted: it is this pine·trie host's own port, which takes no key on loopback`
    case "linux-ports":
      return "lanes.hostPorts applies to the Mac's lane VM: on Linux a lane reaches the host's services bound to all interfaces, at Docker's bridge gateway"
  }
}

/** What to do for `wanted`, given what was shared and granted. */
export interface SharesPlan {
  /** Directories to fill a slot with: the host's own first, then a new one. */
  readonly fill: {
    readonly into: "host" | "extra"
    readonly dirs: readonly ShareDir[]
  } | null
  /** The ports to write, replacing the last grant. */
  readonly grant: readonly number[] | null
  readonly words: readonly SharesWords[]
}

const sameDirs = (a: readonly ShareDir[], b: readonly ShareDir[]) =>
  JSON.stringify(planShares(a)) === JSON.stringify(planShares(b))

/**
 * On the Mac (`slots`): the host's slot is filled with every directory
 * first; after it, a directory no fill holds as wanted goes in a new slot,
 * unless the last widening was refused for the same ones. The ports are
 * written when they differ from the last grant, less the host's own: a host
 * bound to loopback takes no key, so a lane reaching it would act as a
 * person (`startHost`). On Linux nothing is shared or granted, and the host
 * says once that its ports apply to nothing.
 */
export function planShareAndGrant(
  shares: Shares,
  wanted: Wanted,
  ownPort: number | null,
  slots: boolean,
): SharesPlan {
  if (!slots)
    return {
      fill: null,
      grant: null,
      words:
        wanted.hostPorts.length > 0 && !shares.toldLinuxPorts
          ? [{ kind: "linux-ports" }]
          : [],
    }
  const dirs = wanted.mounts.map(m => ({
    source: m.source,
    readOnly: m.readonly,
  }))
  const widening = planWidening(shares.fills, dirs)
  const fill =
    shares.fills.length === 0
      ? { into: "host" as const, dirs }
      : widening.length > 0 &&
          !(shares.refused !== null && sameDirs(shares.refused.dirs, widening))
        ? { into: "extra" as const, dirs: widening }
        : null
  const changed =
    shares.granted === null ||
    wanted.hostPorts.join(",") !== shares.granted.join(",")
  return {
    fill,
    grant: changed ? wanted.hostPorts.filter(p => p !== ownPort) : null,
    words: changed
      ? wanted.hostPorts
          .filter(p => p === ownPort)
          .map(port => ({ kind: "own-port" as const, port }))
      : [],
  }
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
  /**
   * The host's ssh socket, mounted in every lane that holds an identity. It
   * need not listen yet: Docker binds it as a lane is made, and the launcher
   * connects to it for each of a lane's connections.
   */
  readonly hostSocket: string
  readonly log: (line: string) => void
}): Promise<Found | Refused | null> {
  if (input.dir === null) return null
  return runtimeFound(
    input.dir,
    input.machine,
    input.hostSocket,
    input.log,
    input.ownPort ?? null,
  )
}

const refusedWith = (words: string): Refused => ({ kind: "refused", words })

async function runtimeFound(
  dir: string,
  written: WrittenMachine,
  hostSocket: string,
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
  const project = { root: root.ok }
  return planned.kind === "docker-vm"
    ? vmFound(
        project,
        planned.lanesDir,
        machine.slots,
        hostSocket,
        log,
        ownPort,
      )
    : hostDockerFound(project, planned.lanesDir, hostSocket, log)
}

/** Docker on this machine (Linux): its socket, paths as they are. */
async function hostDockerFound(
  project: Found["project"],
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
    log,
    observer: observed.kind,
  })
  log(`[host] lanes run on Docker, their disks in ${lanesDir}`)
  let shares = NO_SHARES
  const shareAndGrant = oneAtATime(async (wanted: Wanted) => {
    const plan = planShareAndGrant(shares, wanted, null, false)
    if (plan.words.length > 0) shares = { ...shares, toldLinuxPorts: true }
    for (const w of plan.words) log(`[host] ${sharesWords(w)}`)
  })
  return {
    kind: "found",
    project,
    runtime,
    ready: async ({ mounts, hostPorts }) => {
      runtime.serveFrom(mounts)
      sweptLog(await runtime.sweepProjects(), log)
      await shareAndGrant({ mounts, hostPorts })
    },
    shareAndGrant,
    close: async () => {},
  }
}

/** `run`, one call at a time, each after the last settles. */
function oneAtATime<A>(run: (a: A) => Promise<void>): (a: A) => Promise<void> {
  let last: Promise<void> = Promise.resolve()
  return a => {
    const next = last.then(() => run(a))
    last = next.catch(() => {})
    return next
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
  /** The lease held now: a new one after the VM stopped under this host. */
  let current = first
  /** The slots leased after the host's for directories its slot lacked. */
  let extras: Lease[] = []
  let shares = NO_SHARES
  /** What lanes were last to mount and reach, replayed on a new lease. */
  let given: Wanted | null = null
  // What follows the slot is read through `current` and `shares`, each time
  // a lane is made, so a lane made after a new lease is on the new slot.
  const target: DockerTarget = {
    socket: first.docker,
    pathOf: source => {
      if (shares.fills.length === 0)
        throw new Error("this host's slot in the lane VM is not filled yet")
      try {
        return sharePaths(shares.fills)(source)
      } catch (error) {
        const { refused } = shares
        if (refused?.dirs.some(d => d.source === source))
          throw new Error(
            sharesWords({ kind: "no-slot", dirs: [source], why: refused.why }),
          )
        throw error
      }
    },
    get labels() {
      return { [SLOT_LABEL]: String(current.slot) }
    },
    get hostSocket() {
      return `/run/pinetrie/ssh-${current.slot}.sock`
    },
    hostAddress: GVPROXY_HOST_ADDRESS,
    remoteHostPaths: true,
  }
  const refusal = planDockerHost(await gatherDockerHost(target, null))
  if (refusal !== null) {
    await first.close()
    return refusedWith(dockerWords(refusal))
  }
  /** A slot's containers left by a host that died holding it. */
  const sweep = async (slot: number) => {
    const left = await sweepSlot(target, slotRoot(slot))
    if (left.length > 0)
      log(
        `[host] removed ${left.length} containers left in slot ${slot} by a host that stopped holding it`,
      )
  }
  await sweep(first.slot)
  const runtime = dockerRuntime({ target, lanesDir, root, log })

  /** A new slot for `dirs`, swept first; why, when there is none. */
  async function widen(
    dirs: readonly ShareDir[],
  ): Promise<Fill | { readonly why: string }> {
    let extra: Lease | null = null
    try {
      extra = await leaseExtra({ stateDir, host: current, log })
      await sweep(extra.slot)
      const fill = await extra.fill(dirs)
      extras = [...extras, extra]
      return fill
    } catch (error) {
      await extra?.close().catch(() => {})
      return { why: errorText(error) }
    }
  }

  const shareAndGrant = oneAtATime(async (wanted: Wanted) => {
    given = wanted
    const plan = planShareAndGrant(shares, wanted, ownPort, true)
    if (plan.fill?.into === "host") {
      const fill = await current.fill(plan.fill.dirs)
      shares = { ...shares, fills: [fill] }
    } else if (plan.fill?.into === "extra") {
      const dirs = plan.fill.dirs
      const got = await widen(dirs)
      const names = dirs.map(d => d.source)
      if ("why" in got) {
        shares = { ...shares, refused: { dirs, why: got.why } }
        log(
          `[host] ${sharesWords({ kind: "no-slot", dirs: names, why: got.why })}`,
        )
      } else {
        shares = { ...shares, fills: [...shares.fills, got], refused: null }
        log(
          `[host] ${sharesWords({ kind: "widened", slot: got.slot, dirs: names })}`,
        )
      }
    }
    for (const w of plan.words) log(`[host] ${sharesWords(w)}`)
    if (plan.grant !== null) {
      // The grant replaces whatever a host of this project wrote before.
      await runtime.grantHostPorts(plan.grant)
      shares = { ...shares, granted: wanted.hostPorts }
      if (plan.grant.length > 0)
        log(
          `[host] lanes may reach these ports of your Mac's loopback, at ${GVPROXY_HOST_ADDRESS}: ${plan.grant.join(", ")}`,
        )
    }
  })

  const kept = keepLease({
    first,
    lease: leaseNow,
    // A new VM: its slot swept, and everything given shared and granted
    // again, as on the first lease. Each lane is made again at its next
    // start.
    async settle(next) {
      current = next
      const old = extras
      extras = []
      shares = NO_SHARES
      runtime.vmRestarted()
      for (const e of old) await e.close().catch(() => {})
      await sweep(next.slot)
      if (given !== null) await shareAndGrant(given)
    },
    log,
  })
  return {
    kind: "found",
    project,
    runtime,
    async ready({ mounts, hostPorts }) {
      runtime.serveFrom(mounts)
      await shareAndGrant({ mounts, hostPorts })
      sweptLog(await runtime.sweepProjects(), log)
    },
    shareAndGrant,
    async close() {
      for (const e of extras) await e.close().catch(() => {})
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
