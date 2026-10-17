// interface/card-words — what a card says about its place and its command,
// each label in one function.

import type {
  CanvasView,
  CardCommand,
  CardEvent,
  CatchUpCommand,
  CatchUpFrom,
  ListKey,
  ParentThread,
  ThreadBase,
  WriterId,
} from "@pinetrie/core"
import {
  catchUpName,
  changeVerb,
  displayName,
  type PinnedStatus,
  type Verb,
} from "@pinetrie/rules"
import type { CardNotice } from "@pinetrie/session"
import type { CardTone } from "./card-frame.ts"
import type { PinnedMarker } from "./column-view.ts"
import type { Reader } from "./send.ts"
import type { TraceGroup } from "./traces.ts"

/** What a thread catches up with, for a command's words. */
export interface CatchUps {
  /** The thread's base (`effectiveBase`). */
  readonly base: ThreadBase
  /** The thread it branched from; null for one that began at its base. */
  readonly parent: ParentThread | null
}

/**
 * What a command merges: the base for `bring-up-to-date`, accepted work for
 * `continue-on-accepted`, the thread it branched from for
 * `catch-up-with-parent`. Null for that one without a parent.
 */
const commandFrom = (
  command: CatchUpCommand,
  { base, parent }: CatchUps,
): CatchUpFrom | null => {
  switch (command) {
    case "bring-up-to-date":
      return base
    case "continue-on-accepted":
      return { kind: "accepted" }
    case "catch-up-with-parent":
      return parent
  }
}

/** A split's words: the button's, and above a card that carries it. */
const SPLIT = "split into a stack"

const fromName = (from: CatchUpFrom | null) =>
  from === null ? "the thread this one branched from" : catchUpName(from)

/** A command's name as people read it: the strip's button. */
export const commandWords = (command: CardCommand, at: CatchUps): string =>
  command === "split"
    ? SPLIT
    : command === "continue-on-accepted"
      ? "continue from accepted work"
      : `catch up with ${fromName(commandFrom(command, at))}`

/**
 * What a card with a command does when sent, above its box, and on a queued
 * one: the command first, then the card's text as the agent's next message.
 */
export const commandNote = (command: CardCommand, at: CatchUps): string =>
  command === "split"
    ? "⇶ splits the changes into a stack, with what you write as its brief"
    : command === "continue-on-accepted"
      ? "↓ continues from accepted work first, then sends what you write"
      : `↓ catches up with ${fromName(commandFrom(command, at))} first, then sends what you write`

/** The × beside a command: what pressing it does. */
export const CLEAR_COMMAND = "send it as a plain message"

export const who = (by: WriterId, reader: Reader): string =>
  by === reader.me ? "you" : displayName(by, reader.nameOf.get(by))

/** A control's words: its label, its title and its class. */
export interface ControlWords {
  readonly label: string
  readonly title: string
  readonly className: string
}

/**
 * A queued or pinned card's ↑ or ↓: it moves one place,
 * as Alt+↑ or Alt+↓ in its box does.
 */
export const reorderWords = (step: -1 | 1): ControlWords =>
  step === -1
    ? {
        label: "↑",
        title: "move up one place (Alt+↑)",
        className: "reorder-up",
      }
    : {
        label: "↓",
        title: "move down one place (Alt+↓)",
        className: "reorder-down",
      }

/** A card the host could not send, until it is queued again. */
export const unsentWords = (reason: string): string => `not sent: ${reason}`

/** What a discard of yours says where you made it, until your next move there. */
const DISCARDED_NOTICE =
  "discarded · the undo key (⌘Z outside a box) brings it back"

/**
 * Something of yours to say where you acted: a discard, or a
 * refusal: a move, a reorder or an undo the host refused, or an
 * undone swap whose slots changed. Gone from the queue, the host had popped
 * the card first, so it was sent as its queuer's message; moved,
 * someone else moved it first; order changed, the cards a reorder named
 * moved first.
 */
export function noticeWords(notice: CardNotice, reader: Reader): string {
  if (notice.code === "discarded") return DISCARDED_NOTICE
  if (notice.code === "slots-changed")
    return "not undone: those slots have changed since"
  if (notice.code === "not-replaced")
    return "not replaced: the card in that slot can't be discarded"
  if (notice.code === "slot-taken")
    return "not pasted: a thread's copy lands only in an empty slot"
  const { by } = notice
  switch (notice.code) {
    case "gone":
      if (!notice.fromQueue) return "not moved: it was sent or discarded first"
      return by === null
        ? "already sent before you unqueued it"
        : by === reader.me
          ? "already sent as your message, before you unqueued it"
          : `already sent as ${displayName(by, reader.nameOf.get(by))}'s message, before you unqueued it`
    case "moved":
      return by === null
        ? "not moved: someone moved it first"
        : `not moved: ${who(by, reader)} moved it first`
    case "full":
      return "inventory full"
    case "not-yours":
      return "not moved: that inventory is someone else's"
    // A reorder of a fact's card, or one that would pass it: it stays put.
    case "fact":
      return "not moved: a note the thread will read keeps its place"
    case "order-changed":
      return "not moved: the cards around it changed first"
    case "replied":
      return by === null
        ? "not lifted back: its thread or its canvas has more in it"
        : `not lifted back: ${who(by, reader)} replied`
    case "archived":
      return "not undone: restore or archive it on the board"
    case "left-gone":
      return "not restored: where it was is gone"
    case "left-taken":
      return "not restored: you have written a new message there"
    case "exists":
    case "no-place":
      return "not moved"
  }
}

/** The inventory panel's name, and its button in the footer. */
export const INVENTORY = "inventory"
/** Take into your inventory: one name and one key wherever it is offered. */
export const TAKE = "take into your inventory (Ctrl+Shift+I)"
/** The clipboard cell's button: its copy into a free slot. */
export const KEEP = "keep"
export const KEEP_TITLE =
  "keep this in your inventory, in a free slot: a copy, as a paste makes"
/** The clipboard cell's heading: what it shows, and that it knows no more. */
export const CLIPBOARD_CELL = "last copied here"
export const CLIPBOARD_CELL_TITLE =
  "what you last copied in this tab; a copy made in another app shows here once you paste it"
/** The panel's button that puts the selected card in the column last focused. */
export const PUT = "put"
export const PUT_TITLE =
  "put below the line in the column you were in (Ctrl+Shift+O)"
/** A card's button that discards it; the undo key brings it back. */
export const DISCARD_CARD = "×"
export const DISCARD_CARD_TITLE =
  "discard (Ctrl+Shift+Backspace) · the undo key brings it back"
/** A slot's ×, which discards its card from your inventory. */
export const DISCARD_SLOT_TITLE = "discard · the undo key brings it back"
/** An open card's ×, which folds it back into its slot. */
export const CLOSE_CARD = "×"
export const CLOSE_CARD_TITLE = "close (Esc)"

/** A notice's React key: what it is about, and why. */
export const noticeKey = (notice: CardNotice): string =>
  `${notice.code}:${notice.card ?? ""}`

// ── pinned cards ──────────────────────────────────────────────────────────

/** A column's button that opens a box for a new pinned card. */
export const NEW_PIN = "+ pin"
export const NEW_PIN_TITLE =
  "write a new card pinned to the top of the column: the agent reads it on every run"

/** The box a new card is written in, at its list's end. */
export interface NewCardBoxView {
  /** Its frame's tone: the list's. */
  readonly tone: CardTone
  /** What it says while empty. */
  readonly placeholder: string
  readonly title: string
}

/** The box a new card at the end of `to` is written in. */
export function newCardBox(to: ListKey): NewCardBoxView {
  switch (to.kind) {
    case "note":
      return {
        tone: "note",
        placeholder: "write a note",
        title:
          "a new note at the column's end, which everyone in the canvas sees",
      }
    case "pinned":
      return {
        tone: "pinned",
        placeholder: "what the agent should keep in mind on every run",
        title:
          "a new card pinned to this thread: the agent reads it on every run",
      }
    case "margin":
      return {
        tone: "note",
        placeholder: "write a comment",
        title:
          "a comment on this message, which everyone in the canvas sees and no agent reads",
      }
  }
}

/** The pinned strip with no cards: where a drop pins one. */
export const PINNED_EMPTY = "drop a card here to pin it for the agent"

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

/** The marker's line for the cards pinned to the canvas a run read. */
export const canvasPinnedMarkerWords = (
  marker: NonNullable<PinnedMarker["canvasPinned"]>,
): string =>
  marker.cards.length === 0
    ? "the agent was told the canvas's pinned cards no longer apply"
    : `the agent read ${marker.cards.length} ${marker.cards.length === 1 ? "card" : "cards"} pinned to the canvas`

/** The marker's line for the canvas list a run was told. */
export const canvasMarkerWords = (canvas: CanvasView): string => {
  const n = canvas.lines.length + canvas.more
  return `the agent was told the canvas: ${n} ${n === 1 ? "card" : "cards"}`
}

/** A card the agent was told no longer applies, by its first line. */
export const retiredWords = (line: string): string =>
  `no longer applies: “${line}”`

// ── history and traces ────────────────────────────────────────────────────

/** A card's ⋯ item that shows where it has been, or hides it again. */
export const historyItemWords = (open: boolean): string =>
  open ? "Hide history" : "History"
export const HISTORY_TITLE = "where this card has been, and who moved it"

/** A verb as it reads after "by": "queued by Bea", "taken by Carl". */
const PARTICIPLE: Readonly<Record<Verb, string>> = {
  created: "created",
  sent: "sent",
  queued: "queued",
  unqueued: "unqueued",
  pinned: "pinned",
  unpinned: "unpinned",
  "took-into-inventory": "taken",
  put: "put",
  discarded: "discarded",
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
    case "moved":
    case "undone":
    case "redone": {
      const verb = PARTICIPLE[changeVerb(event.from, event.to)]
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
  discarded: "discarded",
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
