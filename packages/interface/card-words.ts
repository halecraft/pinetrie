// interface/card-words — what a card says about its place and its command,
// each label in one function.

import type {
  LatestFrom,
  ParentThread,
  ThreadBase,
  WriterId,
} from "@pinetrie/core"
import {
  type CardEvent,
  changeVerb,
  displayName,
  factLine,
  latestSourceName,
  type PinnedStatus,
  relayLine,
  type Verb,
} from "@pinetrie/rules"
import type { CardNotice } from "@pinetrie/session"
import type {
  CanvasView,
  Card,
  CardCommand,
  GetLatestCommand,
  ListKey,
} from "@pinetrie/threads"
import type { CardTone } from "./card-frame.ts"
import type { PinnedMarker } from "./column-view.ts"
import type { Reader } from "./send.ts"
import type { TraceGroup } from "./traces.ts"

/** What a thread catches up with, for a command's words. */
export interface LatestSources {
  /** The thread's base (`effectiveBase`). */
  readonly base: ThreadBase
  /** The thread it branched from; null for one that began at its base. */
  readonly parent: ParentThread | null
}

/**
 * What a command merges: the base for `get-latest`, accepted work for
 * `continue-on-accepted`, the thread it branched from for
 * `get-latest-from-parent`. Null for that one without a parent.
 */
const commandFrom = (
  command: GetLatestCommand,
  { base, parent }: LatestSources,
): LatestFrom | null => {
  switch (command) {
    case "get-latest":
      return base
    case "continue-on-accepted":
      return { kind: "accepted" }
    case "get-latest-from-parent":
      return parent
  }
}

/** A split's words: the button's, and above a card that carries it. */
const SPLIT = "split into a stack"

/**
 * A command in a word or two, where no thread can be named: a card's face, and
 * the send button of a card that carries it (`commandWords` names the thread).
 */
export const COMMAND_VERB: Readonly<Record<CardCommand, string>> = {
  "get-latest": "get the latest",
  "continue-on-accepted": "continue",
  "get-latest-from-parent": "get the parent's latest",
  split: "split",
}

const fromName = (from: LatestFrom | null) =>
  from === null ? "the thread this one branched from" : latestSourceName(from)

/** Getting the parent thread's latest, naming it when it is known. */
const parentLatestWords = (from: LatestFrom | null): string =>
  from === null
    ? "get the parent thread's latest"
    : `get ${latestSourceName(from)}'s latest`

/** A command's name as people read it: the strip's button. */
export const commandWords = (
  command: CardCommand,
  at: LatestSources,
): string =>
  command === "split"
    ? SPLIT
    : command === "continue-on-accepted"
      ? "continue from the latest work"
      : command === "get-latest-from-parent"
        ? parentLatestWords(commandFrom(command, at))
        : "get the latest"

/**
 * What a card with a command does when sent, above its box, and on a queued
 * one: the command first, then the card's text as the agent's next message.
 */
export const commandNote = (command: CardCommand, at: LatestSources): string =>
  command === "split"
    ? "⇶ splits the changes into a stack, with what you write as its brief"
    : command === "continue-on-accepted"
      ? "↓ continues from accepted work first, then sends what you write"
      : `↓ gets the latest from ${fromName(commandFrom(command, at))} first, then sends what you write`

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

/** What a trash of yours says where you made it, until your next move there. */
const TRASHED_NOTICE = "trashed · ⌘Z brings it back"

/**
 * Something of yours to say where you acted: a trash, or a
 * refusal: a move, a reorder or an undo the host refused, or an
 * undone swap whose slots changed. Gone from the queue, the host had popped
 * the card first, so it was sent as its queuer's message; moved,
 * someone else moved it first; order changed, the cards a reorder named
 * moved first.
 */
export function noticeWords(notice: CardNotice, reader: Reader): string {
  if (notice.code === "trashed") return TRASHED_NOTICE
  if (notice.code === "slots-changed")
    return "not undone: those slots have changed since"
  if (notice.code === "not-replaced")
    return "not replaced: the card in that slot can't be trashed"
  if (notice.code === "slot-taken")
    return "not pasted: a thread's copy lands only in an empty slot"
  const { by } = notice
  switch (notice.code) {
    case "gone":
      if (!notice.fromQueue) return "not moved: it was sent or trashed first"
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
    case "someone-elses":
      return "not moved: that inventory is someone else's"
    // A reorder of a fact's card, or one that would pass it: it stays put.
    case "fact":
      return "not moved: a card the agent is about to read keeps its place"
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
/** The panel's own ×, which closes it, as Escape and its toggle do. */
export const CLOSE_INVENTORY = {
  label: "×",
  title: "close your inventory (Esc)",
} as const
/** Take into your inventory: one name and one key wherever it is offered. */
export const PUT_AWAY = "put away into your inventory (Ctrl+Shift+I)"
/** The clipboard cell's button: its copy into a free slot. */
export const SAVE = "save to your inventory"
export const SAVE_TITLE =
  "save this in your inventory, in a free slot: a copy, as a paste makes"
/** The clipboard cell's heading: what it shows, and that it knows no more. */
export const CLIPBOARD_CELL = "last copied here"
export const CLIPBOARD_CELL_TITLE =
  "what you last copied in this tab; a copy made in another app shows here once you paste it"
/** The panel's button that puts the selected card in the column last focused. */
export const PUT = "put"
export const PUT_TITLE =
  "put into your message box in the column you were in (Ctrl+Shift+O)"
/** A card's trash button, drawn as a bin; the undo key brings it back. */
export const TRASH_CARD_TITLE =
  "trash (Ctrl+Shift+Backspace) · ⌘Z brings it back"
/** The bench's trash button, and Delete on a selected slot: its card to your trash. */
export const TRASH_SELECTED = {
  label: "trash",
  title: "trash this card (Delete) · ⌘Z brings it back",
} as const
/** The × of a card open on the bench: back to read only, the card kept. */
export const CLOSE_CARD = {
  label: "×",
  title: "close (Esc): back to read only, the card kept",
} as const

/** A notice's React key: what it is about, and why. */
export const noticeKey = (notice: CardNotice): string =>
  `${notice.code}:${notice.card ?? ""}`

// ── pinned cards ──────────────────────────────────────────────────────────

/** A column's button that opens a box for a new pinned card. */
export const NEW_PIN = "+ pin"
/** The ⋯ item that opens the same box. */
export const PIN_A_CARD = "Pin a card"
/** What a ⋯'s rename says, a canvas's in the sidebar and a list column's alike. */
export const RENAME = "Rename"
export const NEW_PIN_TITLE =
  "write a new card pinned to the top of the column: the agent reads it on every run"

/** The box a new card is written in, at its list's end. */
interface NewCardBoxView {
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
        title: `a comment on this ${to.on.kind === "entry" ? "message" : "image"}, which everyone in the canvas sees and no agent reads`,
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
export const tokenSizeWords = (tokens: number): string =>
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
  "put-away": "put away",
  put: "put",
  trashed: "trashed",
  moved: "moved",
}

/** One event in a card's history. */
export function historyWords(event: CardEvent, reader: Reader): string {
  const by = event.by === null ? "" : ` by ${who(event.by, reader)}`
  switch (event.kind) {
    case "created":
      return `created${by}`
    case "unsent":
      return "not sent: back in your message box"
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

/** A verb as its doer does it, with what it did it to: "Bea queued this", "Carl put this away". */
const ACTIVE: Readonly<Record<Verb, string>> = {
  created: "created this",
  sent: "sent this",
  queued: "queued this",
  unqueued: "unqueued this",
  pinned: "pinned this",
  unpinned: "unpinned this",
  "put-away": "put this away",
  put: "put this",
  trashed: "trashed this",
  moved: "moved this",
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
  return `${name} ${ACTIVE[group.verb]}${arrow}`
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

/** The one line a fact's or an ask's card shows at every width: the host's, waiting for its thread's end. */
export const hostCardLine = (card: Card<"fact"> | Card<"ask">): string =>
  card.kind === "fact"
    ? factLine(card.content.fact)
    : relayLine(card.content.relay)
