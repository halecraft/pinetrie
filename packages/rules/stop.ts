// stop — who stopped an ask's run, and carrying on after it.

import {
  type AskIndex,
  type AskOutcome,
  askOutcome,
  type CardRecord,
  type EntryId,
  ERR,
  type ErrCode,
  type FactCardId,
  indexAsks,
  isBusy,
  type LaneView,
  type Refusal,
  refused,
  runPrompt,
  type ThreadId,
  type TreeIndex,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { displayName } from "./participant.ts"
import type { PlaceStep } from "./place-steps.ts"
import { planFactCard, type QueuedCard, queuedOn } from "./queue.ts"
import { holdOnStop, QUEUE_HOLD, type QueueHold } from "./queue-hold.ts"
import { setRecord } from "./records.ts"

/** What stopping a thread's lane does (`planStop`). */
type StopPlan =
  | {
      readonly kind: "abort"
      /**
       * The stop's fact card, queued first (`planFactCard`); empty when
       * someone's stop is named already, or none of its ask is known.
       */
      readonly fact: readonly PlaceStep[]
      /** The hold it leaves on the queue (`holdOnStop`), as its write; none for none. */
      readonly writes: readonly ValueWrite<"session">[]
    }
  | { readonly kind: "idle" }

/** Who stopped `prompt`'s run, by a stop's fact queued on its lane and not yet appended. */
const queuedStopper = (
  queue: readonly QueuedCard[],
  prompt: EntryId,
): WriterId | null => {
  for (const c of queue)
    if (
      c.kind === "fact" &&
      c.content.fact.kind === "stopped" &&
      c.content.fact.prompt === prompt
    )
      return c.content.fact.by
  return null
}

/**
 * What stopping a thread's lane does: abort its running turn, queueing a
 * fact that names who stopped its ask, unless a stop of
 * it is queued already or the thread names its stopper, so the first press
 * is the one named; and hold its queue when a message card waits there, so
 * the run's end does not send the next one. The fact goes
 * before the cards queued, and the run's end pops it whatever the hold.
 * Nothing when it is idle (stopping is idempotent). A spent budget stops a
 * run too: its fact names the budget, and it holds no queue,
 * which is the stopped thread's own people's.
 */
export function planStop(
  lane: LaneView,
  facts: {
    readonly index: TreeIndex
    readonly cards: readonly CardRecord[]
    readonly holds: ReadonlyMap<ThreadId, QueueHold>
    readonly by: WriterId
    readonly now: number
    /** The id its fact card would have. */
    readonly id: FactCardId
    /** The spent budget's message, for a stop the budget made; absent for a person's. */
    readonly budget?: EntryId
  },
): StopPlan {
  if (!lane.running) return { kind: "idle" }
  const queue = queuedOn(facts.cards, lane.name)
  const hold =
    facts.budget === undefined
      ? holdOnStop({
          queue,
          holds: facts.holds,
          by: facts.by,
          now: facts.now,
          lane: lane.name,
        })
      : null
  const prompt = runPrompt(facts.index, lane.tip)
  const named =
    prompt === null ||
    indexAsks(facts.index).stoppedBy.has(prompt) ||
    queuedStopper(queue, prompt) !== null
  return {
    kind: "abort",
    fact: named
      ? []
      : (planFactCard({
          cards: facts.cards,
          id: facts.id,
          fact: {
            kind: "stopped",
            lane: lane.name,
            prompt,
            by: facts.by,
            at: facts.now,
            ...(facts.budget === undefined ? {} : { budget: facts.budget }),
          },
        }) ?? []),
    writes: hold === null ? [] : [setRecord(QUEUE_HOLD, hold)],
  }
}

/**
 * Who stopped `prompt`'s run: its stop's fact, appended
 * (`stoppedBy`), or still queued on its lane, as it is from Stop until the
 * run's end appends it; null for nobody named.
 */
export const runStopper = (
  asks: AskIndex,
  queue: readonly QueuedCard[],
  prompt: EntryId,
): WriterId | null => asks.stoppedBy.get(prompt) ?? queuedStopper(queue, prompt)

/**
 * How `prompt`'s run ended, as its run's end reads it: who stopped it named
 * by `runStopper`, since its fact is still queued then.
 */
export function endedOutcome(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  queue: readonly QueuedCard[],
): AskOutcome {
  const outcome = askOutcome(index, asks, prompt, { running: false })
  return outcome.kind === "stopped"
    ? { kind: "stopped", by: runStopper(asks, queue, prompt) }
    : outcome
}

// ── carrying on ───────────────────────────────────────────────

export const CARRY_ON_TYPE = "pinetrie.carry-on"

const CarryOnDetailsSchema = Type.Object({
  lane: ThreadIdSchema,
  by: WriterIdSchema,
  /** Who resumed, as named when they did: the column's line shows it. */
  name: Type.String(),
  /** Why: a stopped run carried on, or the owner's ssh allowed, which wakes the lane. */
  reason: Type.Union([
    Type.Object({ kind: Type.Literal("stopped") }),
    Type.Object({
      kind: Type.Literal("ssh-allowed"),
      host: Type.Union([Type.String(), Type.Null()]),
    }),
  ]),
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

/** The line a column shows for a carry-on message, with why when it is not a stop. */
export const carryOnLine = (d: CarryOnDetails): string =>
  d.reason.kind === "stopped"
    ? `↻ resumed by ${d.name}`
    : `↻ resumed by ${d.name}: allowed ssh for ${d.reason.host ?? "a host"}`

type CarryOnState =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: ErrCode }

const OK: CarryOnState = { kind: "ok" }
const refusedFor = (code: ErrCode): CarryOnState => ({ kind: "refused", code })

/**
 * Whether `lane` may carry on: it is not running, has no cards waiting
 * unless its queue is held, and the ask at its tip ended stopped. A stop's
 * fact at the tip is no ask (`runPrompt` passes it), so the stopped ask is
 * still found. A message written after the stop is the tip's ask, with no
 * work, so it refuses; an update is no ask, so it does not.
 */
export function carryOnState(
  lane: LaneView,
  facts: { readonly index: TreeIndex; readonly asks: AskIndex },
): CarryOnState {
  if (lane.tip === null) return refusedFor(ERR.UNKNOWN_TARGET)
  // A held queue waits for a release, not for this turn.
  if (lane.running || (isBusy(lane) && lane.heldBy === null))
    return refusedFor(ERR.BUSY)
  const prompt = runPrompt(facts.index, lane.tip)
  if (prompt === null) return refusedFor(ERR.REFUSED)
  const outcome = askOutcome(facts.index, facts.asks, prompt, {
    running: false,
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
 * (`here` null).
 */
export function planCarryOn(
  here: {
    readonly lane: LaneView
    readonly index: TreeIndex
  } | null,
  who: {
    readonly by: WriterId
    /** Each participant's display name as set; one unset is read from the writer. */
    readonly names: ReadonlyMap<WriterId, string>
    readonly timestamp: number
  },
): { readonly kind: "start"; readonly message: CarryOnMessage } | Refusal {
  if (here === null) return refusedCarryOn(ERR.UNKNOWN_TARGET)
  const state = carryOnState(here.lane, {
    ...here,
    asks: indexAsks(here.index),
  })
  const name = displayName(who.by, who.names.get(who.by))
  if (state.kind === "refused") return refusedCarryOn(state.code)
  return {
    kind: "start",
    message: CARRY_ON.encode(
      {
        lane: here.lane.name,
        by: who.by,
        name,
        reason: { kind: "stopped" },
      },
      `${name} asked you to carry on from where you were stopped. ` +
        "Anything you were writing when you were stopped was not kept.",
      who.timestamp,
    ),
  }
}
