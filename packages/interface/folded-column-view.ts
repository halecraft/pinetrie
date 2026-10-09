// interface/folded-column-view — what a folded column says (ADR-0116): a
// narrow strip with its card's title, in its place on the canvas, so the
// arrangement reads the same for everyone whatever you have folded. Pure:
// `FoldedColumn` (`packages/web/folded-column.tsx`) draws it.

import type { CardId, NoteColumnId, ThreadId, ThreadName } from "@pinetrie/core"
import type { CardColumn } from "./canvas-columns.ts"
import type { ControlWords } from "./card-words.ts"
import { type NoteColumnView, noteCountWords } from "./note-column-view.ts"

/** A folded column, as drawn. */
export interface FoldedView {
  readonly card: CardId
  /** What the column holds when unfolded: a thread, or notes. */
  readonly kind: "thread" | "notes"
  /** Its title: a thread's name, a note column's title. */
  readonly title: string
  /** What it holds, under its title, or null. */
  readonly detail: string | null
}

/** A thread not yet named (ADR-0039): its name comes with its first send. */
export const UNNAMED_THREAD = "a thread"

/** A folded column's words; null for a branch not yet on the canvas, which never folds. */
export function foldedView(
  column: CardColumn,
  facts: {
    readonly names: ReadonlyMap<ThreadId, ThreadName>
    readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  },
): FoldedView | null {
  switch (column.kind) {
    case "thread":
      return column.card === null
        ? null
        : {
            card: column.card,
            kind: "thread",
            title: facts.names.get(column.card) ?? UNNAMED_THREAD,
            detail: null,
          }
    case "notes": {
      const notes = facts.notes.get(column.card)
      return {
        card: column.card,
        kind: "notes",
        title: notes?.title ?? "",
        detail: notes === undefined ? null : noteCountWords(notes.notes.length),
      }
    }
  }
}

/** A folded column's own button, which unfolds it. */
export const UNFOLD: ControlWords = {
  label: "⇥",
  title: "unfold this column: only you see your folds",
  className: "unfold",
}

/** A column's fold, in its header. */
export const FOLD: ControlWords = {
  label: "⇤",
  title: "fold this column to a strip: only you see your folds",
  className: "fold",
}
