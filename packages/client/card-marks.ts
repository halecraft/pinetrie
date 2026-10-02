// client/card-marks — where your unsent cards are, as marks (ADR-0048, step
// 2): on root tabs and new tabs, on the rail at a thread's end, and on the
// Archive tab for a root whose tab you closed. An archived root's work is
// done, so it lights only its own row, never the Archive tab. They answer "where was I?",
// so they count only the cards you own (contributors wait for step 6's
// history). A card counts while it holds text, not while its record exists:
// a record outlives its text. Only drafting and fresh cards count: a queued
// card is on its way to being sent, not left somewhere. Pure.

import {
  type CardId,
  type CardRecord,
  type EntryId,
  type LaneView,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { cardEnd } from "@pineta/marginalia"
import { needsCard } from "./card-state.ts"
import { type Layout, tabBar, tabOfColumn } from "./layout.ts"
import { AGENT_PREFILL } from "./message-tools.ts"

/**
 * The cards that are yours, as the marks count them: those you own. Cards you
 * contributed to wait for step 6's history.
 */
export const ownCards = (
  me: WriterId,
  cards: readonly CardRecord[],
): readonly CardRecord[] => cards.filter(c => c.owner === me)

/**
 * Whether a card has something typed in it: what `needsCard` would make a
 * card of. A bare `@agent ` is nothing typed, in any card.
 */
export const holdsText = (text: string): boolean =>
  needsCard(text, AGENT_PREFILL)

/**
 * The cards holding text after one card's text changed: `filled` itself
 * unless that card's answer flipped. Typing reaches this on every keystroke,
 * and only a new set re-renders what reads it.
 */
export function withFilled(
  filled: ReadonlySet<CardId>,
  id: CardId,
  holds: boolean,
): ReadonlySet<CardId> {
  if (filled.has(id) === holds) return filled
  const next = new Set(filled)
  if (holds) next.add(id)
  else next.delete(id)
  return next
}

/** Where your unsent cards are: the marks that answer "where was I?". */
export interface CardMarks {
  /** Roots holding a card of yours: their tabs, and their Archive rows. */
  readonly roots: ReadonlySet<EntryId>
  /** New tabs, by key, whose column holds a card of yours. */
  readonly newTabs: ReadonlySet<string>
  /** Thread ends holding a drafting card of yours: dots on the rail. */
  readonly ends: ReadonlySet<EntryId>
  /**
   * A root in `roots` has no tab in your bar and is not archived: the
   * Archive tab is marked.
   */
  readonly elsewhere: boolean
}

export function cardMarks(input: {
  /** Your cards (`ownCards`). */
  readonly mine: readonly CardRecord[]
  /** Cards that hold text (`holdsText`), by id. */
  readonly filled: ReadonlySet<CardId>
  readonly layout: Layout
  /** Roots in state `archived` (ADR-0029). */
  readonly archived: ReadonlySet<EntryId>
  readonly lanes: readonly LaneView[]
  readonly index: TreeIndex
}): CardMarks {
  const roots = new Set<EntryId>()
  const newTabs = new Set<string>()
  const ends = new Set<EntryId>()
  for (const card of input.mine) {
    if (!input.filled.has(card.id)) continue
    switch (card.place.kind) {
      case "drafting": {
        const end = cardEnd(card, input.lanes, input.index)
        const root = end === null ? null : rootOf(input.index, end)
        if (end === null || root === null) break
        ends.add(end)
        roots.add(root)
        break
      }
      case "fresh": {
        // A column this browser tab's layout lacks was typed elsewhere: the
        // inventory (step 4) will collect it.
        const tab = tabOfColumn(input.layout, card.place.column)
        if (tab?.kind === "new") newTabs.add(tab.key)
        if (tab?.kind === "root") roots.add(tab.root)
        break
      }
      case "queued":
        break
    }
  }
  const tabbed = new Set(
    tabBar(input.layout).flatMap(t => (t.kind === "root" ? [t.root] : [])),
  )
  return {
    roots,
    newTabs,
    ends,
    elsewhere: [...roots].some(r => !tabbed.has(r) && !input.archived.has(r)),
  }
}
