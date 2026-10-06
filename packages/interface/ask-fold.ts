// interface/ask-fold — whether an ask's work is drawn open (ADR-0056), what
// it draws (`planAskWork`), and the reader's choice for each ask, kept for
// the page's life. Pure but for the memory's listeners.
//
// An ask folds once its run has ended and the column is at its end: what
// folds is above the view then. A reader scrolled up into the work keeps it
// open under them until they come back down. Nothing is written when a run
// ends: the column's follow state keeps the tip from when its reader left
// the end (`releasedTip`), and a run that ended after it ended "while away".

import type { EntryId } from "@pinetrie/core"
import type { Segment } from "./ask-segments.ts"
import type { AskView } from "./ask-view.ts"
import {
  type Density,
  type FoldPart,
  foldWords,
  type SummaryAt,
} from "./ask-words.ts"
import { plural } from "./counts.ts"

/** What the reader chose for an ask's work, if anything. */
export type FoldChoice = "open" | "closed"

/** What decides whether an ask's work is drawn open. */
export interface FoldFacts {
  readonly choice: FoldChoice | null
  readonly density: Density
  /** Its run has not ended: which message is its last word is not known. */
  readonly running: boolean
  /** Its run ended after the reader left the column's end. */
  readonly endedWhileAway: boolean
}

/**
 * The reader's choice wins. Otherwise, in outline nothing opens; in raw,
 * everything does; in story, a running ask is open, since folding text as
 * it turned out to be interim would shorten the column during a run
 * (ADR-0044), and an ended one is open only while it ended while away.
 */
export function foldOpen(f: FoldFacts): boolean {
  if (f.choice !== null) return f.choice === "open"
  switch (f.density) {
    case "outline":
      return false
    case "raw":
      return true
    case "story":
      return f.running || f.endedWhileAway
  }
}

/** A fold of an ask's work: its head's words, and the messages it holds. */
export type FoldRow = Pick<
  Extract<Segment, { kind: "fold" }>,
  "kind" | "ids"
> & {
  /** The ask's first fold on this path (`Segment.first`). */
  readonly first: boolean
  /** Its head's words: the ask's summary on its first fold in story, else its step count. */
  readonly parts: readonly FoldPart[]
  /** The files button's label ("3 files"), on the first fold of an ask that changed files. */
  readonly files: string | null
}

/** What an ask's work draws after its line, in order, each with its words. */
export type AskRow =
  | { readonly kind: "message"; readonly id: EntryId }
  | FoldRow
  | {
      readonly kind: "digest"
      /** Null where the summary carries the headline, or there is none. */
      readonly headline: string | null
      readonly points: readonly string[]
    }
  | { readonly kind: "outcome"; readonly text: string }

export interface AskDraw {
  readonly open: boolean
  /** Outline's line: the summary, in outline; null at any other density. */
  readonly line: readonly FoldPart[] | null
  readonly rows: readonly AskRow[]
}

/**
 * What an ask's work draws, every word decided here. Its summary
 * (`foldWords`) is built once and drawn in one place: outline's line, the
 * head of its first fold on this path, or nowhere when it has no fold. The
 * digest's headline is drawn whole under the line or with no summary, and
 * in the first fold's head otherwise (ADR-0075). So nothing the ask holds
 * is said twice, however the work is split or opened.
 */
export function planAskWork(
  view: AskView,
  parts: readonly Segment[],
  reader: Pick<FoldFacts, "choice" | "density">,
): AskDraw {
  const open = foldOpen({
    ...reader,
    running: view.running,
    endedWhileAway: view.endedWhileAway,
  })
  const outline = reader.density === "outline"
  // `Segment.first` holds across the path, so an ask split over two rows
  // gives the summary to one fold only.
  const firstFold =
    parts.find(
      (s): s is Extract<Segment, { kind: "fold" }> =>
        s.kind === "fold" && s.first,
    )?.ids[0] ?? null
  const at: SummaryAt | null = outline
    ? "line"
    : firstFold === null
      ? null
      : "fold"
  const summary = at === null ? [] : foldWords(view, at)
  const head = (ids: readonly EntryId[]): readonly FoldPart[] =>
    at === "fold" && ids[0] === firstFold
      ? summary
      : [{ text: plural(ids.length, "step"), byModel: false }]
  const headline = at === "fold" ? null : view.headline
  const digest: AskRow[] =
    headline === null && view.points.length === 0
      ? []
      : [{ kind: "digest", headline, points: view.points }]
  const rows: AskRow[] = at === "fold" ? [] : [...digest]
  for (const s of parts) {
    if (s.kind === "entry") {
      // Outline keeps what the rail draws apart, and folds the rest.
      if (!(outline && !open && s.id === view.outlineHides))
        rows.push({ kind: "message", id: s.id })
      continue
    }
    if (outline && !open) continue
    const first = s.ids[0] === firstFold
    rows.push({
      kind: "fold",
      ids: s.ids,
      first,
      parts: head(s.ids),
      files: first && view.files > 0 ? plural(view.files, "file") : null,
    })
    if (first && at === "fold") rows.push(...digest)
    if (open) for (const id of s.ids) rows.push({ kind: "message", id })
  }
  if (at === null && view.outcome !== null)
    rows.push({ kind: "outcome", text: view.outcome })
  return { open, line: outline ? summary : null, rows }
}

/** A press on an ask's fold: the other of what it shows now. */
export const toggled = (open: boolean): FoldChoice => (open ? "closed" : "open")

/**
 * Each ask's choice, by its prompt, kept while the page lives, as tool rows'
 * are (ADR-0049). A fold reads its own key, so a choice redraws only the ask
 * it is for. A reload remembers nothing.
 */
export interface FoldMemory {
  get(ask: string): FoldChoice | undefined
  set(ask: string, choice: FoldChoice): void
  /** Hear every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

export function foldMemory(): FoldMemory {
  const kept = new Map<string, FoldChoice>()
  const listeners = new Set<() => void>()
  return {
    get: ask => kept.get(ask),
    set: (ask, choice) => {
      if (kept.get(ask) === choice) return
      kept.set(ask, choice)
      for (const l of listeners) l()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
