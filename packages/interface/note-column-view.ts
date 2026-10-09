// interface/note-column-view — a task's note columns as the page draws them
// (ADR-0116): each a title and its notes in one order, placed among the
// task's open thread columns by the canvas's order. Pure: `NoteColumn`
// (`packages/web/note-column.tsx`) draws one.

import type {
  CardRecord,
  NoteColumnId,
  NoteColumnRecord,
  ThreadId,
} from "@pinetrie/core"
import {
  type CanvasCard,
  NEW_NOTES_TITLE,
  type NoteCard,
  notesIn,
} from "@pinetrie/rules"
import type { ControlWords } from "./card-words.ts"

/** One note column, as drawn. */
export interface NoteColumnView {
  readonly column: NoteColumnId
  /** Its title, or `NEW_NOTES_TITLE` while it has none. */
  readonly title: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly titled: string | null
  /** Its notes, in order. */
  readonly notes: readonly NoteCard[]
}

/** `canvas`'s note columns, in its order, each with its notes from `cards`. */
export function noteColumnsOf(input: {
  readonly canvas: readonly CanvasCard[]
  readonly cards: readonly CardRecord[]
  readonly titles: ReadonlyMap<NoteColumnId, NoteColumnRecord>
}): readonly NoteColumnView[] {
  return input.canvas.flatMap(c => {
    if (c.kind !== "note-column") return []
    const titled = input.titles.get(c.id)?.title ?? null
    return [
      {
        column: c.id,
        title: titled ?? NEW_NOTES_TITLE,
        titled,
        notes: notesIn(input.cards, c.id),
      },
    ]
  })
}

/** What the strip draws, in order: an open thread column, by position, or a note column. */
export type StripItem =
  | { readonly kind: "thread"; readonly position: number }
  | { readonly kind: "notes"; readonly column: NoteColumnId }

/**
 * The open thread columns, in the tab's order, with each of the task's note
 * columns just after the last open column whose thread comes before it on
 * the canvas, else first. A column with no thread on the canvas (a fresh
 * one) is passed over. Every reader sees a note column beside the same
 * thread. Pure.
 */
export function stripItems(
  columns: readonly { readonly thread?: ThreadId }[],
  canvas: readonly CanvasCard[],
): readonly StripItem[] {
  const rank = new Map(canvas.map((c, i) => [c.id as string, i] as const))
  const before = new Map<number, NoteColumnId[]>()
  const first: NoteColumnId[] = []
  canvas.forEach((c, i) => {
    if (c.kind !== "note-column") return
    let after = -1
    columns.forEach((col, position) => {
      const at = col.thread === undefined ? undefined : rank.get(col.thread)
      if (at !== undefined && at < i) after = position
    })
    if (after < 0) first.push(c.id)
    else before.set(after, [...(before.get(after) ?? []), c.id])
  })
  const notes = (ids: readonly NoteColumnId[]): StripItem[] =>
    ids.map(column => ({ kind: "notes", column }))
  return [
    ...notes(first),
    ...columns.flatMap((_, position): StripItem[] => [
      { kind: "thread", position },
      ...notes(before.get(position) ?? []),
    ]),
  ]
}

/** A note column's "+ add a note". */
export const ADD_NOTE: ControlWords = {
  label: "+ add a note",
  title: "a new note at the column's end, which everyone in the task sees",
  className: "add-note",
}

/** A note column's notes: how many there are. */
export const noteCountWords = (n: number): string =>
  n === 0 ? "no notes" : n === 1 ? "1 note" : `${n} notes`

/** A note column with none: where a drop makes one. */
export const NOTES_EMPTY = "drop a card here to make it a note"
