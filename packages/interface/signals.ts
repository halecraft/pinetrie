// interface/signals — what a mark says (ADR-0126): one family of signals,
// each worded once (`signalWords`), and the unsent signal: where your
// unsent cards are (ADR-0048, step 2), on the sidebar's tasks, on the rail at
// a thread's end, on the board's items, and on ▦ for a task not in the
// sidebar (ADR-0122). An archived task's work is done, so it lights only its
// own item on the board, never ▦. They answer "where was I?", so they count
// only the cards you own (contributors wait for Kyneta, ADR-0048's *Who
// contributed*). A card counts while it holds text, not while its record
// exists: a record outlives its text. Only your messages and your notes
// count (ADR-0113): a queued card is on its way to being sent,
// not left somewhere. A trace marks nothing yet: raising it is for
// `attentionOf` (ADR-0077), beside verdicts and offers. Pure.

import type {
  CardId,
  CardRecord,
  EntryId,
  TaskId,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import { placeEnd, type TaskIndex, taskOfPlace } from "@pinetrie/rules"
import type { Level, Status } from "./attention.ts"
import { needsCard } from "./card-state.ts"
import { type Layout, unlisted } from "./layout.ts"
import { AGENT_PREFILL } from "./message-tools.ts"

/**
 * What a mark says, each named for it (ADR-0126): unsent text of yours
 * (ADR-0048), needs you or worth a read (ADR-0077's levels), running (its
 * agent works, ADR-0069) and done (a run you follow ended asking nothing).
 * `SignalMark` draws every one, as `.signal[data-signal]`.
 */
export type Signal =
  | "unsent"
  | "needs-you"
  | "worth-a-read"
  | "running"
  | "done"

/** Every signal, so a table over them is total. */
export const SIGNALS: readonly Signal[] = [
  "unsent",
  "needs-you",
  "worth-a-read",
  "running",
  "done",
]

/** A signal in words: its mark's name, and what its title says. */
export interface SignalWords {
  readonly label: string
  readonly title: string
}

const SIGNAL_WORDS: Readonly<Record<Signal, SignalWords>> = {
  unsent: { label: "your unsent card", title: "your unsent card is here" },
  "needs-you": { label: "needs you", title: "needs you" },
  "worth-a-read": { label: "worth a read", title: "worth a read" },
  running: { label: "the agent is working", title: "the agent is working" },
  done: { label: "the agent has finished", title: "the agent has finished" },
}

/** What a signal says: the one place each is worded. */
export const signalWords = (signal: Signal): SignalWords => SIGNAL_WORDS[signal]

/** The signal an attention level raises (`LEVELS`): the one mapping of the two. */
export const signalOfLevel = (level: Level): Signal =>
  level === "needsYou" ? "needs-you" : "worth-a-read"

/**
 * The signal a thread's or a task's status draws (ADR-0077): running while
 * its agent works, its level's when something is raised, done while a run
 * you follow that ended asking nothing still fades (`moving`), else none.
 */
export const statusSignal = (
  status: Status | null,
  doneFading: boolean,
): Signal | null => {
  if (status === null) return doneFading ? "done" : null
  return status.kind === "working" ? "running" : signalOfLevel(status.kind)
}

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
export interface UnsentSignals {
  /** Tasks holding a card of yours: their items in the sidebar and on the board. */
  readonly tasks: ReadonlySet<TaskId>
  /** Thread ends holding your message: dots on the rail. */
  readonly ends: ReadonlySet<EntryId>
  /**
   * A task in `tasks` is not in the sidebar and not archived: ▦ is marked
   * (ADR-0122).
   */
  readonly elsewhere: boolean
}

export function unsentSignals(input: {
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
}): UnsentSignals {
  const tasks = new Set<TaskId>()
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
      // The inventory is no tab, a pinned card is a thread's or a task's
      // direction, not unsent work (ADR-0048), a comment is shared, and a
      // canvas or the board holds no text card.
      case "queued":
      case "margin":
      case "pinned":
      case "task-pinned":
      case "inventory":
      case "canvas":
      case "board":
      case "trash":
        break
      default:
        card.place satisfies never
    }
  }
  return {
    tasks,
    ends,
    elsewhere: unlisted(input.layout, input.archived, tasks).length > 0,
  }
}
