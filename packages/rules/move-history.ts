// move-history — the history of each sender's moves, what an undo of a
// step answers, and when a history retires (ADR-0066).

import {
  type ArchivedTask,
  type CardId,
  type CardPlace,
  type CardRecord,
  isNoteColumnId,
  keyOf,
  type Move,
  type MoveTarget,
  movesOfDocId,
  type PlaceKey,
  parseCardId,
  type TaskId,
} from "@pinetrie/core"
import { type Discards, discardHistory, type MoveStep } from "./moves.ts"
import { taskOfTarget } from "./task.ts"

// ── moves' history (ADR-0066) ─────────────────────────────────────────────

/**
 * The task whose history of the sender's moves `moves` enter, or null for
 * none (ADR-0066, ADR-0116). A creation enters none (a composer's new card,
 * a copy) but a note column's, which enters its canvas's task. Otherwise the task the card goes to, when it goes to one, else the
 * task it leaves, read from its record, since the host accepts a move only
 * from where the card is. So a take into the inventory is recorded where it
 * left, a put where it went, a drag across tasks where it went, and a
 * discard where its gone place goes (`discardHistory`), which the page does not
 * name (ADR-0066). Of several, the first that names a task names the
 * step's. A place at a thread, or a thread's nearest notes, is in its
 * thread's task, a spot on a canvas in its canvas's (`taskOfTarget`). Pure.
 */
export function historyOf(
  moves: readonly Move[],
  cards: readonly CardRecord[],
  discards: Discards,
): TaskId | null {
  const taskOf = (to: CardPlace | MoveTarget) =>
    taskOfTarget(discards.tasks, to)
  for (const move of moves) {
    // A note column made is in its task's history, so the undo key takes
    // it back; a card made in a composer or a queue is in none.
    if (move.from === null)
      return isNoteColumnId(move.card) ? taskOf(move.to) : null
    const from = cards.find(c => c.id === move.card)?.place
    const task =
      from === undefined
        ? null
        : move.to.kind === "gone"
          ? discardHistory(from, discards)
          : (taskOf(move.to) ?? taskOf(from))
    if (task !== null) return task
  }
  return null
}

/** How long an archived task's histories are kept (ADR-0066). */
const ARCHIVED_HISTORY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The histories of moves to retire (ADR-0066): those of a task archived
 * `ARCHIVED_HISTORY_MS` ago or longer; and, at startup only, those of a
 * task the session does not hold (a new tab that never sent, or a task
 * gone). An id that names no task is left. After a run's end that second
 * rule would retire the history of a new tab open now. `stored` is every
 * stored `moves:` document. Pure.
 */
export function planHistorySweep(input: {
  readonly stored: readonly string[]
  readonly tasks: ReadonlySet<TaskId>
  readonly archived: ReadonlyMap<TaskId, ArchivedTask>
  readonly now: number
  readonly startup: boolean
}): readonly string[] {
  return input.stored.filter(docId => {
    const of = movesOfDocId(docId)
    if (of === undefined) return false
    if (!input.tasks.has(of.task)) return input.startup
    const archived = input.archived.get(of.task)
    return (
      archived !== undefined && input.now - archived.at >= ARCHIVED_HISTORY_MS
    )
  })
}

/** Of an undo step, what pinetrie reads: which document each part wrote, and where. */
interface StepPart {
  readonly docId: string
  readonly footprint: readonly (readonly string[])[]
}

/** What an undo of moves did, as Kyneta says it with `whole`. */
export type UndoResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "undone"
      readonly step: { readonly parts: readonly StepPart[] }
    }
  | {
      readonly kind: "refused"
      readonly step: { readonly parts: readonly StepPart[] }
      readonly stale: readonly StepPart[]
    }

/** What the host answers an undo of moves with. */
type UndoAnswer =
  | { readonly kind: "nothing" }
  /** Each card it moved, and its place now: null when it removed the card. */
  | {
      readonly kind: "undone"
      readonly cards: readonly {
        readonly card: CardId
        readonly place: PlaceKey | null
      }[]
    }
  /** Someone moved one of its cards since: the first such card as it is now. */
  | Extract<MoveStep, { kind: "refused" }>

/**
 * The cards `parts` wrote in the places document `placesId`, each once.
 * Read from a stack's `top` before an undo, they are the cards that undo
 * would move (S139). Pure.
 */
export function cardsOfParts(
  parts: readonly StepPart[],
  placesId: string,
): readonly CardId[] {
  const ids = parts
    .filter(p => p.docId === placesId)
    .flatMap(p => p.footprint)
    .flatMap(path => {
      const card =
        path[0] === "cards" && path[1] !== undefined
          ? parseCardId(path[1])
          : undefined
      return card === undefined ? [] : [card]
    })
  return [...new Set(ids)]
}

/**
 * An undo's answer, from what Kyneta did and the cards after it: the cards
 * its step wrote (their footprints in the places document) and where each
 * is now; or, refused, the first card it could not undo as it is now. Pure.
 */
export function undoAnswer(
  result: UndoResult,
  cards: readonly CardRecord[],
  placesId: string,
): UndoAnswer {
  switch (result.kind) {
    case "none":
      return { kind: "nothing" }
    case "undone":
      return {
        kind: "undone",
        cards: cardsOfParts(result.step.parts, placesId).map(card => {
          const now = cards.find(c => c.id === card)
          return { card, place: now === undefined ? null : keyOf(now.place) }
        }),
      }
    case "refused": {
      const card = cardsOfParts(result.stale, placesId)[0]
      const now = cards.find(c => c.id === card) ?? null
      return { kind: "refused", code: now === null ? "gone" : "moved", now }
    }
  }
}
