// interface/machine — the machine's health in words: the footer's status,
// its title, and the host's log line, one wording for all three; and every
// size pine·trie words.

import {
  assertNever,
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
function serviceWords(service: MachineService): string {
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

/** One cause, as a clause. */
function causeWords(
  cause: MachineCause,
  nameOf: (lane: ThreadId) => string,
): string {
  switch (cause.kind) {
    case "room-low":
      return `the lanes' disk is low: ${sizeWords(cause.unallocated)} left, ${sizeWords(cause.minimum)} at least`
    case "room-spent":
      return `the lanes' disk is full: ${sizeWords(cause.unallocated)} left, and writes in lanes may fail`
    case "metadata-full":
      return `the lanes' disk has no room for more files: its metadata is ${percentWords((100 * cause.used) / Math.max(cause.total, 1))} full`
    case "filesystem-low":
      return `the disk holding the lanes is low: ${sizeWords(cause.free)} free, ${sizeWords(cause.leaveFree)} to leave`
    case "memory-stalls":
      return `lanes are short of memory: every task waited on it ${percentWords(cause.fullAvg10)} of the last 10 seconds`
    case "lane-oom-killed":
      return `a command in ${nameOf(cause.lane)} was killed for using too much memory`
    case "service-oom-killed":
      return `${serviceWords(cause.service)} was killed for using too much memory`
    case "host-stalls":
      return `the host stalled for ${(cause.stalledMs / 1000).toFixed(1)} seconds`
    case "unsampled":
      switch (cause.reason) {
        case "waiting":
          return "waiting for its first reading"
        case "stopped":
          return "the host has stopped"
        case "failed":
          return `it could not be read: ${cause.error ?? "no reason given"}`
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
  const how =
    worst.kind === "unsampled"
      ? ""
      : health.state === "red"
        ? "work is stopped: "
        : "work is slowed: "
  return `The machine lanes run on: ${how}${causeWords(worst, nameOf)}${more}`
}

/** What the footer's status draws: its state's mark, and its words. */
export interface MachineStatusView {
  readonly state: MachineState
  readonly text: string
}

/**
 * The footer's status. Before a host wrote the machine's health, or where
 * it runs no lanes and so reads no machine, it is neutral, and says so.
 */
export function machineStatus(
  health: MachineHealth | null,
  names: ReadonlyMap<ThreadId, ThreadName>,
): MachineStatusView {
  return health === null
    ? {
        state: "neutral",
        text: "The machine lanes run on: the host has said nothing of it",
      }
    : {
        state: health.state,
        text: machineWords(health, lane => readableThreadName(names, lane)),
      }
}
