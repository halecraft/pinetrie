// interface/card-marks — where your unsent cards are, as marks (ADR-0048, step
// 2): on the sidebar's tasks and new tabs, on the rail at a thread's end, on
// the board's items, and on ▦ for a task not in the sidebar (ADR-0122). An
// archived task's work is done, so it lights only its own item on the board,
// never ▦. They answer "where was I?",
// so they count only the cards you own (contributors wait for Kyneta,
// ADR-0048's *Who contributed*). A card counts while it holds text, not while its record exists:
// a record outlives its text. Only your messages, your notes and fresh cards
// count (ADR-0113): a queued card is on its way to being sent, not left
// somewhere. A trace marks
// nothing yet: raising it is for `attentionOf` (ADR-0077), beside verdicts
// and offers. Pure.

import type {
  CardId,
  CardRecord,
  EntryId,
  TaskId,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import { placeEnd, type TaskIndex, taskOfPlace } from "@pinetrie/rules"
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
  /** Tasks holding a card of yours: their items in the sidebar and on the board. */
  readonly tasks: ReadonlySet<TaskId>
  /** New tabs, by key, whose column holds a card of yours. */
  readonly newTabs: ReadonlySet<string>
  /** Thread ends holding your message: dots on the rail. */
  readonly ends: ReadonlySet<EntryId>
  /**
   * A task in `tasks` is not in the sidebar and not archived: ▦ is marked
   * (ADR-0122).
   */
  readonly elsewhere: boolean
}

export function cardMarks(input: {
  /** Your cards (`ownCards`). */
  readonly mine: readonly CardRecord[]
  /** Cards that hold text (`holdsText`), by id. */
  readonly filled: ReadonlySet<CardId>
  readonly layout: Layout
  /** Tasks in the archive (ADR-0029, ADR-0122). */
  readonly archived: ReadonlySet<TaskId>
  /** Every task: a card at a thread marks the thread's task. */
  readonly tasks: TaskIndex
  readonly index: TreeIndex
}): CardMarks {
  const tasks = new Set<TaskId>()
  const newTabs = new Set<string>()
  const ends = new Set<EntryId>()
  for (const card of input.mine) {
    if (!input.filled.has(card.id)) continue
    switch (card.place.kind) {
      case "composing": {
        // A thread in a root this tab does not hold has no end here, and
        // still marks its task (ADR-0063).
        const end = placeEnd(card.place, input.index)
        if (end !== null) ends.add(end)
        const task = taskOfPlace(input.tasks, card.place)
        if (task !== null) tasks.add(task)
        break
      }
      // A note marks its note column's task (ADR-0116).
      case "note": {
        const task = taskOfPlace(input.tasks, card.place)
        if (task !== null) tasks.add(task)
        break
      }
      case "fresh": {
        // A column this browser tab's layout lacks was typed in another
        // browser tab, and is marked nowhere here.
        const tab = hereOfColumn(input.layout, card.place.column)
        if (tab?.kind === "new") newTabs.add(tab.key)
        if (tab?.kind === "task") tasks.add(tab.task)
        break
      }
      // The inventory is no tab, a pinned card is a thread's or a task's
      // direction, not unsent work (ADR-0048), and a canvas holds no text
      // card.
      case "queued":
      case "pinned":
      case "task-pinned":
      case "inventory":
      case "canvas":
      case "gone":
        break
    }
  }
  return {
    tasks,
    newTabs,
    ends,
    elsewhere: unlisted(input.layout, input.archived, tasks).length > 0,
  }
}
