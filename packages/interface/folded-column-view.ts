// interface/folded-column-view — what a folded column says: a narrow strip
// with its card's mark and title, in its place on the canvas, so the
// arrangement reads the same for everyone whatever you have folded.

import type { CardId, NoteColumnId, ThreadId } from "@pinetrie/core"
import type { CardColumn } from "./canvas-columns.ts"
import type { ControlWords } from "./card-words.ts"
import type { HeadIcon } from "./column-view.ts"
import { type NoteColumnView, noteCountWords } from "./note-column-view.ts"
import type { ThreadGlance } from "./thread-glance.ts"

/** A note column at a glance: its title, and how many notes it holds. */
export interface NoteColumnGlance {
  readonly kind: "note-column"
  readonly card: NoteColumnId
  readonly title: string
  /** How many notes it holds; null before the tab has read them. */
  readonly notes: number | null
}

/** A note column's glance, from its column as drawn. */
export function noteColumnGlance(
  card: NoteColumnId,
  notes: ReadonlyMap<NoteColumnId, NoteColumnView>,
): NoteColumnGlance {
  const view = notes.get(card)
  return {
    kind: "note-column",
    card,
    title: view?.title ?? "",
    notes: view?.notes.length ?? null,
  }
}

/** What a folded column draws: a thread's glance, or a note column's. */
export type FoldedGlance = ThreadGlance | NoteColumnGlance

/** The card a folded column's glance is of. */
export const glanceCardId = (glance: FoldedGlance): CardId =>
  glance.kind === "thread" ? glance.thread : glance.card

/** A thread not yet named: its name comes with its first send. */
export const UNNAMED_THREAD = "a thread"

/**
 * What a folded column draws for its card; null for a branch not yet on the
 * canvas, which never folds.
 */
export function foldedView(
  column: CardColumn,
  facts: {
    readonly threadGlanceOf: (thread: ThreadId) => ThreadGlance
    readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  },
): FoldedGlance | null {
  switch (column.kind) {
    case "thread":
      return column.card === null ? null : facts.threadGlanceOf(column.card)
    case "notes":
      return noteColumnGlance(column.card, facts.notes)
  }
}

/**
 * A folded column's words: its title, what it holds under it, or null, and
 * what its strip's tooltip says before how to unfold it: a thread's focus.
 */
interface FoldedWords {
  readonly title: string
  readonly detail: string | null
  readonly hint: string | null
}

export const foldedWords = (glance: FoldedGlance): FoldedWords =>
  glance.kind === "thread"
    ? {
        title: glance.name ?? UNNAMED_THREAD,
        detail: null,
        hint: glance.focus?.text ?? null,
      }
    : {
        title: glance.title,
        detail: glance.notes === null ? null : noteCountWords(glance.notes),
        hint: null,
      }

/** A folded strip's tooltip: its hint, then how to unfold it. */
export const stripTitle = (
  unfold: ControlWords,
  hint: string | null,
): string => (hint === null ? unfold.title : `${hint}\n${unfold.title}`)

/**
 * What heads a folded strip above its name: a thread's mark (its icon, or ✦
 * with none), drawn as the column's header draws it; or no mark at all. Every
 * thread's strip has one, named or not, so its rows keep their heights.
 */
export type FoldedMark =
  | { readonly kind: "thread"; readonly icon: HeadIcon | null }
  | { readonly kind: "none" }

/** A strip with no mark: a note column's, the canvas column's. */
export const NO_MARK: FoldedMark = { kind: "none" }

export const foldedMark = (glance: FoldedGlance): FoldedMark =>
  glance.kind === "thread"
    ? {
        kind: "thread",
        icon: glance.icon === null ? null : { ...glance.icon, fade: false },
      }
    : NO_MARK

/** A folded column's own button, which unfolds it. */
export const UNFOLD: ControlWords = {
  label: "⇥",
  title: "unfold this column: only you see your folds",
  className: "unfold",
}

/** An unfolded column's own button, which folds it, for you alone. */
export const FOLD: ControlWords = {
  label: "⇤",
  title: "fold this column to a strip: only you see your folds",
  className: "fold",
}
