// interface/signals — what a mark says: one family of signals, each worded once
// (`signalWords`), and the unsent signal: where your unsent cards are, on the
// sidebar's canvases, on the rail at a thread's end, on the board's items, and on
// ▦ for a canvas not in the sidebar. An archived canvas's work is done, so it
// lights only its own item on the board, never ▦. They answer "where was I?",
// so they count only the cards you own: who contributed to a card waits on
// Kyneta naming the writers whose text still stands. A card counts while it
// holds text, not while its record exists: a record outlives its text. Only
// your messages and your notes count: a queued card is on its way to being
// sent, not left somewhere. A trace marks nothing yet: raising it is for
// `attentionItems`, beside run-end reports and ready proposed changes.

import type {
  CanvasId,
  CardId,
  CardRecord,
  EntryId,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import {
  type CanvasIndex,
  canvasOfPlace,
  isOnCanvas,
  placeEnd,
} from "@pinetrie/rules"
import { attentionWords, type Level, type Status } from "./attention.ts"
import { needsCard } from "./card-state.ts"
import { type Layout, unlisted } from "./layout.ts"
import { AGENT_PREFILL } from "./message-tools.ts"

/**
 * What a mark says, each named for it: unsent text of yours, a thread's
 * status (`Level`, `attention.ts`), and done (a run you follow ended asking
 * nothing). `SignalMark` draws every one, as `.signal[data-signal]`.
 */
export type Signal = "unsent" | Level | "done"

/**
 * A signal's words, its mark's name and title, and the word a column's
 * status button says while it is raised for you; null where the dot says
 * enough.
 */
interface SignalWording {
  readonly words: string
  readonly short: string | null
}

const SIGNAL_WORDS: Readonly<Record<Signal, SignalWording>> = {
  unsent: { words: "you have an unsent message here", short: null },
  accepted: { words: "accepted", short: null },
  running: { words: "the agent is working", short: null },
  "worth-a-read": { words: "worth a read", short: "worth a read" },
  ready: { words: "ready to accept", short: "ready" },
  conflicts: { words: "conflicts with accepted work", short: "conflicts" },
  "needs-you": { words: "needs you", short: "needs you" },
  done: { words: "the agent has finished", short: null },
}

/** What a column's dot says with no status: a grey dot. */
export const NO_STATUS_WORDS = "nothing here asks anything of you"

/** What a signal says, its mark's name and title: the one place each is worded. */
export const signalWords = (signal: Signal): string =>
  SIGNAL_WORDS[signal].words

/** A signal's words, then why: "needs you: asks whether to drop the v1 table". */
export const reasonedWords = (signal: Signal, reason: string | null): string =>
  reason === null ? signalWords(signal) : `${signalWords(signal)}: ${reason}`

/**
 * A status's title, wherever one is drawn: a column's dot and status
 * button, a canvas's mark in the sidebar and on the board.
 */
export const statusWords = (
  status: Status,
  nameOf: (writer: WriterId) => string,
): string =>
  reasonedWords(
    status.level,
    status.item === null ? null : attentionWords(status.item.raised, nameOf),
  )

/** The word a column's status button says: its level's, while raised for you; null otherwise. */
export const statusWord = (status: Status | null): string | null =>
  status?.raised === true ? SIGNAL_WORDS[status.level].short : null

/** ▦'s mark's title: what the canvases not in the sidebar raise. */
export const elsewhereWords = (level: Level): string =>
  `a canvas not in the sidebar: ${signalWords(level)}`

/**
 * The signal a thread's or a canvas's status draws: its level, done while a
 * run you follow that ended asking nothing still fades (`moving`), else none.
 * A status that is not raised draws its level quietly (`Status.raised`).
 */
export const statusSignal = (
  status: Status | null,
  doneFading: boolean,
): Signal | null => {
  if (status === null || (!status.raised && doneFading))
    return doneFading ? "done" : null
  return status.level
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
  /** Canvases holding a card of yours: their items in the sidebar and on the board. */
  readonly canvases: ReadonlySet<CanvasId>
  /** Thread ends holding your message: dots on the rail. */
  readonly ends: ReadonlySet<EntryId>
  /**
   * A canvas in `canvases` is not in the sidebar and not archived: ▦ is marked.
   */
  readonly elsewhere: boolean
}

export function unsentSignals(input: {
  /** Your cards (`ownCards`). */
  readonly mine: readonly CardRecord[]
  /** Cards that hold text (`holdsText`), by id. */
  readonly filled: ReadonlySet<CardId>
  readonly layout: Layout
  /** Canvases in the archive. */
  readonly archived: ReadonlySet<CanvasId>
  /** Every canvas: a card at a thread marks the thread's canvas. */
  readonly canvases: CanvasIndex
  readonly index: TreeIndex
}): UnsentSignals {
  const canvases = new Set<CanvasId>()
  const ends = new Set<EntryId>()
  for (const card of input.mine) {
    if (!input.filled.has(card.id)) continue
    switch (card.place.kind) {
      case "composing": {
        // A trashed thread's message is in the trash with it.
        if (!isOnCanvas(input.canvases, card.place.thread)) break
        // A thread in a root this tab does not hold has no end here, and
        // still marks its canvas.
        const end = placeEnd(card.place, input.index)
        if (end !== null) ends.add(end)
        const canvas = canvasOfPlace(input.canvases, card.place)
        if (canvas !== null) canvases.add(canvas)
        break
      }
      // A note marks its note column's canvas.
      case "note": {
        if (!isOnCanvas(input.canvases, card.place.column)) break
        const canvas = canvasOfPlace(input.canvases, card.place)
        if (canvas !== null) canvases.add(canvas)
        break
      }
      // The inventory is no tab, a pinned card is a thread's or a canvas's
      // direction, not unsent work, a comment is shared, and a canvas or the
      // board holds no text card.
      case "queued":
      case "margin":
      case "image":
      case "pinned":
      case "canvas-pinned":
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
    canvases,
    ends,
    elsewhere: unlisted(input.layout, input.archived, canvases).length > 0,
  }
}
