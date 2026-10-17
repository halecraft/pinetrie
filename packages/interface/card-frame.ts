// interface/card-frame — what a card's frame shows in every place: its header
// (place, state, who put it there, a command, ⋯ and ×) and its footer (one
// primary action, and ↑ ↓ in a list). The card's icon and face are its
// kind's (`face.ts`).

import type {
  CardCommand,
  CardKind,
  CardPlace,
  CardRecord,
  Position,
  ThreadId,
  WorkflowState,
  WriterId,
} from "@pinetrie/core"
import { commandOf, fitsPlace, KINDS } from "@pinetrie/core"
import { displayName, type PinnedStatus } from "@pinetrie/rules"
import { reorderOf } from "./card-intents.ts"
import {
  type CatchUps,
  commandNote,
  commandWords,
  pinnedStatusWords,
  reorderWords,
  TAKE,
  unsentWords,
} from "./card-words.ts"
import type { ColumnAct } from "./intent.ts"
import { namesOf } from "./names.ts"
import { lineWords, type Reader } from "./send.ts"

/**
 * A card's colour, which says who reads it: its place. Your
 * message is yours alone; a note is the team's.
 */
export type CardTone = "inventory" | "composing" | "note" | "queued" | "pinned"

/** What a card's header says of how it stands where it is. */
export type CardState =
  | { readonly kind: "none" }
  /** Queued, `n`th from 0, its queue held or not. */
  | { readonly kind: "line"; readonly n: number; readonly held: boolean }
  /** Why the host could not send it, until it is queued again. */
  | { readonly kind: "unsent"; readonly reason: string }
  /** Pinned: how it stands against what the agent last read (`pinnedStatus`). */
  | { readonly kind: "pinned"; readonly status: PinnedStatus }

/** The footer's one primary action: put for the inventory, send for your message. */
export type CardPrimary = "put" | "send"

/** Where a Move to ▸ item takes a card: a place, or a new thread in a state. */
type CardMoveTo =
  | "message"
  | "note"
  | "queue"
  /** A reference to it, queued on its thread; it stays. */
  | "reference"
  | "pinned"
  | "canvas"
  | "inventory"
  | { readonly kind: "thread"; readonly state: WorkflowState }

/**
 * The place each Move to ▸ item sends a card to, which its kind must be
 * ever in (`PLACES_OF`) to be offered it: a reference is never pinned, so
 * its ⋯ has no pin. A new thread's first message is your
 * message sent, so a card that is never your message makes none. Queueing
 * a reference to a comment leaves the comment where it is: any comment may.
 */
const MOVE_PLACES: Readonly<
  Record<Exclude<CardMoveTo, object>, CardPlace["kind"] | null>
> = {
  message: "composing",
  note: "note",
  queue: "queued",
  pinned: "pinned",
  canvas: "canvas-pinned",
  inventory: "inventory",
  reference: null,
}

/** Whether a card of `kind` is ever where `to` sends it (`MOVE_PLACES`). */
const offers = (kind: CardKind, to: CardMoveTo): boolean => {
  const place = MOVE_PLACES[typeof to === "string" ? to : "message"]
  return place === null || fitsPlace(kind, place)
}

/** One Move to ▸ item: the move a drag makes there. */
export interface CardMoveItem {
  readonly to: CardMoveTo
  readonly act: ColumnAct
}

/** A ↑ or ↓ in a queue or among pinned cards; `act` null at an edge. */
export interface CardTool {
  readonly step: -1 | 1
  readonly act: ColumnAct | null
}

export interface CardFrameView {
  readonly tone: CardTone
  readonly state: CardState
  /** Who put it there, said in its header: null for your own message or note. */
  readonly by: WriterId | null
  readonly command: CardCommand | null
  readonly primary: CardPrimary | null
  readonly tools: readonly CardTool[]
  /** Its ⋯'s Move to ▸, in a fixed order. */
  readonly moves: readonly CardMoveItem[]
  /** Whether × discards it: a card that exists, that you may move. */
  readonly discards: boolean
}

/** Where a queue from a column puts a card: as the composer's queue does. */
export interface QueueOn {
  readonly lane: ThreadId
  readonly at: Position
}

/** What a frame is decided from; each optional fact is absent where it has no meaning. */
export interface CardFrameFacts {
  readonly me: WriterId
  readonly readOnly: boolean
  /** Where a queue from its column puts it; absent or null where nothing can be queued. */
  readonly queueOn?: QueueOn | null
  /** Its queue, the thread's pinned cards or its note column's notes, as drawn; absent for no list. */
  readonly among?: readonly CardRecord[]
  /** Its queue is held. */
  readonly held?: boolean
  /** A pinned card's standing (`pinnedStatus`); absent or null for none. */
  readonly pinned?: PinnedStatus | null
  /** The board's open states, where a note or your message may start a thread; absent for none. */
  readonly threadIn?: readonly WorkflowState[]
}

const moveItems = (
  card: CardRecord,
  facts: CardFrameFacts,
): readonly CardMoveItem[] => {
  const { place } = card
  const id = card.id
  const queueOn = facts.queueOn ?? null
  const queue: readonly CardMoveItem[] =
    queueOn === null
      ? []
      : [
          {
            to: "queue",
            act: {
              kind: "queue",
              card: id,
              lane: queueOn.lane,
              at: queueOn.at,
              hold: "keep",
            },
          },
        ]
  const pin: CardMoveItem = { to: "pinned", act: { kind: "pin", card: id } }
  const pinCanvas: CardMoveItem = {
    to: "canvas",
    act: { kind: "pinToCanvas", card: id },
  }
  const take: CardMoveItem = {
    to: "inventory",
    act: { kind: "takeIntoInventory", card: id },
  }
  const threads = (facts.threadIn ?? []).map(
    (state): CardMoveItem => ({
      to: { kind: "thread", state },
      act: { kind: "spinOff", card: id, state: state.id },
    }),
  )
  switch (place.kind) {
    case "composing":
      return [
        { to: "note", act: { kind: "toNote", card: id } },
        ...queue,
        pin,
        pinCanvas,
        take,
        ...threads,
      ]
    // A note column is no thread's: a note has no message, queue or pinned
    // strip of its own to go to; a drag takes it there.
    case "note":
      return [pinCanvas, take, ...threads]
    case "queued":
      return [
        {
          to: "note",
          act: { kind: "unqueue", card: id, lane: place.thread, by: place.by },
        },
        pin,
        pinCanvas,
        take,
      ]
    case "pinned":
      return [
        { to: "note", act: { kind: "unpin", card: id } },
        ...queue,
        pinCanvas,
        take,
      ]
    // Unpinned from the canvas, it goes to the canvas's first note column.
    case "canvas-pinned":
      return [{ to: "note", act: { kind: "unpin", card: id } }, take]
    // A comment stays beside its entry: a reference to it tells the agent.
    case "margin":
      return [
        {
          to: "reference",
          act: {
            kind: "queueReference",
            card: id,
            entry: place.entry,
            thread: place.thread,
          },
        },
        take,
      ]
    // Put is an inventory card's move, × discards it, and a drag moves it
    // anywhere; a card on a canvas is no text card, nor one on the board.
    case "inventory":
    case "canvas":
    case "board":
    case "trash":
      return []
  }
}

const stateOf = (
  card: CardRecord,
  tone: CardTone,
  facts: CardFrameFacts,
): CardState => {
  if (card.place.kind === "queued") {
    const n = facts.among?.findIndex(c => c.id === card.id) ?? -1
    return n < 0
      ? { kind: "none" }
      : { kind: "line", n, held: facts.held ?? false }
  }
  if (tone === "pinned" && facts.pinned != null)
    return { kind: "pinned", status: facts.pinned }
  return card.kind !== "text" || card.content.unsent === null
    ? { kind: "none" }
    : { kind: "unsent", reason: card.content.unsent }
}

const byOf = (card: CardRecord, me: WriterId): WriterId | null => {
  switch (card.place.kind) {
    case "queued":
      return card.place.by
    case "pinned":
    case "canvas-pinned":
      return card.placer
    default:
      return card.owner === me ? null : card.owner
  }
}

/**
 * The frame of `card`, drawn as `tone`; with no card, the composer before
 * its first keystroke or the "+ pin" box: its tone and place alone, nothing
 * to move or discard yet. A kind no person moves (`KINDS`: a fact, the
 * host's) neither moves nor is discarded, and a read-only column
 * moves nothing.
 */
export function cardFrame(
  card: CardRecord | null,
  tone: CardTone,
  facts: CardFrameFacts,
): CardFrameView {
  const primary: CardPrimary | null =
    tone === "inventory" ? "put" : tone === "composing" ? "send" : null
  if (card === null)
    return {
      tone,
      state: { kind: "none" },
      by: null,
      command: null,
      primary,
      tools: [],
      moves: [],
      discards: false,
    }
  const movable = !facts.readOnly && KINDS[card.kind].moves
  const among = facts.among ?? null
  return {
    tone,
    state: stateOf(card, tone, facts),
    by: byOf(card, facts.me),
    command: commandOf(card),
    primary,
    tools:
      !movable || among === null
        ? []
        : ([-1, 1] as const).map(step => ({
            step,
            act:
              reorderOf(card, among, step) === null
                ? null
                : {
                    kind: "reorder",
                    card: card.id,
                    among: among.map(c => c.id),
                    step,
                  },
          })),
    moves: movable
      ? moveItems(card, facts).filter(m => offers(card.kind, m.to))
      : [],
    discards:
      movable &&
      card.place.kind !== "trash" &&
      (card.place.kind !== "inventory" || card.place.holder === facts.me),
  }
}

/** A Move to ▸ item's words. */
interface MoveWords {
  readonly label: string
  readonly title: string
}

/** A frame in words. */
interface CardFrameWords {
  /** Its place, always shown: the frame says where a card is before it exists. */
  readonly place: string
  readonly state: string | null
  readonly who: string | null
  /** The command's chip, and what it does as its title. */
  readonly command: { readonly label: string; readonly title: string } | null
  readonly tools: readonly {
    readonly label: string
    readonly title: string
    readonly className: string
  }[]
}

const PLACE: Readonly<Record<CardTone, string>> = {
  inventory: "inventory",
  composing: "your message",
  note: "note",
  queued: "queued",
  pinned: "pinned",
}

const MOVE: Readonly<Record<Exclude<CardMoveTo, object>, MoveWords>> = {
  queue: {
    label: "Move to the queue",
    title: "queue it on this thread: the agent reads it once",
  },
  pinned: {
    label: "Move to pinned",
    title: "pin to the top of the column: the agent reads it on every run",
  },
  canvas: {
    label: "Pin to the canvas",
    title:
      "pin to the canvas's column: every thread of the canvas reads it on every run",
  },
  note: {
    label: "Move to notes",
    title: "a note on the thread: people read it, the agent does not",
  },
  message: {
    label: "Move to your message",
    title:
      "into your composer, to send; a message there with text takes its place",
  },
  inventory: {
    label: "Move to your inventory",
    title: TAKE,
  },
  reference: {
    label: "Queue a reference",
    title:
      "queue a reference to this comment on its thread: the agent reads it, under the message it is on, once; the comment stays",
  },
}

/** A Move to ▸ item in words. */
export const moveWords = (to: CardMoveTo): MoveWords =>
  typeof to === "string"
    ? MOVE[to]
    : {
        label: `Move to a new thread in ${to.state.name}`,
        title: `a chat of its own, its first message this card, in ${to.state.name} on the board`,
      }

/** A Move to ▸ item's key, and its `data-to`: a place, or `thread:` and a state. */
export const moveKey = (to: CardMoveTo): string =>
  typeof to === "string" ? to : `thread:${to.state.id}`

const stateWords = (state: CardState): string | null => {
  switch (state.kind) {
    case "none":
      return null
    case "line": {
      const line = state.n === 0 ? "next" : lineWords(state.n)
      return state.held ? `held · ${line}` : line
    }
    case "unsent":
      return unsentWords(state.reason)
    case "pinned":
      return pinnedStatusWords(state.status)
  }
}

const whoWords = (
  view: CardFrameView,
  reader: Reader,
  writers: readonly WriterId[],
): string | null => {
  const { by } = view
  if (by === null) return null
  const name = by === reader.me ? "you" : displayName(by, reader.nameOf.get(by))
  switch (view.tone) {
    case "queued":
      return `queued by ${name}`
    case "pinned":
      return `pinned by ${name}`
    case "note": {
      const others = writers.filter(w => w !== by)
      return others.length === 0
        ? `${name}'s note`
        : `${name}'s note · with ${namesOf(reader.nameOf, others)}`
    }
    // Your message is only yours: nobody else's is drawn.
    case "composing":
      return null
    case "inventory":
      return `${name}'s card`
  }
}

/**
 * `view` in words, for `reader`. `writers`: who has text in the card, which
 * someone else's note names. `catchUps`: what a command catches up with at
 * the card's thread; null away from one, in your inventory, where a command
 * has nothing to name and no chip is drawn.
 */
export function cardFrameWords(
  view: CardFrameView,
  reader: Reader,
  catchUps: CatchUps | null,
  writers: readonly WriterId[],
): CardFrameWords {
  return {
    place: PLACE[view.tone],
    state: stateWords(view.state),
    who: whoWords(view, reader, writers),
    command:
      view.command === null || catchUps === null
        ? null
        : {
            label: commandWords(view.command, catchUps),
            title: commandNote(view.command, catchUps),
          },
    tools: view.tools.map(t => reorderWords(t.step)),
  }
}
