// stop — who stopped an ask's run (ADR-0106), and carrying on after it
// (ADR-0082). pi's entries say that a run was aborted, never by whom (S70),
// so the host records it under the ask's prompt as it asks pi to abort
// (`planStop`). The first press is the one recorded: `planStop` writes no
// second.
//
// pi cannot continue a run Stop ended (S105), so carrying on is a new run
// whose prompt is a carry-on message, a history message (`history.ts`):
// `content` is what the model reads, `details` what the column shows.
// `carryOnState` is the one rule for when a lane may carry on, read by the
// host's `planCarryOn` and the dock's `nextOf` (`@pinetrie/interface`).

import {
  type AskIndex,
  askOutcome,
  type EntryId,
  ERR,
  type ErrCode,
  isBusy,
  type LaneView,
  promptOf,
  type QueueHold,
  type Refusal,
  refused,
  type StopRecord,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import type { QueuedCard } from "./card.ts"
import { decodeAt, entryKey, ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { holdOnStop } from "./queue-hold.ts"
import type { RecordSpec } from "./records.ts"

const StopSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** Each ask's stop, at its prompt's entry id. */
export const STOP: RecordSpec<StopRecord, EntryId, "root"> = {
  namespace: "pinetrie.stop",
  home: "root",
  keyOf: r => r.prompt,
  encode: ({ prompt, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(StopSchema, contents, entryKey(key), (r, prompt) => ({
      prompt,
      by: r.by as WriterId,
      at: r.at,
    })),
}

/** What stopping a thread's lane does (`planStop`). */
type StopPlan =
  | {
      readonly kind: "abort"
      /** Who stopped the ask; null when it is recorded already. */
      readonly record: StopRecord | null
      /** The hold it leaves on the queue (`holdOnStop`); null for none. */
      readonly hold: QueueHold | null
    }
  | { readonly kind: "idle" }

/**
 * What stopping a thread's lane does: abort its running turn, recording who
 * stopped its ask (ADR-0106), unless someone's stop is recorded already, so
 * the first press is the one named; and hold its queue when a message card
 * waits there, so the run's end does not send the next one (ADR-0048 step
 * 7). Nothing when it is idle (stopping is idempotent). Pure.
 */
export function planStop(
  lane: LaneView,
  facts: {
    readonly index: TreeIndex
    readonly stops: ReadonlyMap<EntryId, StopRecord>
    /** The lane's queue, in order. */
    readonly queue: readonly QueuedCard[]
    readonly holds: ReadonlyMap<ThreadId, QueueHold>
    readonly by: WriterId
    readonly now: number
  },
): StopPlan {
  if (!lane.running) return { kind: "idle" }
  const prompt = promptOf(facts.index, lane.tip)
  return {
    kind: "abort",
    record:
      prompt === null || facts.stops.has(prompt)
        ? null
        : { prompt, by: facts.by, at: facts.now },
    hold: holdOnStop({ ...facts, lane: lane.name }),
  }
}

// ── carrying on (ADR-0082) ───────────────────────────────────────────────

const CARRY_ON_TYPE = "pinetrie.carry-on"

const CarryOnDetailsSchema = Type.Object({
  lane: ThreadIdSchema,
  by: WriterIdSchema,
  /** Who resumed, as named when they did: the column's line shows it. */
  name: Type.String(),
})

type CarryOnDetails = Static<typeof CarryOnDetailsSchema>

export const CARRY_ON = historyMessage(CARRY_ON_TYPE, CarryOnDetailsSchema)

/** The pi `CustomMessage` a carry-on's prompt is stored as. */
export type CarryOnMessage = HistoryMessage<
  typeof CARRY_ON_TYPE,
  CarryOnDetails
>

/** A stored message -> its carry-on details, or undefined if it is not one. */
export const decodeCarryOn = CARRY_ON.decode

/** The one line a column shows for a carry-on message. */
export const carryOnLine = (d: CarryOnDetails): string =>
  `↻ resumed by ${d.name}`

export type CarryOnState =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: ErrCode }

const OK: CarryOnState = { kind: "ok" }
const refusedFor = (code: ErrCode): CarryOnState => ({ kind: "refused", code })

/**
 * Whether `lane` may carry on: it is not running, has no cards waiting
 * unless its queue is held, and the ask at its tip ended stopped. A message written after the stop is the tip's ask, with no work,
 * so it refuses; an update is no ask, so it does not. Pure.
 */
export function carryOnState(
  lane: LaneView,
  facts: { readonly index: TreeIndex; readonly asks: AskIndex },
): CarryOnState {
  if (lane.tip === null) return refusedFor(ERR.UNKNOWN_TARGET)
  // A held queue waits for a release, not for this turn (ADR-0048 step 7).
  if (lane.running || (isBusy(lane) && lane.heldBy === null))
    return refusedFor(ERR.BUSY)
  const prompt = promptOf(facts.index, lane.tip)
  if (prompt === null) return refusedFor(ERR.REFUSED)
  const outcome = askOutcome(facts.index, facts.asks, prompt, {
    running: false,
    stop: undefined,
  })
  return outcome.kind === "stopped" ? OK : refusedFor(ERR.REFUSED)
}

/** A carry-on refused with `code`, worded once. */
function refusedCarryOn(code: ErrCode): Refusal {
  switch (code) {
    case ERR.UNKNOWN_TARGET:
      return refused(code, "no such thread to resume")
    case ERR.BUSY:
      return refused(code, "the thread is working")
    default:
      return refused(code, "the thread's last turn was not stopped")
  }
}

/**
 * What carrying on a lane does: a run whose prompt is a carry-on message,
 * or the refusal `carryOnState` gives; refused for a lane no root holds
 * (`here` null). Pure.
 */
export function planCarryOn(
  here: {
    readonly lane: LaneView
    readonly index: TreeIndex
    readonly asks: AskIndex
  } | null,
  who: {
    readonly by: WriterId
    readonly name: string
    readonly timestamp: number
  },
): { readonly kind: "start"; readonly message: CarryOnMessage } | Refusal {
  if (here === null) return refusedCarryOn(ERR.UNKNOWN_TARGET)
  const state = carryOnState(here.lane, here)
  if (state.kind === "refused") return refusedCarryOn(state.code)
  return {
    kind: "start",
    message: CARRY_ON.encode(
      { lane: here.lane.name, by: who.by, name: who.name },
      `${who.name} asked you to carry on from where you were stopped. ` +
        "Anything you were writing when you were stopped was not kept.",
      who.timestamp,
    ),
  }
}
