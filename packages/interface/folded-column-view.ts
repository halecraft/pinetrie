// interface/folded-column-view — what a folded column says: a narrow strip
// with its card's mark and title, in its place on the canvas, so the
// arrangement reads the same for everyone whatever you have folded. A folded
// column is its card's face. `FoldedColumn` (`packages/web/folded-column.tsx`)
// draws it.

import type { NoteColumnId, ThreadId } from "@pinetrie/core"
import type { CardColumn } from "./canvas-columns.ts"
import type { ControlWords } from "./card-words.ts"
import type { HeadBanner } from "./column-view.ts"
import { type FaceOf, noteColumnFace } from "./face.ts"
import { type NoteColumnView, noteCountWords } from "./note-column-view.ts"
import type { ThreadFace } from "./thread-face.ts"

/** The face a folded column draws: a thread's, or a note column's. */
export type FoldedFace = FaceOf<"thread" | "note-column">

/** A thread not yet named: its name comes with its first send. */
export const UNNAMED_THREAD = "a thread"

/**
 * A folded column's face (`faceOf`), the same value a grid's cell
 * draws for its card; null for a branch not yet on the canvas, which never
 * folds.
 */
export function foldedView(
  column: CardColumn,
  facts: {
    readonly threadFaceOf: (thread: ThreadId) => ThreadFace
    readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  },
): FoldedFace | null {
  switch (column.kind) {
    case "thread":
      return column.card === null ? null : facts.threadFaceOf(column.card)
    case "notes":
      return noteColumnFace(column.card, facts.notes)
  }
}

/** A folded column's words: its title, and what it holds under it, or null. */
export interface FoldedWords {
  readonly title: string
  readonly detail: string | null
}

export const foldedWords = (face: FoldedFace): FoldedWords =>
  face.kind === "thread"
    ? { title: face.name ?? UNNAMED_THREAD, detail: null }
    : {
        title: face.title,
        detail: face.notes === null ? null : noteCountWords(face.notes),
      }

/**
 * What heads a folded strip above its name: a thread's mark (its banner, or
 * ✦ with none), the same the column's header draws; or no mark at all. Every
 * thread's strip has one, named or not, so its rows keep their heights.
 */
export type FoldedMark =
  | { readonly kind: "thread"; readonly banner: HeadBanner | null }
  | { readonly kind: "none" }

/** A strip with no mark: a note column's, the task column's. */
export const NO_MARK: FoldedMark = { kind: "none" }

export const foldedMark = (face: FoldedFace): FoldedMark =>
  face.kind === "thread"
    ? {
        kind: "thread",
        banner: face.sprite === null ? null : { url: face.sprite, fade: false },
      }
    : NO_MARK

/** A folded column's own button, which unfolds it. */
export const UNFOLD: ControlWords = {
  label: "⇥",
  title: "unfold this column: only you see your folds",
  className: "unfold",
}

/** A column's fold, an item of its ⋯: what it does, for you alone. */
export const FOLD = {
  title: "fold this column to a strip: only you see your folds",
} as const
