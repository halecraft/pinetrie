// interface/card-marks — where your unsent cards are, as marks (ADR-0048, step
// 2): on your list's roots and new tabs, on the rail at a thread's end, on
// the board's items, and on ▦ for a root not in your list (ADR-0085). An
// archived root's work is done, so it lights only its own item on the board,
// never ▦. They answer "where was I?",
// so they count only the cards you own (contributors wait for Kyneta,
// ADR-0048's *Who contributed*). A card counts while it holds text, not while its record exists:
// a record outlives its text. Only drafting and fresh cards count: a queued
// card is on its way to being sent, not left somewhere. A trace marks
// nothing yet: raising it is for `attentionOf` (ADR-0077), beside verdicts
// and offers. Pure.

import {
  type CardId,
  type CardRecord,
  type EntryId,
  type LaneView,
  type RootId,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { cardEnd } from "@pinetrie/rules"
import { needsCard } from "./card-state.ts"
import { hereOfColumn, type Layout, unlisted } from "./layout.ts"
import { AGENT_PREFILL } from "./message-tools.ts"

/**
 * The cards that are yours, as the marks count them: those you own. Cards you
 * contributed to wait for Kyneta (ADR-0048, *Who contributed*).
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
  /** Roots holding a card of yours: their items in your list and on the board. */
  readonly roots: ReadonlySet<EntryId>
  /** New tabs, by key, whose column holds a card of yours. */
  readonly newTabs: ReadonlySet<string>
  /** Thread ends holding a drafting card of yours: dots on the rail. */
  readonly ends: ReadonlySet<EntryId>
  /**
   * A root in `roots` is not in your list and not archived: ▦ is marked
   * (ADR-0085).
   */
  readonly elsewhere: boolean
}

export function cardMarks(input: {
  /** Your cards (`ownCards`). */
  readonly mine: readonly CardRecord[]
  /** Cards that hold text (`holdsText`), by id. */
  readonly filled: ReadonlySet<CardId>
  readonly layout: Layout
  /** Roots in the closed workflow state (ADR-0029, ADR-0085), by root entry. */
  readonly archived: ReadonlySet<EntryId>
  readonly lanes: readonly LaneView[]
  readonly index: TreeIndex
  /**
   * Each root's root entry, by its id, from the directory: a drafting card
   * in a root this tab does not hold is marked by its place's root (ADR-0063).
   */
  readonly rootEntries: ReadonlyMap<RootId, EntryId>
}): CardMarks {
  const roots = new Set<EntryId>()
  const newTabs = new Set<string>()
  const ends = new Set<EntryId>()
  for (const card of input.mine) {
    if (!input.filled.has(card.id)) continue
    switch (card.place.kind) {
      case "drafting": {
        const end = cardEnd(card, input.lanes, input.index)
        const root =
          (end === null ? null : rootOf(input.index, end)) ??
          input.rootEntries.get(card.place.root) ??
          null
        if (root === null) break
        if (end !== null) ends.add(end)
        roots.add(root)
        break
      }
      case "fresh": {
        // A column this browser tab's layout lacks was typed in another
        // browser tab, and is marked nowhere here.
        const tab = hereOfColumn(input.layout, card.place.column)
        if (tab?.kind === "new") newTabs.add(tab.key)
        if (tab?.kind === "root") roots.add(tab.root)
        break
      }
      // Only drafting and fresh cards are marked (ADR-0048): the inventory
      // is no tab, and a pinned card is a thread's direction, not unsent work.
      case "queued":
      case "pinned":
      case "inventory":
        break
    }
  }
  return {
    roots,
    newTabs,
    ends,
    elsewhere: unlisted(input.layout, input.archived, roots).length > 0,
  }
}
