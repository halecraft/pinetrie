// queue-hold — a thread's queue held (ADR-0048 step 7): who holds it, a hold
// or a release, the hold a Stop leaves, and the holds the host sweeps.
//
// While a lane's queue is held, the host pops no message card from it, only
// facts (`planNextQueuedCardPop`, `card.ts`), and a send there waits in it
// (`sendWaits`, @pineta/core). So people can line up several cards on an idle thread and
// let them go together. The hold is a session record, so it outlasts a
// restart: a queue staged overnight must not drain when the host starts.

import type {
  LaneName,
  QueueHold,
  RootId,
  ValueWrite,
  WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import type { QueuedCard } from "./card.ts"
import { decodeAt, laneKey } from "./decode.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

const QueueHoldSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** Each held queue, at its lane. */
export const QUEUE_HOLD: RecordSpec<QueueHold, LaneName, "session"> = {
  namespace: "pineta.queue-hold",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(QueueHoldSchema, contents, laneKey(key), (r, lane) => ({
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
  readonly holds: ReadonlyMap<LaneName, QueueHold>
  readonly lane: LaneName
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
 * The hold a Stop leaves on its lane's queue: one when a message card is
 * queued and nobody holds the queue yet. A Stop with nothing queued holds
 * nothing, or the correction sent after it would be held too. Pure.
 */
export function holdOnStop(input: {
  readonly queue: readonly QueuedCard[]
  readonly holds: ReadonlyMap<LaneName, QueueHold>
  readonly lane: LaneName
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
 * The holds to delete: each whose lane no root holds, or whose root is
 * archived. Archiving is refused while cards are queued, so a hold swept
 * holds nothing. Pure.
 */
export function planHoldSweep(input: {
  readonly holds: ReadonlyMap<LaneName, QueueHold>
  readonly rootOf: (lane: LaneName) => RootId | null
  readonly archived: (root: RootId) => boolean
}): readonly LaneName[] {
  return [...input.holds.keys()].filter(lane => {
    const root = input.rootOf(lane)
    return root === null || input.archived(root)
  })
}
