// queue-hold — a thread's queue held (ADR-0048 step 7): who holds it, a hold
// or a release, the hold a Stop leaves, and the holds the host sweeps.
//
// While a lane's queue is held, the host pops no message card from it, only
// facts (`planNextQueuedCardPop`, `card.ts`). So people can line up several
// cards on an idle thread and let them go together. A send there queues
// (`sendWaits`, @pinetrie/core) and, on an idle thread, releases the hold
// with it (`planQueueCard`, ADR-0113): sending removes the hold. The hold
// is a session record, so it outlasts a restart: a queue staged overnight
// must not drain when the host starts.

import type {
  CardCommand,
  CardRecord,
  Move,
  QueueHold,
  QueueHoldChange,
  TaskId,
  ThreadId,
  ValueWrite,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import {
  type MovesStep,
  NO_DISCARDS,
  planMoveCommand,
  type QueuedCard,
} from "./card.ts"
import { decodeAt, threadKey } from "./decode.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

const QueueHoldSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** Each held queue, at its lane. */
export const QUEUE_HOLD: RecordSpec<QueueHold, ThreadId, "session"> = {
  namespace: "pinetrie.queue-hold",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(QueueHoldSchema, contents, threadKey(key), (r, lane) => ({
      lane,
      by: r.by as WriterId,
      at: r.at,
    })),
}

/**
 * Hold a lane's queue, or release it. A hold is written only where there is
 * none, so the first holder stays named; a release deletes it. Nothing,
 * either way, when the queue is already so. Pure.
 */
export function planQueueHold(input: {
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  readonly lane: ThreadId
  readonly by: WriterId
  readonly now: number
  readonly held: boolean
}): readonly ValueWrite[] {
  const { holds, lane } = input
  const there = holds.has(lane)
  if (input.held === there) return []
  return input.held
    ? [setRecord(QUEUE_HOLD, { lane, by: input.by, at: input.now })]
    : [deleteRecord(QUEUE_HOLD, lane)]
}

/**
 * A card queued, and its queue's hold changed with it (ADR-0113): the move
 * planned as any move is (`planMoveCommand`), and, only when it is
 * accepted, the hold's writes. The hold goes first when the host carries it
 * out, so the drain the move asks for finds the queue as this says: held
 * before a staged card can be popped, released before the drain. A move
 * that queues nothing changes no hold. A card created in the queue carries
 * `command` from its first write: a command set by a later request could
 * come after the drain popped the card. Pure.
 */
export function planQueueCard(input: {
  readonly cards: readonly CardRecord[]
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  readonly move: Move
  readonly hold: QueueHoldChange
  /** The created card's command; ignored for a card that exists. */
  readonly command: CardCommand | null
  readonly by: WriterId
  readonly now: number
  readonly running: (lane: ThreadId) => boolean
}): {
  readonly step: MovesStep
  readonly drain: readonly ThreadId[]
  readonly holds: readonly ValueWrite[]
} {
  const { move, hold } = input
  // A queueing discards nothing: its target is a queue.
  const planned = planMoveCommand(
    input.cards,
    [move],
    input.by,
    input.running,
    NO_DISCARDS,
  )
  const { drain } = planned
  const step =
    move.from === null && input.command !== null
      ? withCommand(planned.step, input.command)
      : planned.step
  if (step.kind === "refused" || move.to.kind !== "queued" || hold === "keep")
    return { step, drain, holds: [] }
  const lane = move.to.thread
  const held = hold === "hold-if-idle"
  if (held && input.running(lane)) return { step, drain, holds: [] }
  const holds = planQueueHold({
    holds: input.holds,
    lane,
    by: input.by,
    now: input.now,
    held,
  })
  return { step, drain, holds }
}

/** A creation's write, carrying `command`. */
const withCommand = (step: MovesStep, command: CardCommand): MovesStep =>
  step.kind === "refused"
    ? step
    : {
        kind: "steps",
        steps: step.steps.map(s =>
          s.kind === "write" &&
          s.record.kind === "text" &&
          s.record.carries.kind === "message"
            ? {
                kind: "write",
                record: { ...s.record, carries: { kind: "message", command } },
              }
            : s,
        ),
      }

/**
 * The hold a Stop leaves on its lane's queue: one when a message card is
 * queued and nobody holds the queue yet. A Stop with nothing queued holds
 * nothing, or the correction sent after it would be held too. Pure.
 */
export function holdOnStop(input: {
  readonly queue: readonly QueuedCard[]
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  readonly lane: ThreadId
  readonly by: WriterId
  readonly now: number
}): QueueHold | null {
  const { lane } = input
  if (input.holds.has(lane)) return null
  return input.queue.some(c => c.carries.kind === "message")
    ? { lane, by: input.by, at: input.now }
    : null
}

/**
 * The holds to delete: each whose lane's thread has no card, or whose card
 * is in an archived task (ADR-0116). A thread in an inventory keeps its
 * hold. Archiving is refused while cards are queued, so a hold swept holds
 * nothing. Pure.
 */
export function planHoldSweep(input: {
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  /** Where a lane's thread's card is: a task, an inventory, or nowhere. */
  readonly whereIs: (lane: ThreadId) => TaskId | "inventory" | null
  readonly archived: (task: TaskId) => boolean
}): readonly ThreadId[] {
  return [...input.holds.keys()].filter(lane => {
    const where = input.whereIs(lane)
    return where === null || (where !== "inventory" && input.archived(where))
  })
}
