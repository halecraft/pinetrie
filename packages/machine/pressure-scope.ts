// machine/pressure-scope — what a sample's memory pressure says, decided
// once. The kernel counts a task's stall in its own cgroup and in every
// ancestor, the root's included, so a cgroup thrashing at its own limit on
// an idle machine reads as high at the root as in itself. Only the
// machine's own reclaim tells that apart from the machine being short: a
// cgroup reclaiming at its own limit counts in none of its counters.

import type { MachineReclaim, Pressure } from "@pinetrie/core"
import { reclaimRise } from "./measurements.ts"
import type { MachineSample } from "./sample.ts"

/**
 * What a sample's pressure says, decided once: the machine short (its
 * own reclaim rose, or the machine is a host's own cgroup), a stall
 * contained in cgroups at their own limits, or which it is cannot be
 * read. The rung reads only this, never the raw pressure.
 */
export type PressureScope =
  | { readonly kind: "machine"; readonly pressure: Pressure }
  | { readonly kind: "contained"; readonly pressure: Pressure }
  | { readonly kind: "unmeasured" }

/**
 * A host in a lane's own cgroup is the machine its lanes share, so its
 * pressure is its shortage. On a whole machine, the pressure counts only
 * when tasks stalled to reclaim, or reclaim scanned for them, since the
 * last sample. With no reclaim to compare (a kernel without the counters,
 * or the first sample), it counts, as it did before the reclaim was read.
 */
export function pressureScope(input: {
  readonly machine: MachineSample["machine"]
  /** The reclaim the last sample read: its rise is this sample's. */
  readonly reclaimBefore: MachineReclaim | null
}): PressureScope {
  const { machine } = input
  const { pressure } = machine
  if (pressure === null) return { kind: "unmeasured" }
  if (machine.source === "own-cgroup") return { kind: "machine", pressure }
  const rise = reclaimRise(input.reclaimBefore, machine.reclaim)
  if (rise === null) return { kind: "machine", pressure }
  return rise.allocStalls > 0 || rise.scannedDirect > 0
    ? { kind: "machine", pressure }
    : { kind: "contained", pressure }
}
