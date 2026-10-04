// client/card-words — what a card says about its place and its command
// (ADR-0048, ADR-0055), each label in one function. Pure.

import type {
  CardCommand,
  CardEvent,
  CatchUpFrom,
  ParentThread,
  ThreadBase,
  WriterId,
} from "@pineta/core"
import {
  catchUpName,
  displayName,
  type PinnedStatus,
  type Verb,
  verbOf,
} from "@pineta/rules"
import type { CardRefusal } from "@pineta/session"
import type { PinnedMarker } from "./column-view.ts"
import { lineWords, type Reader } from "./send.ts"
import type { TraceGroup } from "./traces.ts"

/** What a thread catches up with, for a command's words. */
export interface CatchUps {
  /** The thread's base (`effectiveBase`). */
  readonly base: ThreadBase
  /** The thread it branched from; null for one that began at its base (ADR-0072). */
  readonly parent: ParentThread | null
}

/**
 * What a command merges: the base for `bring-up-to-date`, the project for
 * `continue-on-line` (ADR-0060), the thread it branched from for
 * `catch-up-with-parent` (ADR-0072). Null for that one without a parent.
 */
const commandFrom = (
  command: CardCommand,
  { base, parent }: CatchUps,
): CatchUpFrom | null => {
  switch (command) {
    case "bring-up-to-date":
      return base
    case "continue-on-line":
      return { kind: "line" }
    case "catch-up-with-parent":
      return parent
  }
}

const fromName = (from: CatchUpFrom | null) =>
  from === null ? "the thread this one branched from" : catchUpName(from)

/** A command's name as people read it: the strip's button. */
export const commandWords = (command: CardCommand, at: CatchUps): string =>
  command === "continue-on-line"
    ? "continue from the project"
    : `catch up with ${fromName(commandFrom(command, at))}`

/**
 * What a card with a command does when sent, above its box, and on a queued
 * one: the command first, then the card's text as the agent's next message.
 */
export const commandNote = (command: CardCommand, at: CatchUps): string =>
  command === "continue-on-line"
    ? "↓ continues from the project first, then sends what you write"
    : `↓ catches up with ${fromName(commandFrom(command, at))} first, then sends what you write`

/** A queued card's button that takes it back below the line. */
export const UNQUEUE = "unqueue"

/** The × beside a command: what pressing it does. */
export const CLEAR_COMMAND = "send it as a plain message"

const who = (by: WriterId, reader: Reader): string =>
  by === reader.me ? "you" : displayName(by, reader.nameOf.get(by))

/** A queued card's heading: who queued it, and its place in line, from 0. */
export const queuedWords = (by: WriterId, n: number, reader: Reader): string =>
  `queued by ${who(by, reader)} · ${lineWords(n)}`

/** A card the host could not send, until it is queued again. */
export const unsentWords = (reason: string): string => `not sent: ${reason}`

/**
 * Something of yours refused (ADR-0059): a move or an undo the host
 * refused, or an undone swap whose slots changed. Gone from the queue, the
 * host had popped the card first (S69), so it was sent as its queuer's
 * message; moved, someone else moved it first.
 */
export function refusalWords(refusal: CardRefusal, reader: Reader): string {
  if (refusal.code === "slots-changed")
    return "not undone: those slots have changed since"
  const { by } = refusal
  switch (refusal.code) {
    case "gone":
      if (!refusal.fromQueue) return "not moved: it was sent or removed first"
      return by === null
        ? "already sent: it was sent before you unqueued it"
        : by === reader.me
          ? "already sent as your message: it was sent before you unqueued it"
          : `already sent as ${displayName(by, reader.nameOf.get(by))}'s message: it was sent before you unqueued it`
    case "moved":
      return by === null
        ? "not moved: someone moved it first"
        : `not moved: ${who(by, reader)} moved it first`
    case "full":
      return "inventory full"
    case "not-yours":
      return "not moved: that inventory is someone else's"
    case "exists":
    case "not-fresh":
      return "not moved"
  }
}

/**
 * What an editor's status line says: what its last send said, else why the
 * host could not send its card, until it is queued again.
 */
export const cardStatus = (status: string, unsent: string | null): string =>
  status !== "" || unsent === null ? status : unsentWords(unsent)

/** The inventory panel's name, and its button in the header. */
export const INVENTORY = "inventory"
/** A card's button that takes it into your inventory; its drag handle too. The page says "take". */
export const TAKE_INTO_INVENTORY = "take"
export const TAKE_INTO_INVENTORY_TITLE =
  "take into your inventory (Ctrl+Shift+I) · drag to move"
/** The composer's button that empties it for another card here. */
export const NEW_CARD = "+ card"
export const NEW_CARD_TITLE =
  "start another card here: this one stays, above the box"
/** A message's button that takes a copy of it, or of your selection in it. */
export const TAKE_COPY_INTO_INVENTORY = "take a copy into your inventory"
/** The panel's button that puts the selected card in the column last focused. */
export const PUT = "put"
export const PUT_TITLE =
  "put below the line in the column you were in (Ctrl+Shift+O)"
/** The panel's button that removes the selected card: final. */
export const REMOVE = "remove"
/** Closing a fresh column that holds text: the default, and the final choice. */
export const KEEP_IN_INVENTORY = "keep in inventory"
export const DISCARD = "discard"
/** The close ask's question, by how many cards hold text. */
export const closeAskWords = (n: number): string =>
  n === 1
    ? "keep what you typed in your inventory?"
    : `keep the ${n} cards here in your inventory?`

/** A refusal's React key: what it is about, and why. */
export const refusalKey = (refusal: CardRefusal): string =>
  `${refusal.code}:${refusal.card ?? ""}`

// ── pinned cards (ADR-0048 step 5) ────────────────────────────────────────

/** A drafting card's button that pins it to the top of its column. */
export const PIN = "pin"
export const PIN_TITLE =
  "pin to the top of the column: the agent reads it on every run"
/** A column's button that opens a box for a new pinned card. */
export const NEW_PIN = "+ pin"
export const NEW_PIN_TITLE =
  "write a new card pinned to the top of the column: the agent reads it on every run"
/** That box, empty. */
export const NEW_PIN_PLACEHOLDER =
  "what the agent should keep in mind on every run"
/** A pinned card's button that puts it back below the line. */
export const UNPIN = "unpin"
/** The pinned strip with no cards: where a drop pins one. */
export const PINNED_EMPTY = "drop a card here to pin it for the agent"

/** A pinned card's heading: who pinned it. */
export const pinnedWords = (by: WriterId, reader: Reader): string =>
  `pinned by ${who(by, reader)}`

/** How a pinned card stands against what the agent last read of it. */
export const pinnedStatusWords = (status: PinnedStatus): string => {
  switch (status) {
    case "read":
      return "read by the agent"
    case "changed":
      return "changed since the agent last read it"
    case "unread":
      return "not read by the agent yet"
  }
}

/** A pinned card's size: what it costs on every run, quietly. */
export const sizeWords = (tokens: number): string =>
  `~${tokens} ${tokens === 1 ? "token" : "tokens"}`

/** The marker above a run's prompt: how many pinned cards the agent read. */
export const pinnedMarkerWords = (marker: PinnedMarker): string =>
  marker.cards.length === 0
    ? "the agent was told pinned cards no longer apply"
    : `the agent read ${marker.cards.length} pinned ${marker.cards.length === 1 ? "card" : "cards"}`

/** A card the agent was told no longer applies, by its first line. */
export const retiredWords = (line: string): string =>
  `no longer applies: “${line}”`

// ── history and traces (ADR-0048 step 6) ──────────────────────────────────

/** A card's button that shows where it has been. */
export const HISTORY = "history"
export const HISTORY_TITLE = "where this card has been, and who moved it"

/** A verb as it reads after "by": "queued by Bea", "taken by Carl" (into an inventory). */
const PARTICIPLE: Readonly<Record<Verb, string>> = {
  created: "created",
  sent: "sent",
  queued: "queued",
  unqueued: "unqueued",
  pinned: "pinned",
  unpinned: "unpinned",
  "took-into-inventory": "taken",
  put: "put",
  moved: "moved",
}

/** One event in a card's history. */
export function historyWords(event: CardEvent, reader: Reader): string {
  const by = event.by === null ? "" : ` by ${who(event.by, reader)}`
  switch (event.kind) {
    case "created":
      return `created${by}`
    case "unsent":
      return "not sent: back below the line"
    case "followed":
      return "moved to the new thread"
    case "moved":
    case "undone":
    case "redone": {
      const verb = PARTICIPLE[verbOf(event.from, event.to)]
      const undo =
        event.kind === "undone"
          ? " (an undo)"
          : event.kind === "redone"
            ? " (a redo)"
            : ""
      return `${verb}${by}${undo}`
    }
  }
}

/** A verb as its doer does it: "Bea queued this", "Carl took this". */
const ACTIVE: Readonly<Record<Verb, string>> = {
  created: "created",
  sent: "sent",
  queued: "queued",
  unqueued: "unqueued",
  pinned: "pinned",
  unpinned: "unpinned",
  "took-into-inventory": "took",
  put: "put",
  moved: "moved",
}

/**
 * Where your card was when someone else moved it: "Bea queued this", "Bea
 * sent this →"; several at one spot by one person, "3 cards moved by Bea".
 */
export function traceWords(group: TraceGroup, reader: Reader): string {
  const name = who(group.by, reader)
  const n = group.traces.length
  if (n > 1) return `${n} cards ${PARTICIPLE[group.verb]} by ${name}`
  const arrow = group.verb === "sent" ? " →" : ""
  return `${name} ${ACTIVE[group.verb]} this${arrow}`
}

/** A card someone else moved back below the line: "unqueued by Bea". */
export const movedBackWords = (
  moved: { readonly verb: "unqueued" | "unpinned"; readonly by: WriterId },
  reader: Reader,
): string => `${moved.verb} by ${who(moved.by, reader)}`

/** Who has text in a card, under its history: "written by you, Bea". */
export const writtenWords = (
  writers: readonly WriterId[],
  reader: Reader,
): string | null =>
  writers.length === 0
    ? null
    : `written by ${writers.map(w => who(w, reader)).join(", ")}`
