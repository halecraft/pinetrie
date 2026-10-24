// interface/machine — the machine's health in words: the footer's status,
// its title, and the host's log line, one wording for all three; and every
// size pine·trie words.

import {
  assertNever,
  type LaneTreatment,
  type MachineCause,
  type MachineHealth,
  type MachineService,
  type MachineState,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { readableThreadName } from "@pinetrie/rules"

const UNITS = ["KB", "MB", "GB", "TB"] as const

/**
 * `bytes` as people read a size: binary, as the sizes pine·trie reads are,
 * written `KB` to `TB`, with one decimal under 10 (`6.5 GB`, `29 GB`).
 */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} bytes`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const shown =
    value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)
  return `${shown} ${UNITS[unit]}`
}

/** A share of 100, as a percentage with no decimals. */
const percentWords = (share: number) => `${Math.round(share)}%`

/** A service, as the subject of a clause. */
export function serviceWords(service: MachineService): string {
  switch (service) {
    case "disks":
      return "lanehost's disk service"
    case "privileged":
      return "lanehost's privileged service"
    case "observer":
      return "the file observer"
    default:
      return assertNever(service)
  }
}

/**
 * Memory short, by what the host does of it: observing, nothing; holding,
 * the threads it holds (`held`), or what it would hold at this rung.
 */
function memoryShortWords(
  cause: Extract<MachineCause, { kind: "memory-short" }>,
  held: number,
): string {
  if (!cause.isHolding) return "memory is short"
  if (held === 1) return "memory is short: 1 thread waits for room"
  if (held > 1) return `memory is short: ${held} threads wait for room`
  return cause.rung >= 3
    ? "memory is short: only the threads that matter most make tool calls"
    : "memory is short: new runs wait for room"
}

/**
 * The lane VM's repair as it runs, for the footer and a start's
 * checklist alike: the step it is at, and the repair boot's last line.
 */
export function repairProgressWords(
  step: Extract<MachineCause, { kind: "disk-being-repaired" }>["step"],
  progress: string | null,
): string {
  switch (step) {
    case "detected":
      return "the lane VM's disk is full: repairing it"
    case "stopping-vm":
      return "the lane VM's disk is full: repairing it, the lane VM stopping"
    case "booting-repair":
      return progress === null
        ? "the lane VM's disk is full: repairing it"
        : `the lane VM's disk is full: repairing it (${progress.replace(/^\[repair\] /, "")})`
    default:
      return assertNever(step)
  }
}

/** A repair of the lane VM's disk that failed, with what would let it be tried again. */
export const repairFailedWords = (why: string): string =>
  `the lane VM's disk could not be repaired: ${why}; it is tried again once the disk could grow: raise \`lanes.store.max\`, or free the Mac's disk`

/** Why a host's start of the lane VM waits: another host's repair of its disk, or its start. */
export const vmStartWaitWords = (isRepairing: boolean): string =>
  isRepairing
    ? "waiting for the lane VM: another host is repairing its disk"
    : "waiting for the lane VM: another host is starting it"

/** One cause, as a clause; `held` counts the lanes held for memory. */
export function causeWords(
  cause: MachineCause,
  nameOf: (lane: ThreadId) => string,
  held: number,
): string {
  switch (cause.kind) {
    case "room-low":
      return `the lanes' disk is low: ${sizeWords(cause.unallocated)} left, ${sizeWords(cause.minimum)} at least${cause.grows ? "; it grows when the lane VM next starts" : ""}`
    case "room-spent":
      return `the lanes' disk is full: ${sizeWords(cause.unallocated)} left, and writes in lanes may fail`
    case "metadata-full":
      return `the lanes' disk has no room for more files: its metadata is ${percentWords((100 * cause.used) / Math.max(cause.total, 1))} full`
    case "filesystem-low":
      return `the disk holding the lanes is low: ${sizeWords(cause.free)} free, ${sizeWords(cause.leaveFree)} to leave`
    case "memory-short":
      return memoryShortWords(cause, held)
    case "lane-oom-killed":
      return `a command in ${nameOf(cause.lane)} was killed for using too much memory`
    case "service-oom-killed":
      return `${serviceWords(cause.service)} was killed for using too much memory`
    case "host-stalls":
      return `the host stalled for ${(cause.stalledMs / 1000).toFixed(1)} seconds`
    case "freeing-room":
      return "the lanes' disk is low: old turns' snapshots are being deleted to free room"
    case "room-unrecoverable":
      return `the lanes' disk is low, and nothing is left that may be deleted: ${sizeWords(cause.unallocated)} left, ${sizeWords(cause.minimum)} at least${cause.isRepaired ? "" : "; `btrfs balance start -dusage=10` on the lanes' directory may free room"}`
    case "disk-being-repaired":
      return repairProgressWords(cause.step, cause.progress)
    case "disk-repair-failed":
      return repairFailedWords(cause.why)
    case "snapshot-skipped":
      return cause.count === 1
        ? "a turn's snapshot could not be recorded: branching at it starts from the turn before"
        : `${cause.count} turns' snapshots could not be recorded: branching at them starts from the turn before`
    case "unsampled":
      switch (cause.reason) {
        case "waiting":
          return "waiting for its first reading"
        case "stopped":
          return "the host has stopped"
        case "failed":
          return `it could not be read: ${cause.error ?? "no reason given"}`
        case "overdue":
          return "the machine has not been read for a while: nothing is held"
        default:
          return assertNever(cause.reason)
      }
    default:
      return assertNever(cause)
  }
}

/**
 * The machine's health in words, the status's accessible name and title and
 * the host's log line alike: keeping up, or its worst cause, and how many
 * more. `nameOf` names a thread's lane.
 */
export function machineWords(
  health: MachineHealth,
  nameOf: (lane: ThreadId) => string,
): string {
  const [worst, ...rest] = health.causes
  if (health.state === "neutral" || worst === undefined)
    return "The machine lanes run on: keeping up"
  const more = rest.length === 0 ? "" : `; and ${rest.length} more`
  // A reading not taken, or a snapshot not recorded, slows no work.
  const how =
    worst.kind === "unsampled" || worst.kind === "snapshot-skipped"
      ? ""
      : health.state === "red"
        ? "work is stopped: "
        : "work is slowed: "
  const heldForMemory = health.treatments.filter(
    t => t.treatment.kind !== "waiting-for-repair",
  ).length
  return `The machine lanes run on: ${how}${causeWords(worst, nameOf, heldForMemory)}${more}`
}

/** Why a held lane waits, as its column says it; null for one not held. */
export function treatmentWords(treatment: LaneTreatment): string | null {
  switch (treatment.kind) {
    case "normal":
      return null
    case "waiting-to-start":
      return "waits for room on the machine to start"
    case "paused":
      return "paused for memory: its next tool call waits for room"
    case "waiting-for-repair":
      return "waits while the lane VM's disk is repaired"
    default:
      return assertNever(treatment.kind)
  }
}

/** Each lane the machine holds, and how, from its health as the host last wrote it. */
export function heldLaneTreatments(
  health: MachineHealth | null,
): ReadonlyMap<ThreadId, LaneTreatment> {
  return new Map((health?.treatments ?? []).map(t => [t.lane, t.treatment]))
}

/** What the footer's status draws: its state's mark, its words, and its name, which says it opens the Machine page. */
export interface MachineStatusView {
  readonly state: MachineState
  readonly text: string
  readonly name: string
}

/** The footer's status's name: its words, and where pressing it goes. */
const statusName = (text: string) => `${text}. Open the Machine page`

/**
 * The footer's status. Before a host wrote the machine's health, or where
 * it runs no lanes and so reads no machine, it is neutral, and says so.
 */
export function machineStatus(
  health: MachineHealth | null,
  names: ReadonlyMap<ThreadId, ThreadName>,
): MachineStatusView {
  const view =
    health === null
      ? {
          state: "neutral" as const,
          text: "The machine lanes run on: the host has said nothing of it",
        }
      : {
          state: health.state,
          text: machineWords(health, lane => readableThreadName(names, lane)),
        }
  return { ...view, name: statusName(view.text) }
}
