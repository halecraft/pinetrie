// move-history — the history of each sender's moves, what an undo of a
// step answers, and when a history retires (ADR-0066).

import {
  type ArchivedTask,
  type CardHistoryRecord,
  type CardId,
  type CardPlace,
  type CardRecord,
  historyScope,
  isNoteColumnId,
  keyOf,
  kindOfCard,
  type Move,
  type MoveHistoryScope,
  type MoveTarget,
  movesOfDocId,
  type PlaceKey,
  parseCardId,
  type TaskId,
  type Workflow,
} from "@pinetrie/core"
import { transitionOf } from "./board.ts"
import type { MoveStep } from "./moves.ts"
import {
  NO_TASK_INDEX,
  type TaskIndex,
  taskOfPlace,
  taskOfTarget,
} from "./task.ts"

// ── moves' history (ADR-0066) ─────────────────────────────────────────────

/**
 * What names a discard's history, the host's to decide: the tasks, and the
 * task the sender is on, for a card that leaves no task.
 */
export interface Discards {
  readonly tasks: TaskIndex
  readonly here: TaskId | null
}

/** For moves that discard nothing: a queueing, whose target is a queue. */
export const NO_DISCARDS: Discards = { tasks: NO_TASK_INDEX, here: null }

/**
 * The history a card leaving `from` for gone is in: the task it leaves,
 * else, from an inventory, the task its sender is on. Pure.
 */
export const discardHistory = (
  from: CardPlace,
  discards: Discards,
): TaskId | null => taskOfPlace(discards.tasks, from) ?? discards.here

/**
 * The history of the sender's moves `moves` enter, or null for none
 * (ADR-0066, ADR-0116, ADR-0126, ADR-0132). A creation enters one when its
 * command's `cause` is a paste (a card pasted, a thread copied), or when it
 * is a note column made for a note: the task it lands in, or with none the
 * sender's history outside any task (a slot). A creation a move makes (a
 * composer's new card, an empty note) enters none. Otherwise the task the
 * card goes to, when it goes to one, else the task it leaves, read from its
 * record, since the host accepts a move only from where the card is. So a
 * take into the inventory is recorded where it left, a put where it went, a
 * drag across tasks where it went, and a discard in the task it leaves
 * (`discardHistory`), which the page does not name (ADR-0066), or, leaving
 * no task, in its sender's history outside any task. Of several, the first
 * that names a history names the step's: a paste's discard of the card it
 * replaces, when there is one. A place at a thread, or a thread's nearest
 * notes, is in its thread's task, a spot on a canvas in its canvas's
 * (`taskOfTarget`). Pure.
 */
export function historyOf(
  moves: readonly Move[],
  cards: readonly CardRecord[],
  discards: Discards,
  cause: "move" | "paste",
): MoveHistoryScope | null {
  const taskOf = (to: CardPlace | MoveTarget) =>
    taskOfTarget(discards.tasks, to)
  for (const move of moves) {
    if (move.from === null) {
      if (cause === "paste") return historyScope(taskOf(move.to))
      const task = isNoteColumnId(move.card) ? taskOf(move.to) : null
      return task === null ? null : historyScope(task)
    }
    const from = cards.find(c => c.id === move.card)?.place
    if (from === undefined) continue
    if (move.to.kind === "trash")
      return historyScope(discardHistory(from, discards))
    const task = taskOf(move.to) ?? taskOf(from)
    if (task !== null) return historyScope(task)
  }
  return null
}

/** How long an archived task's histories are kept (ADR-0066). */
const ARCHIVED_HISTORY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The histories of moves to retire (ADR-0066): those of a task archived
 * `ARCHIVED_HISTORY_MS` ago or longer; and, at startup only, those of a
 * task the session does not hold (a new tab that never sent, or a task
 * gone). An id that names no task is left: a person's history outside any
 * task (`moves:<writer>`), or a document no history names. After a run's end that second
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
    // A person's history outside any task is kept: no task retires it.
    if (of === undefined || of.scope.kind === "person") return false
    const { task } = of.scope
    if (!input.tasks.has(task)) return input.startup
    const archived = input.archived.get(task)
    return (
      archived !== undefined && input.now - archived.at >= ARCHIVED_HISTORY_MS
    )
  })
}

/**
 * Whether an undo or a redo of a step that wrote `cards` would move a
 * task's card across the archive's edge (ADR-0126): the newest event of a
 * task's card among them, the step's own while nobody moved it since, went
 * into or out of the archive. Such an undo is refused `archived`: the
 * board's move gathers what crossing the edge needs. Pure.
 */
export function crossesArchive(
  cards: readonly CardId[],
  histories: ReadonlyMap<CardId, CardHistoryRecord>,
  workflow: Workflow | null,
): boolean {
  if (workflow === null) return false
  return cards.some(card => {
    if (kindOfCard(card) !== "task") return false
    const last = histories.get(card)?.events.at(-1)
    return (
      last?.from?.kind === "board" &&
      last.to.kind === "board" &&
      transitionOf(workflow, last.from.state, last.to.state) !== "within"
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
