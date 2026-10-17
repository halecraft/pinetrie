// interface/signals — what a mark says: one family of signals, each worded once
// (`signalWords`), and the unsent signal: where your unsent cards are, on the
// sidebar's tasks, on the rail at a thread's end, on the board's items, and on
// ▦ for a task not in the sidebar. An archived task's work is done, so it
// lights only its own item on the board, never ▦. They answer "where was I?",
// so they count only the cards you own: who contributed to a card waits on
// Kyneta naming the writers whose text still stands. A card counts while it
// holds text, not while its record exists: a record outlives its text. Only
// your messages and your notes count: a queued card is on its way to being
// sent, not left somewhere. A trace marks nothing yet: raising it is for
// `attentionOf`, beside verdicts and ready proposed changes.

import type {
  CardId,
  CardRecord,
  EntryId,
  TaskId,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import {
  isOnCanvas,
  placeEnd,
  type TaskIndex,
  taskOfPlace,
} from "@pinetrie/rules"
import type { Level, Status } from "./attention.ts"
import { needsCard } from "./card-state.ts"
import { type Layout, unlisted } from "./layout.ts"
import { AGENT_PREFILL } from "./message-tools.ts"

/**
 * What a mark says, each named for it: unsent text of yours, needs you or worth
 * a read (`Level`, `attention.ts`), running (its agent works) and done (a run
 * you follow ended asking nothing). `SignalMark` draws every one, as
 * `.signal[data-signal]`.
 */
export type Signal =
  | "unsent"
  | "needs-you"
  | "worth-a-read"
  | "running"
  | "done"

const SIGNAL_WORDS: Readonly<Record<Signal, string>> = {
  unsent: "your unsent card is here",
  "needs-you": "needs you",
  "worth-a-read": "worth a read",
  running: "the agent is working",
  done: "the agent has finished",
}

/** What a signal says, its mark's name and title: the one place each is worded. */
export const signalWords = (signal: Signal): string => SIGNAL_WORDS[signal]

/** The signal an attention level raises (`LEVELS`): the one mapping of the two. */
export const signalOfLevel = (level: Level): Signal =>
  level === "needsYou" ? "needs-you" : "worth-a-read"

/** ▦'s mark's title: what the tasks not in the sidebar raise. */
export const elsewhereWords = (level: Level): string =>
  `a thread not in the sidebar: ${signalWords(signalOfLevel(level))}`

/**
 * The signal a thread's or a task's status draws: running while its agent
 * works, its level's when something is raised, done while a run you follow that
 * ended asking nothing still fades (`moving`), else none.
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
 * contributed to wait for Kyneta.
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
   * A task in `tasks` is not in the sidebar and not archived: ▦ is marked.
   */
  readonly elsewhere: boolean
}

export function unsentSignals(input: {
  /** Your cards (`ownCards`). */
  readonly mine: readonly CardRecord[]
  /** Cards that hold text (`holdsText`), by id. */
  readonly filled: ReadonlySet<CardId>
  readonly layout: Layout
  /** Tasks in the archive. */
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
        // A trashed thread's message is in the trash with it.
        if (!isOnCanvas(input.tasks, card.place.thread)) break
        // A thread in a root this tab does not hold has no end here, and
        // still marks its task.
        const end = placeEnd(card.place, input.index)
        if (end !== null) ends.add(end)
        const task = taskOfPlace(input.tasks, card.place)
        if (task !== null) tasks.add(task)
        break
      }
      // A note marks its note column's task.
      case "note": {
        if (!isOnCanvas(input.tasks, card.place.column)) break
        const task = taskOfPlace(input.tasks, card.place)
        if (task !== null) tasks.add(task)
        break
      }
      // The inventory is no tab, a pinned card is a thread's or a task's
      // direction, not unsent work, a comment is shared, and a canvas or the
      // board holds no text card.
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
