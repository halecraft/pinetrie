// machine/repair — the lane VM's repair as states, one table of the moves
// between them, and the reducer, with how the shared state reads. The
// state is the one every host on the VM shares (`repair.state`, written by
// the repair lock's holder alone), read each sample: a failure one host
// records stops every host's repair, and a host's start does not pass it.

import type { MachineCause } from "@pinetrie/core"
import { ROOM_SPENT, ROOM_SPENT_CLEAR } from "./health.ts"
import type { MachineSample } from "./sample.ts"

export type RepairTrigger =
  | "room-spent-and-nothing-to-delete"
  | "disk-full-at-boot"

/** What the reducer keeps of a repair boot's report: the host maps the VM's into it. */
export interface RepairOutcome {
  readonly leftUnallocated: number | null
  readonly leftMetadata: { readonly size: number; readonly used: number } | null
  readonly failed: string | null
}

export type RepairState =
  | { readonly kind: "idle" }
  | { readonly kind: "detected"; readonly trigger: RepairTrigger }
  | { readonly kind: "stopping-vm" }
  | { readonly kind: "booting-repair"; readonly progress: readonly string[] }
  | { readonly kind: "done"; readonly outcome: RepairOutcome }
  | {
      readonly kind: "failed"
      readonly why: string
      /** The disk's size when it failed: a repair is tried again only when it could grow past it. */
      readonly sizeAtFailure: number
    }

export type RepairEvent =
  | {
      readonly kind: "trigger"
      readonly trigger: RepairTrigger
      /** What the disk would grow to now (`plannedStoreSize`). */
      readonly plannedSize: number
    }
  | { readonly kind: "stopping" }
  | { readonly kind: "stopped" }
  | { readonly kind: "progress"; readonly line: string }
  | {
      readonly kind: "booted"
      readonly outcome: RepairOutcome
      readonly size: number
    }
  | { readonly kind: "broke"; readonly why: string; readonly size: number }

/** Where each state may go: the reducer refuses any other move. */
export const REPAIR_NEXT = {
  idle: ["detected"],
  detected: ["stopping-vm", "failed"],
  "stopping-vm": ["booting-repair", "failed"],
  "booting-repair": ["booting-repair", "done", "failed"],
  done: ["detected"],
  failed: ["detected"],
} as const satisfies Record<RepairState["kind"], readonly RepairState["kind"][]>

export const REPAIR_IDLE: RepairState = { kind: "idle" }

/** The states a repair is under way in. */
const RUNNING: ReadonlySet<RepairState["kind"]> = new Set([
  "detected",
  "stopping-vm",
  "booting-repair",
])

export const STILL_FULL_WORDS =
  "repaired, but the disk is still nearly full: the store's settings allow it no more room"

/**
 * Whether what a repair left is no longer spent, by the health value's own
 * clear, so the next sample does not read it spent. Metadata's share is
 * not asked: with unallocated room btrfs gives metadata another chunk, and
 * the health value counts metadata full only without that room. A disk
 * that refused every write read its metadata 91% used, so a share asked
 * here would fail every repair, however much room it gained.
 */
const isRoomRegained = (outcome: RepairOutcome): boolean =>
  outcome.leftUnallocated !== null &&
  outcome.leftUnallocated >= ROOM_SPENT_CLEAR

/** The state `event` would make of `state`, before the table is asked. */
function proposed(state: RepairState, event: RepairEvent): RepairState | null {
  switch (event.kind) {
    case "trigger":
      // Leaving a failure takes a change that could succeed: room to grow
      // past the size it failed at.
      return state.kind === "failed" && event.plannedSize <= state.sizeAtFailure
        ? null
        : { kind: "detected", trigger: event.trigger }
    case "stopping":
      return { kind: "stopping-vm" }
    case "stopped":
      return { kind: "booting-repair", progress: [] }
    case "progress":
      return state.kind === "booting-repair"
        ? { kind: "booting-repair", progress: [...state.progress, event.line] }
        : null
    case "booted":
      if (event.outcome.failed !== null)
        return {
          kind: "failed",
          why: event.outcome.failed,
          sizeAtFailure: event.size,
        }
      return isRoomRegained(event.outcome)
        ? { kind: "done", outcome: event.outcome }
        : { kind: "failed", why: STILL_FULL_WORDS, sizeAtFailure: event.size }
    case "broke":
      return { kind: "failed", why: event.why, sizeAtFailure: event.size }
  }
}

/** `state` after `event`; a move `REPAIR_NEXT` does not allow leaves it as it was. */
export function nextRepairState(
  state: RepairState,
  event: RepairEvent,
): RepairState {
  const next = proposed(state, event)
  if (next === null) return state
  const allowed: readonly RepairState["kind"][] = REPAIR_NEXT[state.kind]
  return allowed.includes(next.kind) ? next : state
}

export const encodeRepairState = (state: RepairState): string =>
  `${JSON.stringify(state)}\n`

const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === "string"
const isNumberOrNull = (v: unknown) => v === null || isNumber(v)

function isOutcome(v: unknown): v is RepairOutcome {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  const m = o.leftMetadata as Record<string, unknown> | null | undefined
  return (
    isNumberOrNull(o.leftUnallocated) &&
    (m === null ||
      (typeof m === "object" &&
        m !== undefined &&
        isNumber(m.size) &&
        isNumber(m.used))) &&
    (o.failed === null || isText(o.failed))
  )
}

const TRIGGERS: readonly unknown[] = [
  "room-spent-and-nothing-to-delete",
  "disk-full-at-boot",
] satisfies readonly RepairTrigger[]

/**
 * The shared state's text as a state: none written is `idle`; text that is
 * no state (a crashed writer's, another version's) is `unreadable`.
 */
export function decodeRepairState(
  text: string | null,
): RepairState | "unreadable" {
  if (text === null) return REPAIR_IDLE
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return "unreadable"
  }
  if (typeof v !== "object" || v === null) return "unreadable"
  const s = v as Record<string, unknown>
  switch (s.kind) {
    case "idle":
    case "stopping-vm":
      return { kind: s.kind }
    case "detected":
      return TRIGGERS.includes(s.trigger)
        ? { kind: "detected", trigger: s.trigger as RepairTrigger }
        : "unreadable"
    case "booting-repair":
      return Array.isArray(s.progress) && s.progress.every(isText)
        ? { kind: "booting-repair", progress: s.progress }
        : "unreadable"
    case "done":
      return isOutcome(s.outcome)
        ? { kind: "done", outcome: s.outcome }
        : "unreadable"
    case "failed":
      return isText(s.why) && isNumber(s.sizeAtFailure)
        ? { kind: "failed", why: s.why, sizeAtFailure: s.sizeAtFailure }
        : "unreadable"
    default:
      return "unreadable"
  }
}

/** What a host read: whether anyone holds the repair lock, and the shared state's text. */
export interface RepairRead {
  readonly lockHeld: boolean
  readonly text: string | null
}

/**
 * The repair as every host reads it. `interrupted`: a running state found
 * with the lock free (its holder died mid-repair), or a state no host can
 * read; unsure, it holds no lane and its triggers are read afresh, never
 * taken as done.
 */
export interface RepairFacts {
  readonly lockHeld: boolean
  readonly state: RepairState | "interrupted"
}

export function repairFacts(read: RepairRead): RepairFacts {
  const state = decodeRepairState(read.text)
  if (state === "unreadable")
    return { lockHeld: read.lockHeld, state: "interrupted" }
  return {
    lockHeld: read.lockHeld,
    state: RUNNING.has(state.kind) && !read.lockHeld ? "interrupted" : state,
  }
}

/** No repair, as on Linux, or before any was read. */
export const NO_REPAIR: RepairFacts = { lockHeld: false, state: REPAIR_IDLE }

/**
 * Whether a repair is under way: the lock held *and* a running state. A
 * held lock with any other state is a VM's start, which holds it too.
 */
export const isRepairRunning = (facts: RepairFacts): boolean =>
  facts.lockHeld &&
  facts.state !== "interrupted" &&
  RUNNING.has(facts.state.kind)

/** The state the reducer starts from: an interrupted repair's is `idle`, its triggers read afresh. */
export const repairStateNow = (facts: RepairFacts): RepairState =>
  facts.state === "interrupted" ? REPAIR_IDLE : facts.state

/**
 * Whether a sample calls for a repair while the host runs: nothing left
 * to delete, and the store spent. Never `room-unrecoverable` alone, which
 * holds while gigabytes remain. Metadata full is spent too: the health
 * value counts it full only with no room left to grow it.
 */
export function isRepairCalledFor(sample: MachineSample): boolean {
  const { store } = sample
  return (
    store !== null && sample.upkeep.exhausted && store.unallocated < ROOM_SPENT
  )
}

/** What the repair adds to the health value: red while it runs, and after it failed. */
export function repairCause(facts: RepairFacts): MachineCause | null {
  if (facts.state === "interrupted") return null
  if (isRepairRunning(facts))
    return {
      kind: "disk-being-repaired",
      step: facts.state.kind as "detected" | "stopping-vm" | "booting-repair",
      progress:
        facts.state.kind === "booting-repair"
          ? (facts.state.progress.at(-1) ?? null)
          : null,
    }
  return facts.state.kind === "failed"
    ? { kind: "disk-repair-failed", why: facts.state.why }
    : null
}
