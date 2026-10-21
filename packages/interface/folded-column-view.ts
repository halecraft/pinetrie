// interface/folded-column-view — what a folded column says: a narrow strip
// with its card's mark and title, in its place on the canvas, so the
// arrangement reads the same for everyone whatever you have folded.

import type { ThreadId } from "@pinetrie/core"
import type { CardId, MediaId, NoteColumnId } from "@pinetrie/threads"
import type { CardColumn } from "./canvas-columns.ts"
import type { ControlWords } from "./card-words.ts"
import type { HeadIcon } from "./column-view.ts"
import { countWords, type ListKind } from "./count-words.ts"
import type { MediaColumnView } from "./media-column-view.ts"
import type { NoteColumnView } from "./note-column-view.ts"
import { aboutText, type ThreadGlance } from "./thread-glance.ts"

/** A list column at a glance: a note column or a media column, its title, and how many it holds. */
interface ListGlance {
  readonly kind: ListKind
  readonly card: NoteColumnId | MediaId
  readonly title: string
  /** How many it holds; null before the tab has read them. */
  readonly count: number | null
}

/** A note column's glance, from its column as drawn. */
export function noteColumnGlance(
  card: NoteColumnId,
  notes: ReadonlyMap<NoteColumnId, NoteColumnView>,
): ListGlance {
  const view = notes.get(card)
  return {
    kind: "note-column",
    card,
    title: view?.title ?? "",
    count: view?.notes.length ?? null,
  }
}

/** A media column's glance, from its column as drawn. */
export function mediaColumnGlance(
  card: MediaId,
  media: ReadonlyMap<MediaId, MediaColumnView>,
): ListGlance {
  const view = media.get(card)
  return {
    kind: "media",
    card,
    title: view?.title ?? "",
    count: view?.images.length ?? null,
  }
}

/** What a folded column draws: a thread's glance, or a list column's. */
export type FoldedGlance = ThreadGlance | ListGlance

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
    readonly media: ReadonlyMap<MediaId, MediaColumnView>
  },
): FoldedGlance | null {
  switch (column.kind) {
    case "thread":
      return column.card === null ? null : facts.threadGlanceOf(column.card)
    case "notes":
      return noteColumnGlance(column.card, facts.notes)
    case "media":
      return mediaColumnGlance(column.card, facts.media)
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
        hint: glance.about === null ? null : aboutText(glance.about),
      }
    : {
        title: glance.title,
        detail:
          glance.count === null ? null : countWords(glance.kind, glance.count),
        hint: null,
      }

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

/**
 * A column's fold toggle, first in its header folded or not, so it stays
 * under the pointer: ⇤ folds it to a strip, ⇥ unfolds it, for you alone.
 */
export const foldToggle = (folded: boolean): ControlWords =>
  folded
    ? {
        label: "⇥",
        title: "unfold this column: only you see your folds",
        className: "unfold",
      }
    : {
        label: "⇤",
        title: "fold this column to a strip: only you see your folds",
        className: "fold",
      }
