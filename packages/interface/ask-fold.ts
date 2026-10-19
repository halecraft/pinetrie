// interface/ask-fold — whether an ask's work is drawn open, what it draws,
// and the reader's choice for each ask, kept for the page's life.
//
// An ask folds once its run has ended and the column is at its end: what
// folds is above the view then. A reader scrolled up into the work keeps it
// open under them until they come back down. Nothing is written when a run
// ends: the column's follow state keeps the tip from when its reader left
// the end (`releasedTip`), and a run that ended after it ended "while away".

import type { EntryId } from "@pinetrie/core"
import { type DigestBody, pointsText } from "@pinetrie/rules"
import type { Segment } from "./ask-segments.ts"
import type { AskView } from "./ask-view.ts"
import { type CountsAt, type Density, foldWords } from "./ask-words.ts"
import { plural } from "./counts.ts"

/** What the reader chose for an ask's work, if anything. */
type FoldChoice = "open" | "closed"

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
 * it turned out to be interim would shorten the column during a run,
 * and an ended one is open only while it ended while away.
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
type FoldRow = Pick<Extract<Segment, { kind: "fold" }>, "kind" | "ids"> & {
  /** The ask's first fold on this path (`Segment.first`). */
  readonly first: boolean
  /** Its head's words: the ask's counts and outcome on its first fold in story, else its step count. */
  readonly parts: readonly string[]
  /** The files button's label ("3 files"), on the first fold of an ask that changed files. */
  readonly files: string | null
}

/** What an ask's work draws after its line, in order, each with its words. */
export type AskRow =
  | { readonly kind: "message"; readonly id: EntryId }
  | FoldRow
  | { readonly kind: "outcome"; readonly text: string }

/** Where an ask's one summary is drawn. */
type SummaryAnchor =
  /** After outline's line. */
  | { readonly kind: "line" }
  /** After the fold row whose first id is `fold`: the ask's first fold. */
  | { readonly kind: "fold"; readonly fold: EntryId }
  /** Before the ask's first work row. */
  | { readonly kind: "start" }

/** An ask's digest as drawn: its headline, its points, and where it goes. */
export interface AskSummary extends DigestBody {
  readonly after: SummaryAnchor
  /** Its points as a markdown list, as a client draws them; empty for none. */
  readonly pointsMarkdown: string
}

export interface AskDraw {
  readonly open: boolean
  /** Outline's line: the summary, in outline; null at any other density. */
  readonly line: readonly string[] | null
  /** The ask's digest, drawn once at its anchor; null for an ask with none. */
  readonly summary: AskSummary | null
  readonly rows: readonly AskRow[]
}

/**
 * What an ask's work draws, every word decided here. Its counts and outcome
 * (`foldWords`) are built once and drawn in one place: outline's line, the
 * head of its first fold on this path, or, with no fold, an outcome row at
 * its end. Its digest is one field, so it is drawn once: after outline's
 * line, else after its first fold, else before its work, with its points
 * in story and raw only. So nothing the ask holds is said twice, however
 * the work is split or opened.
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
  const at: CountsAt | null = outline
    ? "line"
    : firstFold === null
      ? null
      : "fold"
  const words = at === null ? [] : foldWords(view, at)
  const head = (ids: readonly EntryId[]): readonly string[] =>
    at === "fold" && ids[0] === firstFold ? words : [plural(ids.length, "step")]
  const after: SummaryAnchor =
    at === "line"
      ? { kind: "line" }
      : at === "fold" && firstFold !== null
        ? { kind: "fold", fold: firstFold }
        : { kind: "start" }
  const { digest } = view
  const summary: AskSummary | null =
    digest === null
      ? null
      : {
          ...digest,
          points: outline ? [] : digest.points,
          pointsMarkdown: outline ? "" : pointsText(digest.points),
          after,
        }
  const rows: AskRow[] = []
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
    if (open) for (const id of s.ids) rows.push({ kind: "message", id })
  }
  if (at === null && view.outcome !== null)
    rows.push({ kind: "outcome", text: view.outcome })
  return { open, line: outline ? words : null, summary, rows }
}

/** A press on an ask's fold: the other of what it shows now. */
export const toggled = (open: boolean): FoldChoice => (open ? "closed" : "open")

/**
 * Each ask's choice, by its prompt, kept while the page lives, as tool rows'
 * are. A fold reads its own key, so a choice redraws only the ask
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
