// queue-hold — a thread's queue held: who holds it, a hold or a release, the
// hold a Stop leaves, and the holds the host sweeps.

import type { CanvasId, ThreadId, ValueWrite, WriterId } from "@pinetrie/core"
import type {
  CardCommand,
  CardRecord,
  QueueHoldChange,
  QueueMove,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { recordDecoder, threadKey, WriterIdSchema } from "./decode.ts"
import { type MovesStep, planMoveCommand } from "./moves.ts"
import { isQueuedMessage, type QueuedCard } from "./queue.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

const QueueHoldSchema = Type.Object({
  by: WriterIdSchema,
  at: Type.Number(),
})

/**
 * A thread's queue held: a host-written `pinetrie.queue-hold` value in the
 * session, keyed by the lane. While it is there no message card is popped, only
 * facts, until someone releases it.
 */
export interface QueueHold {
  readonly lane: ThreadId
  readonly by: WriterId
  /** When it was held, in ms since the epoch. */
  readonly at: number
}

/** Each held queue, at its lane. */
export const QUEUE_HOLD: RecordSpec<
  QueueHold,
  ThreadId,
  "session",
  typeof QueueHoldSchema
> = {
  namespace: "pinetrie.queue-hold",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: recordDecoder(QueueHoldSchema, threadKey, (r, lane) => ({
    lane,
    by: r.by,
    at: r.at,
  })),
}

/**
 * Hold a lane's queue, or release it. A hold is written only where there is
 * none, so the first holder stays named; a release deletes it. Nothing,
 * either way, when the queue is already so.
 */
export function planQueueHold(input: {
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  readonly lane: ThreadId
  readonly by: WriterId
  readonly now: number
  readonly held: boolean
}): readonly ValueWrite<"session">[] {
  const { holds, lane } = input
  const there = holds.has(lane)
  if (input.held === there) return []
  return input.held
    ? [setRecord(QUEUE_HOLD, { lane, by: input.by, at: input.now })]
    : [deleteRecord(QUEUE_HOLD, lane)]
}

/**
 * A card queued, and its queue's hold changed with it: the move
 * planned as any move is (`planMoveCommand`), and, only when it is
 * accepted, the hold's writes. The hold goes first when the host carries it
 * out, so the drain the move asks for finds the queue as this says: held
 * before a staged card can be popped, released before the drain. A move
 * that queues nothing changes no hold. A card queued with `command`, made
 * there or moved there (a "resolve and send"), carries it in the move's own
 * write: a command set by a later request could come after the drain
 * popped the card.
 */
export function planQueueCard(input: {
  readonly cards: readonly CardRecord[]
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  readonly move: QueueMove
  readonly hold: QueueHoldChange
  /** The queued card's command; null leaves a card that exists as it is. */
  readonly command: CardCommand | null
  readonly by: WriterId
  readonly now: number
  readonly running: (lane: ThreadId) => boolean
}): {
  readonly step: MovesStep
  readonly drain: readonly ThreadId[]
  readonly holds: readonly ValueWrite<"session">[]
} {
  const { move, hold } = input
  // A queueing trashes nothing: its target is a queue.
  const planned = planMoveCommand(input.cards, [move], input.by, input.running)
  const { drain } = planned
  const step =
    input.command !== null
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

/** The queued card's write, carrying `command`. */
const withCommand = (step: MovesStep, command: CardCommand): MovesStep =>
  step.kind === "refused"
    ? step
    : {
        kind: "steps",
        steps: step.steps.map(s =>
          s.kind === "write" && s.record.kind === "text"
            ? {
                kind: "write",
                record: {
                  ...s.record,
                  content: { ...s.record.content, command },
                },
              }
            : s,
        ),
      }

/**
 * The hold a Stop leaves on its lane's queue: one when a message card is
 * queued and nobody holds the queue yet. A Stop with nothing queued holds
 * nothing, or the correction sent after it would be held too.
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
  return input.queue.some(isQueuedMessage)
    ? { lane, by: input.by, at: input.now }
    : null
}

/**
 * The holds to delete: each whose lane's thread has no card, or whose card
 * is in an archived canvas. A thread in an inventory keeps its
 * hold. Archiving is refused while cards are queued, so a hold swept holds
 * nothing.
 */
export function planHoldSweep(input: {
  readonly holds: ReadonlyMap<ThreadId, QueueHold>
  /** Where a lane's thread's card is: a canvas, an inventory, or nowhere. */
  readonly whereIs: (lane: ThreadId) => CanvasId | "inventory" | null
  readonly archived: (canvas: CanvasId) => boolean
}): readonly ThreadId[] {
  return [...input.holds.keys()].filter(lane => {
    const where = input.whereIs(lane)
    return where === null || (where !== "inventory" && input.archived(where))
  })
}
