// notes — note columns and the notes in them: where a card leaving a thread
// goes, and a note's place at its column's end.

import {
  type CanvasPlace,
  type CardPlace,
  type CardRecord,
  makeCard,
  NO_CONTENT,
  type NoteColumnId,
  type NotesTarget,
  type TaskId,
  type TextCard,
  type TextPlace,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { byOrder } from "./card.ts"
import { afterSteps, type PlaceStep, planMake } from "./moves.ts"
import { orderAfter } from "./order.ts"
import { rankAfter } from "./rank.ts"
import { type CanvasCard, canvasOf } from "./task.ts"

// ── note columns ────────────────────────────────────────────────

/** A note, with its place narrowed. */
export type NoteCard = TextCard & {
  readonly place: Extract<CardPlace, { kind: "note" }>
}

const isNote = (c: CardRecord): c is NoteCard =>
  c.kind === "text" && c.place.kind === "note"

/** A note column's notes, in order: by `order`, then id. */
export const notesIn = (
  cards: readonly CardRecord[],
  column: NoteColumnId,
): readonly NoteCard[] =>
  cards
    .filter(isNote)
    .filter(c => c.place.column === column)
    .sort(byOrder)

/** The title a note column made for a note with nowhere else to go has. */
export const NEW_NOTES_TITLE = "Notes"

/**
 * Where a card leaving a queue or pinned cards goes, from
 * `canvas`, the cards of its task in order: the note column nearest the
 * card of `from`, the thread whose they were, or, with null, the task
 * column, which stands before every card (a card pinned to the task); the
 * one after on a tie. With none, a new one goes just after that card
 * (`make`, after canvas index `after`, -1 for first). `none` when the thread
 * is not on `canvas`.
 */
export function nearestNoteColumn(
  canvas: readonly CanvasCard[],
  from: ThreadId | null,
):
  | { readonly kind: "column"; readonly column: NoteColumnId }
  | { readonly kind: "make"; readonly after: number }
  | { readonly kind: "none" } {
  const at = from === null ? -1 : canvas.findIndex(c => c.id === from)
  if (from !== null && at < 0) return { kind: "none" }
  // Scanning left to right, a tie goes to the later: the one after.
  const nearest = canvas.reduce<{
    readonly column: NoteColumnId
    readonly distance: number
  } | null>((best, c, i) => {
    if (c.kind !== "note-column") return best
    const distance = Math.abs(i - at)
    return best === null || distance <= best.distance
      ? { column: c.id, distance }
      : best
  }, null)
  if (nearest !== null) return { kind: "column", column: nearest.column }
  return { kind: "make", after: at }
}

/**
 * Where a card's nearest notes are, decided and not yet written:
 * a note column of its task; one to make there, at `order`, the canvas
 * cards `renumbered` to fit it; or, for a thread whose card is in an
 * inventory, that inventory.
 */
export type NotesNear =
  | { readonly kind: "column"; readonly column: NoteColumnId }
  | {
      readonly kind: "make"
      readonly task: TaskId
      readonly order: string
      readonly renumbered: readonly CardRecord[]
    }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/**
 * Where the notes nearest `to` are (`nearestNoteColumn` over its task's
 * canvas): a thread's, or a task's own; null for a thread with no card.
 * Decides, mints nothing.
 */
export function notesNear(
  cards: readonly CardRecord[],
  to: NotesTarget,
): NotesNear | null {
  const from = to.near === "thread" ? to.thread : null
  const card = from === null ? undefined : cards.find(c => c.id === from)
  if (card?.place.kind === "inventory")
    return { kind: "inventory", holder: card.place.holder }
  const task =
    to.near === "task"
      ? to.task
      : card?.place.kind === "canvas"
        ? card.place.task
        : null
  if (task === null) return null
  const canvas = canvasOf(cards, task)
  const near = nearestNoteColumn(canvas, from)
  switch (near.kind) {
    case "none":
      return null
    case "column":
      return { kind: "column", column: near.column }
    case "make": {
      // With no room there, the crowded cards are given new ranks.
      const ranked = rankAfter(canvas, near.after)
      return {
        kind: "make",
        task,
        order: ranked.order,
        renumbered: ranked.respaced,
      }
    }
  }
}

/**
 * A card sent to the notes nearest `to` (a thread's, or a task's own), as a
 * place, and the writes that go first: a note column made for it (its id
 * `newColumn`'s, owned and placed by `by`), and the canvas cards renumbered
 * to fit it. The one step every write to notes takes: a move's, an unsent
 * card's, a migrated fresh column's cards'. The column is made through
 * `planMake`, as every card is. Null for a thread with no card, or a column
 * whose make is refused, which none is.
 */
export function toNotes(input: {
  readonly cards: readonly CardRecord[]
  readonly to: NotesTarget
  readonly newColumn: () => NoteColumnId
  readonly by: WriterId
}): {
  readonly place: Extract<TextPlace, { kind: "note" | "inventory" }>
  readonly first: readonly PlaceStep[]
} | null {
  const near = notesNear(input.cards, input.to)
  if (near === null) return null
  switch (near.kind) {
    case "inventory":
      return { place: { kind: "inventory", holder: near.holder }, first: [] }
    case "column":
      return { place: noteAt(input.cards, near.column), first: [] }
    case "make": {
      const renumbered = near.renumbered.map(
        (record): PlaceStep => ({ kind: "write", record }),
      )
      const made = makeNoteColumn(
        afterSteps(input.cards, renumbered),
        input.newColumn(),
        { kind: "canvas", task: near.task, order: near.order, width: 1 },
        input.by,
      )
      if (made === null) return null
      return { place: made.place, first: [...renumbered, made.step] }
    }
  }
}

/**
 * A new note column, `column`, at `at` on a canvas, made by `by` through
 * `planMake` as every card is, and the place of its first note. Null when
 * the make is refused, which none is.
 */
export function makeNoteColumn(
  cards: readonly CardRecord[],
  column: NoteColumnId,
  at: CanvasPlace,
  by: WriterId,
): {
  readonly step: PlaceStep
  readonly place: Extract<CardPlace, { kind: "note" }>
} | null {
  const made = planMake(
    cards,
    makeCard("note-column", column, at, NO_CONTENT, by),
    by,
  )
  return made.kind !== "write"
    ? null
    : { step: made, place: { kind: "note", column, order: orderAfter([]) } }
}

/** A note at the end of `column`. */
export const noteAt = (
  cards: readonly CardRecord[],
  column: NoteColumnId,
): Extract<CardPlace, { kind: "note" }> => ({
  kind: "note",
  column,
  order: orderAfter(notesIn(cards, column)),
})
