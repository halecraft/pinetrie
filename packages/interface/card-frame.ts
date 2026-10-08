// interface/card-frame — what one text card's frame shows, in every place
// (ADR-0111): its header (icon, place, state, who put it there, a command,
// ⋯ and ×), and its footer (one primary action, and ↑ ↓ in a list); and its
// face, the card folded in a grid's cell. Pure: `cardFrame` and `cardFace`
// decide them as values, `cardFrameWords` and `cardFaceWords` word them, and
// `CardFrame` and `CardFace` (`packages/web/card-frame.tsx`) draw them.

import type {
  CardCommand,
  CardRecord,
  LaneName,
  Position,
  WorkflowState,
  WriterId,
} from "@pinetrie/core"
import { commandOf } from "@pinetrie/core"
import { displayName, type PinnedStatus } from "@pinetrie/rules"
import { reorderOf } from "./card-intents.ts"
import {
  type CatchUps,
  commandNote,
  commandWords,
  pinnedStatusWords,
  reorderWords,
  unsentWords,
} from "./card-words.ts"
import type { ColumnAct } from "./intent.ts"
import { namesOf } from "./names.ts"
import { lineWords, type Reader } from "./send.ts"

/**
 * A card's colour, which says who reads it: its place (ADR-0111). Your
 * message is yours alone; a note is the team's (ADR-0113).
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

/** Where a Move to ▸ item takes a card: a place, or a new thread in a state (ADR-0111). */
export type CardMoveTo =
  | "message"
  | "note"
  | "queue"
  | "pinned"
  | "inventory"
  | { readonly kind: "thread"; readonly state: WorkflowState }

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
  readonly lane: LaneName
  readonly at: Position
}

/** What a frame is decided from; each optional fact is absent where it has no meaning. */
export interface CardFrameFacts {
  readonly me: WriterId
  readonly readOnly: boolean
  /** Where a queue from its column puts it; absent or null where nothing can be queued. */
  readonly queueOn?: QueueOn | null
  /** Its queue or the thread's pinned cards, as drawn; absent for no list. */
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
        take,
        ...threads,
      ]
    case "note":
      return [
        { to: "message", act: { kind: "toMessage", card: id } },
        ...queue,
        pin,
        take,
        ...threads,
      ]
    case "queued":
      return [
        {
          to: "note",
          act: { kind: "unqueue", card: id, lane: place.lane, by: place.by },
        },
        pin,
        take,
      ]
    case "pinned":
      return [{ to: "note", act: { kind: "unpin", card: id } }, ...queue, take]
    case "fresh":
      return [take]
    // Put is an inventory card's move, × discards it, and a drag moves it anywhere.
    case "inventory":
    case "gone":
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
  return card.unsent === null
    ? { kind: "none" }
    : { kind: "unsent", reason: card.unsent }
}

const byOf = (card: CardRecord, me: WriterId): WriterId | null => {
  switch (card.place.kind) {
    case "queued":
      return card.place.by
    case "pinned":
      return card.placer
    default:
      return card.owner === me ? null : card.owner
  }
}

/**
 * The frame of `card`, drawn as `tone`; with no card, the composer before
 * its first keystroke or the "+ pin" box: its tone and place alone, nothing
 * to move or discard yet. A fact is the host's (ADR-0080): it neither moves
 * nor is discarded, and a read-only column moves nothing.
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
  const movable = !facts.readOnly && card.carries.kind !== "fact"
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
    moves: movable ? moveItems(card, facts) : [],
    discards:
      movable &&
      card.place.kind !== "gone" &&
      (card.place.kind !== "inventory" || card.place.holder === facts.me),
  }
}

/** A Move to ▸ item's words. */
export interface MoveWords {
  readonly label: string
  readonly title: string
}

/** A frame in words. */
export interface CardFrameWords {
  readonly icon: string
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

const ICON: Readonly<Record<Exclude<CardTone, "queued">, string>> = {
  inventory: "▤",
  composing: "✎",
  note: "▭",
  pinned: "⚑",
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
    title: "take into your inventory (Ctrl+Shift+I)",
  },
}

/** A Move to ▸ item in words. */
export const moveWords = (to: CardMoveTo): MoveWords =>
  typeof to === "string"
    ? MOVE[to]
    : {
        label: `Move to a new thread in ${to.state.name}`,
        title: `a conversation of its own, its first message this card, in ${to.state.name} on the board`,
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
  const { state } = view
  return {
    icon:
      view.tone !== "queued"
        ? ICON[view.tone]
        : state.kind === "line"
          ? String(state.n + 1)
          : "↑",
    place: PLACE[view.tone],
    state: stateWords(state),
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

// ── a card's face (ADR-0113) ──────────────────────────────────────────────

/** A card folded: a grid's cell, a queued card at rest. */
export interface CardFaceView {
  readonly tone: CardTone
  readonly owner: WriterId
  readonly command: CardCommand | null
  /** Its first three lines, leading blank lines left out. */
  readonly lines: string
  /** The inventory's 1–9 for its slot; null elsewhere. */
  readonly key: string | null
}

/** `card` folded, with `text`, as `tone`; `key` its slot's 1–9 in your inventory. */
export const cardFace = (
  card: CardRecord,
  text: string,
  facts: { readonly tone: CardTone; readonly key: string | null },
): CardFaceView => ({
  tone: facts.tone,
  owner: card.owner,
  command: commandOf(card),
  lines: text.trimStart().split("\n").slice(0, 3).join("\n").trimEnd(),
  key: facts.key,
})

/** A face in words: its icon, its command's chip, and whose it is. */
export interface CardFaceWords {
  readonly icon: string
  readonly command: string | null
  /** Whose it is, for its title and its avatar's label. */
  readonly owner: string
}

export const cardFaceWords = (
  face: CardFaceView,
  reader: Reader,
): CardFaceWords => ({
  icon: face.tone === "queued" ? "↑" : ICON[face.tone],
  command: face.command === null ? null : COMMAND_CHIP[face.command],
  owner:
    face.owner === reader.me
      ? "you"
      : displayName(face.owner, reader.nameOf.get(face.owner)),
})

/** A command on a face: short, since a face has no thread to name (`commandWords` has). */
const COMMAND_CHIP: Readonly<Record<CardCommand, string>> = {
  "bring-up-to-date": "catch up",
  "continue-on-accepted": "continue",
  "catch-up-with-parent": "catch up with parent",
  split: "split",
}
