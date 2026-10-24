// host/work/shares — what lanes of this host may mount and reach, shared into
// the lane VM's slots and granted in its firewall: the decision
// (`planShareAndGrant`, pure), and on the Mac the state it reads, held by one
// serial queue (`createShares`), so a new lease's reset never interleaves
// with a share still running.

import { createQueue, type Mount } from "@pinetrie/lanes"
import {
  type ExtraLease,
  GVPROXY_HOST_ADDRESS,
  type Holdings,
  holdFill,
  type Lease,
  NOTHING_HELD,
  planShares,
  planWidening,
  type ShareDir,
  sharePath,
} from "@pinetrie/vm"

/** What lanes of this host may mount, and the ports of the Mac's loopback they may reach. */
export interface Wanted {
  readonly mounts: readonly Mount[]
  readonly hostPorts: readonly number[]
}

/** What the host has shared and granted on its lease (on Linux, only what it said). */
export interface Shares {
  /** Whether the host's own slot is filled on this lease. */
  readonly filled: boolean
  /** Which of this lease's slots hold each source. */
  readonly held: Holdings
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
  filled: false,
  held: NOTHING_HELD,
  granted: null,
  refused: null,
  toldLinuxPorts: false,
}

/** What sharing and granting says, worded by `sharesWords`. */
type SharesWords =
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
  | { readonly kind: "granted"; readonly ports: readonly number[] }
  | { readonly kind: "own-port"; readonly port: number }
  | { readonly kind: "linux-ports" }

export function sharesWords(w: SharesWords): string {
  switch (w.kind) {
    case "widened":
      return `shared with lanes from their next start, through slot ${w.slot} of the lane VM: ${w.dirs.join(", ")}`
    case "no-slot":
      return `not shared with lanes until this host restarts, since the lane VM gave it no slot for them (${w.why}): ${w.dirs.join(", ")}`
    case "granted":
      return `lanes may reach these ports of your Mac's loopback, at ${GVPROXY_HOST_ADDRESS}: ${w.ports.join(", ")}`
    case "own-port":
      return `lanes.hostPorts ${w.port} is not granted: it is this pine·trie host's own port, which takes no key on loopback`
    case "linux-ports":
      return "lanes.hostPorts applies to the Mac's lane VM: on Linux a lane reaches the host's services bound to all interfaces, at Docker's bridge gateway"
  }
}

/** What to do for `wanted`, given what was shared and granted. */
interface SharesPlan {
  /** Directories to fill a slot with: the host's own first, then a new one. */
  readonly fill: {
    readonly into: "host" | "extra"
    readonly dirs: readonly ShareDir[]
  } | null
  /** The ports to write, replacing the last grant. */
  readonly grant: readonly number[] | null
  readonly words: readonly SharesWords[]
}

/** A set of directories as one string, the same whatever their order. */
const dirsKey = (dirs: readonly ShareDir[]) =>
  planShares(dirs)
    .map(e => `${e.readOnly ? "ro" : "rw"} ${e.source}`)
    .join("\n")

/**
 * On the Mac (`slots`): the host's slot is filled with every directory
 * first; after it, a directory no slot holds as wanted goes in a new slot,
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
  const widening = planWidening(shares.held, dirs)
  const fill = !shares.filled
    ? { into: "host" as const, dirs }
    : widening.length > 0 &&
        !(
          shares.refused !== null &&
          dirsKey(shares.refused.dirs) === dirsKey(widening)
        )
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

/** A host's slots of the lane VM, and its grant, as one value behind one queue. */
export interface HostShares {
  /** Share and grant `wanted`, after every call before it. */
  share(wanted: Wanted): Promise<void>
  /**
   * A new lease, after the VM stopped under the host: the old slots
   * dropped, then the last `wanted` shared and granted again, after every
   * call before it.
   */
  relet(lease: Lease): Promise<void>
  /** The host's own slot now. */
  slot(): number
  /** Where a source is in the VM; throws, worded, for one no slot holds. */
  pathOf(source: string): string
  /** Close the extra slots, after every call before it. */
  close(): Promise<void>
}

/**
 * The Mac's shares. Everything that changes them runs in one queue: a share
 * still running when the VM stopped finishes before `relet` drops its
 * result, and never writes into the new lease's state, whose host slot
 * would then stay unfilled.
 */
export function createShares(input: {
  readonly lease: Lease
  readonly ownPort: number | null
  /**
   * Stops what the last host left bound into a slot, before it is filled;
   * settles once each has died (`Lease.fill`).
   */
  readonly stop: (slot: number) => Promise<void>
  /** A new slot for `dirs`, its leftovers stopped, then filled. */
  readonly extra: (dirs: readonly ShareDir[]) => Promise<ExtraLease>
  /** Writes the grant, replacing the last. */
  readonly grant: (ports: readonly number[]) => Promise<void>
  /** Called in the queue as a new lease is taken, before anything is shared on it. */
  readonly relet: () => void
  readonly log: (line: string) => void
}): HostShares {
  const { stop, log } = input
  const queue = createQueue()
  let lease = input.lease
  let extras: ExtraLease[] = []
  let shares = NO_SHARES
  /** The last `wanted`, which a new lease shares again. */
  let given: Wanted | null = null
  const say = (w: SharesWords) => log(`[host] ${sharesWords(w)}`)

  async function shareNow(wanted: Wanted): Promise<void> {
    given = wanted
    const plan = planShareAndGrant(shares, wanted, input.ownPort, true)
    if (plan.fill?.into === "host") {
      const fill = await lease.fill(plan.fill.dirs, stop)
      shares = { ...shares, filled: true, held: holdFill(shares.held, fill) }
    } else if (plan.fill?.into === "extra") {
      const dirs = plan.fill.dirs
      const names = dirs.map(d => d.source)
      try {
        const extra = await input.extra(dirs)
        extras = [...extras, extra]
        shares = {
          ...shares,
          held: holdFill(shares.held, extra.fill),
          refused: null,
        }
        say({ kind: "widened", slot: extra.fill.slot, dirs: names })
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        shares = { ...shares, refused: { dirs, why } }
        say({ kind: "no-slot", dirs: names, why })
      }
    }
    for (const w of plan.words) say(w)
    if (plan.grant !== null) {
      await input.grant(plan.grant)
      shares = { ...shares, granted: wanted.hostPorts }
      if (plan.grant.length > 0) say({ kind: "granted", ports: plan.grant })
    }
  }

  async function closeExtras(): Promise<void> {
    const old = extras
    extras = []
    for (const e of old) await e.close().catch(() => {})
  }

  return {
    share: wanted => queue.enqueue(() => shareNow(wanted)),
    relet: next =>
      queue.enqueue(async () => {
        lease = next
        shares = NO_SHARES
        input.relet()
        await closeExtras()
        if (given !== null) await shareNow(given)
      }),
    slot: () => lease.slot,
    pathOf(source) {
      if (!shares.filled)
        throw new Error("this host's slot in the lane VM is not filled yet")
      try {
        return sharePath(shares.held, source)
      } catch (error) {
        const { refused } = shares
        if (refused?.dirs.some(d => d.source === source))
          throw new Error(
            sharesWords({ kind: "no-slot", dirs: [source], why: refused.why }),
          )
        throw error
      }
    },
    close: () => queue.enqueue(closeExtras),
  }
}
