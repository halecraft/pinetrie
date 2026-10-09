// interface/column-menu — a card column's ⋯ (ADR-0116): what it offers for
// the canvas everyone shares, as values: its width, one column or two, the
// card's and the same for everyone; and a note column made just after it.
// Pure: the page's columns draw it.

import {
  type CardId,
  type CardWidth,
  isThreadId,
  type TaskId,
} from "@pinetrie/core"
import type { Intent } from "./intent.ts"

/** One item of a column's ⋯, in its section. */
export interface ColumnMenuItem {
  readonly key: string
  /** The canvas's own items; a thread's Move to ▸ and Copy to ▸ (ADR-0117). */
  readonly section: "canvas" | "move" | "copy"
  readonly label: string
  readonly title: string
  readonly intent: Intent
}

/** A task a thread's card can be moved or copied to, by its label. */
export interface TaskChoice {
  readonly task: TaskId
  readonly label: string
}

/**
 * What a column's ⋯ offers for its card `card`, now `width` columns wide;
 * for a thread's card on `here`'s canvas, Move to ▸ each other task in
 * `tasks` or your inventory, and Copy to ▸ this task, each other, or your
 * inventory (ADR-0117).
 */
export function columnMenu(input: {
  readonly card: CardId
  readonly width: CardWidth
  readonly thread?: {
    readonly here: TaskId
    readonly tasks: readonly TaskChoice[]
  }
}): readonly ColumnMenuItem[] {
  const wide = input.width === 2
  const canvas: ColumnMenuItem[] = [
    {
      key: "width",
      section: "canvas",
      label: wide ? "Make narrow" : "Make wide",
      title: wide
        ? "draw it one column wide, for everyone"
        : "draw it two columns wide, for everyone",
      intent: { kind: "cardWidth", card: input.card, width: wide ? 1 : 2 },
    },
    {
      key: "note-column",
      section: "canvas",
      label: "Add a note column here",
      title: "a new note column just after this one, for everyone",
      intent: { kind: "addNoteColumn", after: input.card },
    },
  ]
  const { thread } = input
  if (thread === undefined || !isThreadId(input.card)) return canvas
  const source = input.card
  const others = thread.tasks.filter(t => t.task !== thread.here)
  return [
    ...canvas,
    ...others.map(
      (t): ColumnMenuItem => ({
        key: `move-${t.task}`,
        section: "move",
        label: `Move to ${t.label}`,
        title: "move this thread to that task's canvas, for everyone",
        intent: { kind: "moveThread", thread: source, task: t.task },
      }),
    ),
    {
      key: "take",
      section: "move",
      label: "Move to your inventory",
      title: "put this thread away: its run stops, and only you can open it",
      intent: { kind: "takeIntoInventory", card: source },
    },
    ...[{ task: thread.here, label: "this task" }, ...others].map(
      (t): ColumnMenuItem => ({
        key: `copy-${t.task}`,
        section: "copy",
        label: `Copy to ${t.label}`,
        title: "a new thread forked at this one's end, on that task's canvas",
        intent: { kind: "copyThread", source, task: t.task },
      }),
    ),
    {
      key: "copy-inventory",
      section: "copy",
      label: "Copy to your inventory",
      title: "a new thread forked at this one's end, in your inventory",
      intent: { kind: "copyThread", source, task: null },
    },
  ]
}

/** The task column's own way to make a note column: first on the canvas. */
export const FIRST_NOTE_COLUMN = {
  label: "+ note column",
  title: "a new note column first on the canvas, for everyone",
  className: "add-note-column",
} as const

/** The ⋯'s own name, for a screen reader. */
export const COLUMN_MENU_LABEL = "more for this column, for everyone"
