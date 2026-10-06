// interface/ask-fold — whether an ask's work is drawn open (ADR-0056), and the
// reader's choice for each ask, kept for the page's life. Pure but for the
// memory's listeners.
//
// An ask folds once its run has ended and the column is at its end: what
// folds is above the view then. A reader scrolled up into the work keeps it
// open under them until they come back down. Nothing is written when a run
// ends: the column's follow state keeps the tip from when its reader left
// the end (`releasedTip`), and a run that ended after it ended "while away".

import type { Density } from "./ask-words.ts"

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

/**
 * Whether an ask's digest is drawn whole, its headline above its points,
 * rather than its headline in the first fold's head and its points under
 * it. Whole where no fold head is drawn to carry the headline: an ask with
 * no fold, and outline's closed line, whose one line says what the run does
 * now or how it ended (ADR-0075).
 */
export const digestApart = (f: {
  readonly density: Density
  readonly open: boolean
  readonly hasFold: boolean
}): boolean => !f.hasFold || (f.density === "outline" && !f.open)

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
