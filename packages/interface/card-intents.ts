// interface/card-intents — what take into the inventory, put, a paste, keep,
// discard and undo do, as effects.
//
// Each move says where it was made, so a refusal is said there. Which
// history a move enters is the host's to decide (`historyOf`); an undo names
// only the task you are on.

import {
  type Address,
  BACK,
  type CanvasTarget,
  type CardId,
  type CardRecord,
  cardFitsPlace,
  DISCARDED,
  type EntryId,
  isMovable,
  isReorderAt,
  isTargetOf,
  KINDS,
  keyOf,
  type MoveDirection,
  type MoveTarget,
  moveOf,
  type NoteColumnCard,
  type NoteColumnId,
  noteOf,
  type PlaceKey,
  type Position,
  parseCardId,
  parseTextCardId,
  pinnedOf,
  type QueueMove,
  type ReferenceCardId,
  type Reorder,
  type Sha256,
  sameKey,
  type TargetOf,
  type TaskId,
  type TextCard,
  type TextCardId,
  type ThreadCard,
  type ThreadId,
  type TraceRecord,
  type TypedMove,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { addressLink, taskOfPlace } from "@pinetrie/rules"
import {
  type ActedAt,
  AT_INVENTORY,
  atColumn,
  type CardNotice,
  firstEmpty,
  IN_COLUMN,
  LAST_ORDER,
  type MoveAnswer,
  type MoveHow,
  type Slots,
} from "@pinetrie/session"
import { addressWords } from "./address-words.ts"
import { type Clip, type ClipFacts, cardClip } from "./clip.ts"
import type { Minted } from "./columns.ts"
import { type Discardable, isDiscardable } from "./discardable.ts"
import {
  type CardFacts,
  changeViewOf,
  closeTaskEffects,
  type Effect,
  type IntentState,
  planOpenAt,
} from "./effects.ts"
import type { MessageAct } from "./message-tools.ts"
import { intoMessage, type PutTarget, placeOfTarget } from "./put-target.ts"
import { revealOf } from "./reveal.ts"
import { newTaskEffects, planSpinOff } from "./spin-off.ts"

/**
 * A move to send; `fly`: whether its card animates to where it lands;
 * `here`, for a discard, the task you are on.
 */
export const moveCard = (
  move: TypedMove,
  how: MoveHow,
  fly: boolean,
  queuedBy: WriterId | null = null,
  here: TaskId | null = null,
): Effect => ({ kind: "moveCard", move, how, queuedBy, fly, here })

/**
 * `card` queued on `to.lane` from `to.at`. Its text's version is left
 * empty: the session reads it as it sends.
 */
export const queueMove = (
  card: TextCard,
  to: { readonly lane: ThreadId; readonly at: Position },
): QueueMove => moveOf(card, { kind: "queued", thread: to.lane, seen: "" })

/**
 * A card made in `to.lane`'s queue: a move with no `from`, so
 * it is never drawn anywhere before the queue.
 */
export const queueNew = (
  card: CardId,
  to: { readonly lane: ThreadId; readonly at: Position },
): QueueMove => ({
  card,
  from: null,
  to: { kind: "queued", thread: to.lane, seen: "" },
})

/**
 * A queued or pinned card moved one place up (`step` -1) or down (1) in
 * `among`, its list as drawn: the reorder naming its new
 * neighbours. Null at an edge, for a card in neither kind of place, or when
 * the card it would pass is a fact, which keeps its place.
 */
export function reorderOf(
  card: CardRecord,
  among: readonly CardRecord[],
  step: -1 | 1,
): Reorder | null {
  const at = keyOf(card.place)
  if (!isReorderAt(at)) return null
  const from = among.findIndex(c => c.id === card.id)
  const to = from + step
  const passed = among[to]
  if (from < 0 || passed === undefined || !KINDS[passed.kind].reordered)
    return null
  const rest = among.filter(c => c.id !== card.id)
  return {
    card: card.id,
    at,
    after: rest[to - 1]?.id ?? null,
    before: rest[to]?.id ?? null,
  }
}

export const slotOf = (slots: Slots, card: CardId): number | null => {
  const found = Object.entries(slots).find(([, c]) => c === card)
  return found === undefined ? null : Number(found[0])
}

export const cardOf = (
  facts: Pick<CardFacts, "cards">,
  card: CardId,
): CardRecord | undefined => facts.cards.find(c => c.id === card)

/** `card`'s record when it is a text card's: what moves between a thread's places. */
export const textCardOf = (
  facts: Pick<CardFacts, "cards">,
  card: CardId,
): TextCard | undefined => {
  const now = cardOf(facts, card)
  return now?.kind === "text" ? now : undefined
}

/** What a put, a paste or a drop lands: a card where it is, or a clip. */
export type PutSource =
  /** A card where it is: a take, a put, a drop, or an Alt-drag's copy of it. */
  | { readonly kind: "card"; readonly card: CardId }
  /** What was copied: a paste, keep, the column menu's copies. */
  | { readonly kind: "clip"; readonly clip: Clip }

/** Whether a landing moves its source or lands a copy of it. */
export type PutHow = "move" | "copy"

/**
 * A reference's quote as a landing names it: a blob already kept (a
 * reference's own), markdown to keep first (the past's), or a comment's
 * text under a link to its entry, read as it is kept (`commentMarkdown`).
 */
export type Quote =
  | { readonly kind: "kept"; readonly sha: Sha256 }
  | { readonly kind: "markdown"; readonly text: string }
  | {
      readonly kind: "comment"
      readonly comment: TextCardId
      readonly entry: Address
    }

/** A landing that lands something: what a replacement may carry. */
type Lands = Extract<
  Landing,
  { readonly kind: "move" | "text" | "reference" | "uncut" }
>

/**
 * What a landing does, as a value: the drag engine
 * draws it before a drop (a lift, a + badge, the slot's card leaving for
 * the trash, grey when refused), and `planPut` carries it out, so the two
 * cannot differ.
 */
export type Landing =
  /** Nothing: a put where the card already is. */
  | { readonly kind: "none" }
  /** The card moves to `to`. */
  | { readonly kind: "move"; readonly card: CardId; readonly to: PutTarget }
  /** Two slots of your inventory swap. */
  | { readonly kind: "swap"; readonly a: number; readonly b: number }
  /** A new text card at `to`. */
  | {
      readonly kind: "text"
      readonly text: string
      readonly origin: Address | null
      readonly to: PutTarget
    }
  /** A new reference at `to`. */
  | {
      readonly kind: "reference"
      readonly address: Address
      readonly quote: Quote
      readonly to: PutTarget
    }
  /** A copy of a thread at its end `end`, at `to`. */
  | {
      readonly kind: "thread"
      readonly source: ThreadId
      readonly end: EntryId
      readonly to: PutTarget
    }
  /** The card you cut, out of your trash to `to`. */
  | { readonly kind: "uncut"; readonly card: CardId; readonly to: PutTarget }
  /** Text typed into the text box that has focus: text, or a link. */
  | { readonly kind: "insert"; readonly text: string }
  /** `landing` into an aimed slot, its card `old` to your trash first. */
  | {
      readonly kind: "replace"
      readonly old: CardId
      readonly landing: Lands
    }
  /** Refused here, as the host would refuse it, naming the card it is about. */
  | {
      readonly kind: "refused"
      readonly code: "full" | "no-place" | "not-replaced" | "slot-taken"
      readonly card: CardId | null
    }

/** What a copy of a card lands as: its kind's clip (`cardClip`), uncut. */
const clipOfCard = (card: CardRecord, state: IntentState): Clip | null => {
  const of = cardClip(card, clipFacts(state))
  return of === null ? null : { kind: "card", of, cut: false }
}

/** `IntentState`'s facts as a copy reads them (`ClipFacts`). */
export const clipFacts = (state: IntentState): ClipFacts => ({
  me: state.cards.me,
  cards: state.cards.cards,
  index: state.index,
  lanes: state.cards.lanes,
  textOf: state.clips.textOf,
  quoteOf: state.clips.quoteOf,
  cell: state.clips.cell,
})

/**
 * What landing `source` at `target` does.
 *
 * - **A move** of a card is a put or a drop: onto a canvas, a
 *   column, a composer, a state or the sidebar (`planPut` keeps those
 *   rules); a card in your inventory on another's slot swaps with it.
 * - **A copy** of a clip lands by what it is and where: into a text box,
 *   text as itself and anything else as a link; on a surface, text as a
 *   text card keeping its origin, the past as a reference, a text card as
 *   a text card with its text, a reference as a reference, a thread as its
 *   copy, a note column or a task as a reference to it where one may be.
 *   A cut card still in your trash is moved out of it instead.
 * - **The past** only ever copies: a drop of it with `move` copies.
 * - **A slot**: aimed and empty, the card lands there; aimed and
 *   filled, it replaces the card there, which must be one you may discard;
 *   unaimed, the selected slot if empty, else the first empty one, else
 *   refused `full`.
 */
export function putLanding(
  source: PutSource,
  target: PutTarget,
  how: PutHow,
  state: IntentState,
): Landing {
  const facts = state.cards
  if (source.kind === "card") {
    const now = cardOf(facts, source.card)
    if (now === undefined) return { kind: "none" }
    if (how === "copy") {
      const clip = clipOfCard(now, state)
      return clip === null
        ? { kind: "refused", code: "no-place", card: now.id }
        : putLanding({ kind: "clip", clip }, target, "copy", state)
    }
    if (target.kind === "text-box") return { kind: "none" }
    if (target.kind !== "inventory")
      return { kind: "move", card: now.id, to: target }
    if (!cardFitsPlace(now, "inventory"))
      return { kind: "refused", code: "no-place", card: now.id }
    const from = slotOf(facts.slots, now.id)
    if (from !== null && now.place.kind === "inventory") {
      if (target.slot === null || from === target.slot) return { kind: "none" }
      return { kind: "swap", a: from, b: target.slot }
    }
    return intoSlot(
      { kind: "move", card: now.id, to: target },
      target.slot,
      state,
    )
  }
  const lands = clipLanding(source.clip, target, state)
  if (target.kind !== "inventory") return lands
  switch (lands.kind) {
    case "text":
    case "reference":
    case "uncut":
      return intoSlot(lands, target.slot, state)
    // A thread's copy has no card to discard first: it needs an empty slot.
    case "thread": {
      const at = slotFor(target.slot, state)
      if (at.kind === "refused") return at
      return at.taken === null
        ? { ...lands, to: { kind: "inventory", slot: at.slot } }
        : { kind: "refused", code: "slot-taken", card: at.taken }
    }
    default:
      return lands
  }
}

/** Which slot a landing into your inventory takes: free, or the card it would replace. */
function slotFor(
  aimed: number | null,
  state: IntentState,
):
  | {
      readonly kind: "slot"
      readonly slot: number
      readonly taken: CardId | null
    }
  | Extract<Landing, { readonly kind: "refused" }> {
  const { slots, selected } = state.cards
  if (aimed !== null)
    return { kind: "slot", slot: aimed, taken: slots[String(aimed)] ?? null }
  const slot = firstEmpty(slots, selected)
  return slot === null
    ? { kind: "refused", code: "full", card: null }
    : { kind: "slot", slot, taken: null }
}

/** `lands` into your inventory at `aimed`, or at the first free slot for null. */
function intoSlot(
  lands: Lands,
  aimed: number | null,
  state: IntentState,
): Landing {
  const at = slotFor(aimed, state)
  if (at.kind === "refused")
    return { ...at, card: lands.kind === "move" ? lands.card : null }
  const into = { ...lands, to: { kind: "inventory", slot: at.slot } } as const
  if (at.taken === null) return into
  const old = cardOf(state.cards, at.taken)
  if (old === undefined) return into
  return isDiscardable(old, state.cards.me)
    ? { kind: "replace", old: old.id, landing: into }
    : { kind: "refused", code: "not-replaced", card: old.id }
}

/** What a copy of `clip` lands as at `target` before its slot. */
function clipLanding(
  clip: Clip,
  target: PutTarget,
  state: IntentState,
): Landing {
  if (target.kind === "text-box")
    return clip.kind === "text"
      ? { kind: "insert", text: clip.text }
      : { kind: "insert", text: linkOfClip(clip) }
  switch (clip.kind) {
    case "text":
      return { kind: "text", text: clip.text, origin: clip.origin, to: target }
    case "past":
      return {
        kind: "reference",
        address: clip.taken.address,
        quote: { kind: "markdown", text: clip.taken.markdown },
        to: target,
      }
    case "card": {
      const { of } = clip
      const cut = cardOf(state.cards, of.card)
      if (
        clip.cut &&
        cut !== undefined &&
        cut.place.kind === "trash" &&
        cut.placer === state.cards.me
      )
        return { kind: "uncut", card: of.card, to: target }
      switch (of.kind) {
        case "text":
          return {
            kind: "text",
            text: of.text,
            origin: { kind: "card", card: of.card },
            to: target,
          }
        case "reference":
          return {
            kind: "reference",
            address: of.address,
            quote: { kind: "kept", sha: of.quote },
            to: target,
          }
        case "thread":
          return { kind: "thread", source: of.card, end: of.end, to: target }
        case "note-column":
        case "task":
          return {
            kind: "reference",
            address: { kind: "card", card: of.card },
            quote: { kind: "markdown", text: of.text },
            to: target,
          }
      }
    }
  }
}

/** A clip's link, as a text box takes it (`addressLink`). */
const linkOfClip = (clip: Exclude<Clip, { readonly kind: "text" }>): string => {
  const address: Address =
    clip.kind === "past"
      ? clip.taken.address
      : clip.of.kind === "reference"
        ? clip.of.address
        : clip.of.kind === "thread"
          ? { kind: "thread", thread: clip.of.card }
          : { kind: "card", card: clip.of.card }
  return addressLink(address, addressWords(address))
}

/** Your inventory is full, or a slot refused: said in the panel, where it was aimed. */
const refusedAt = (
  code: Extract<Landing, { kind: "refused" }>["code"],
  card: CardId | null,
): CardNotice =>
  code === "not-replaced" || code === "slot-taken"
    ? { card, actedAt: AT_INVENTORY, code }
    : { card, actedAt: AT_INVENTORY, code, by: null, fromQueue: false }

/**
 * Land `source` at `target`: what `putLanding` decides, carried
 * out. A move of a card keeps every put's rules: a state or a place in the
 * sidebar makes a new thread there (`planSpinOff`); a thread's column, a
 * note in the note column nearest it; a note column, a note at its end;
 * a spot on a canvas, a text card in a note column made for it
 * there (`WRAPS`); a composer, your message there
 * (`putInMessage`). A copy is one paste the host makes, or a thread's copy;
 * into a text box, text typed at the caret. Anything landing in your
 * inventory from outside shows the panel briefly.
 */
export function planPut(
  source: PutSource,
  target: PutTarget,
  how: PutHow,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  return effectsOfLanding(putLanding(source, target, how, state), state, minted)
}

/** The effects of `landing`; `replacing`, the slot's card a replacement discards first. */
function effectsOfLanding(
  landing: Landing,
  state: IntentState,
  minted: Minted,
  replacing: Discardable | null = null,
): readonly Effect[] {
  const show: readonly Effect[] =
    "to" in landing && landing.to.kind === "inventory"
      ? [{ kind: "showInventory", brief: true }]
      : []
  switch (landing.kind) {
    case "none":
      return []
    // A kind that never lands there is no refusal anyone needs to read.
    case "refused":
      return landing.code === "no-place"
        ? []
        : [
            { kind: "showInventory", brief: true },
            { kind: "refuse", refusal: refusedAt(landing.code, landing.card) },
          ]
    case "swap":
      return [{ kind: "swapSlots", a: landing.a, b: landing.b }]
    case "insert":
      return [{ kind: "insertText", text: landing.text }]
    case "replace": {
      const old = cardOf(state.cards, landing.old)
      return old === undefined || !isDiscardable(old, state.cards.me)
        ? []
        : effectsOfLanding(landing.landing, state, minted, old)
    }
    case "move": {
      const now = cardOf(state.cards, landing.card)
      if (now === undefined) return []
      if (landing.to.kind !== "inventory")
        return putCard(now, landing.to, state, minted)
      if (!cardFitsPlace(now, "inventory")) return []
      const into = moveOf(now, { kind: "inventory", holder: state.cards.me })
      const how = { actedAt: AT_INVENTORY, slot: landing.to.slot }
      if (replacing === null) return [...show, moveCard(into, how, true)]
      // One move set, the slot's card to your trash first, so the host
      // never finds your inventory full.
      return [
        ...show,
        {
          kind: "moveCards",
          moves: [
            { move: moveOf(replacing, DISCARDED), slot: null },
            { move: into, slot: landing.to.slot },
          ],
          actedAt: AT_INVENTORY,
          close: [],
          here: taskOfTab(state),
        },
      ]
    }
    case "text":
    case "reference":
    case "uncut": {
      const to = pasteTarget(landing, state)
      if (to === null) return []
      const how = {
        actedAt: actedAtOf(landing.to),
        slot: landing.to.kind === "inventory" ? landing.to.slot : null,
      }
      return [
        ...show,
        {
          kind: "paste",
          paste:
            landing.kind === "text"
              ? {
                  kind: "text",
                  card: minted.text,
                  origin: landing.origin,
                  text: landing.text,
                }
              : landing.kind === "reference"
                ? {
                    kind: "reference",
                    card: minted.reference,
                    address: landing.address,
                    quote: landing.quote,
                  }
                : { kind: "uncut", card: landing.card },
          to,
          replacing:
            replacing === null
              ? null
              : { card: replacing.id, from: keyOf(replacing.place) },
          how,
          here: taskOfTab(state),
        },
      ]
    }
    case "thread": {
      const spot = spotOnCanvas(landing.to, state)
      const to: TargetOf<"thread"> | null =
        landing.to.kind === "inventory"
          ? { kind: "inventory", holder: state.cards.me }
          : spot === null
            ? null
            : { kind: "canvas-at", ...spot }
      if (to === null) return []
      return [
        ...show,
        {
          kind: "request",
          intent: {
            kind: "copy-thread",
            source: landing.source,
            end: landing.end,
            move: { card: minted.thread, from: null, to },
          },
        },
      ]
    }
  }
}

/**
 * Where a paste goes, as the host takes it: a slot is your inventory; a
 * spot on a canvas the target the host ranks; any other target the place it
 * names (`placeOfTarget`), a thread's column its nearest notes. Null for a
 * target no paste lands on (a state, the sidebar, a composer not drawn).
 */
function pasteTarget(
  landing: Extract<Landing, { kind: "text" | "reference" | "uncut" }>,
  state: IntentState,
): MoveTarget | null {
  const { to } = landing
  if (to.kind === "canvas") return canvasSpot(to)
  return placeOfTarget(to, state.cards.composers, state.cards.me)
}

/**
 * A card put at `target`: a spin-off onto a state or the sidebar; a card
 * that lives on a canvas onto one; a text card onto a spot on a canvas in a
 * note column made for it; into a composer as your message; else to the
 * place the target names. Nothing for a card no person moves, or for a
 * note put on its own column, which a reorder moves.
 */
function putCard(
  now: CardRecord,
  target: PutTarget,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  if (target.kind === "state") return planSpinOff(now.id, target, minted, state)
  // Between tasks in the sidebar: a text card spins a new task off; a
  // column makes one holding it, placed there, and you stay where you are.
  if (target.kind === "sidebar") {
    if (now.kind !== "thread" && now.kind !== "note-column")
      return planSpinOff(now.id, target, minted, state)
    return [
      {
        kind: "moveCards",
        moves: [
          {
            move: moveOf(now, { kind: "new-task", task: minted.task }),
            slot: null,
          },
        ],
        actedAt: AT_INVENTORY,
        close: newTaskEffects(minted.task, target.before, false),
        here: minted.task,
      },
    ]
  }
  // A thread's card or a note column goes on a canvas; a kind
  // the host alone places is put nowhere.
  if (!isMovable(now)) return []
  if (now.kind === "thread" || now.kind === "note-column")
    return putOnCanvas(now, target, state)
  if (now.kind !== "text" && now.kind !== "reference") return []
  // A text card or a reference on a canvas, or onto a task in the sidebar,
  // lands in a note column made for it (`WRAPS`).
  if (target.kind === "canvas" || target.kind === "task") {
    const spot = spotOnCanvas(target, state)
    return spot === null
      ? []
      : [
          moveCard(
            moveOf(now, { kind: "canvas-at", ...spot }),
            { actedAt: actedAtOf(target), slot: null },
            true,
          ),
        ]
  }
  // Only a text card becomes your message.
  if (
    now.kind === "text" &&
    (target.kind === "column" || target.kind === "composer") &&
    intoMessage(target)
  )
    return putInMessage(now, target.key, state)
  const to = placeOfTarget(target, state.cards.composers, state.cards.me)
  // A note put on its own column stays where it is: a reorder moves it there.
  if (to === null || (to.kind !== "notes" && sameKey(keyOf(now.place), to)))
    return []
  const how = { actedAt: actedAtOf(target), slot: null }
  if (now.kind === "text") return [moveCard(moveOf(now, to), how, true)]
  return isTargetOf("reference", to)
    ? [moveCard(moveOf(now, to), how, true)]
    : []
}

/**
 * Where a put's refusal is said: the column it was put on; a task's pins,
 * its task column's; a note column, its own; elsewhere, the inventory.
 */
const actedAtOf = (target: PutTarget): ActedAt => {
  switch (target.kind) {
    case "notes":
      return atColumn(target.column)
    case "taskPinned":
      return atColumn(target.task)
    case "column":
    case "composer":
    case "pinned":
      return atColumn(target.key)
    case "inventory":
    case "state":
    case "sidebar":
    case "task":
    case "text-box":
    case "canvas":
      return AT_INVENTORY
  }
}

/** A spot on a canvas a put names, as the target the host ranks (`canvas-at`). */
const canvasSpot = (
  target: Extract<PutTarget, { kind: "canvas" }>,
): CanvasTarget => ({
  kind: "canvas-at",
  task: target.task,
  after: target.after,
})

/**
 * A card that lives on a canvas, put from your inventory: on the
 * canvas of the task you are on, just after the column it was put on, or
 * first on a task's pinned cards' column, or at the spot on a canvas it was
 * dropped on; unfolded, so you see it land.
 * Nothing on the canvas it is on already, where a reorder moves it, nor on
 * a state or the sidebar, which make a thread from a text card alone.
 */
function putOnCanvas(
  now: ThreadCard | NoteColumnCard,
  target: PutTarget,
  state: IntentState,
): readonly Effect[] {
  const spot = spotOnCanvas(target, state)
  if (spot === null) return []
  if (now.place.kind === "canvas" && now.place.task === spot.task) return []
  return [
    moveCard(
      moveOf(now, { kind: "canvas-at", ...spot }),
      { actedAt: AT_INVENTORY, slot: null },
      false,
    ),
    changeViewOf(state, spot.task, {
      kind: "fold",
      card: now.id,
      unfolded: true,
    }),
  ]
}

/**
 * The spot on a canvas `target` names for a card that lives on one: the
 * spot itself; first on a task's pinned cards' column; just after a column
 * or a note column on the task you are on. Null for any other target.
 */
function spotOnCanvas(
  target: PutTarget,
  state: IntentState,
): { readonly task: TaskId; readonly after: CardId | null } | null {
  const here = taskOfTab(state)
  switch (target.kind) {
    case "canvas":
      return { task: target.task, after: target.after }
    case "taskPinned":
      return { task: target.task, after: null }
    // Onto a task in the sidebar: at the end of its canvas.
    case "task":
      return {
        task: target.task,
        after: state.tasks.index.canvases.get(target.task)?.at(-1)?.id ?? null,
      }
    case "notes":
      return here === null ? null : { task: here, after: target.column }
    case "column":
    case "composer":
    case "pinned":
      return here === null
        ? null
        : { task: here, after: parseCardId(target.key) ?? null }
    default:
      return null
  }
}

/**
 * `now` as your message in column `key`'s composer. A message
 * there with text takes `now`'s place, a slot of your inventory included,
 * in one move the host accepts or refuses whole, so one undo; an empty one
 * is discarded.
 */
function putInMessage(
  now: TextCard,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const spot = facts.composers.get(key)
  if (spot === undefined || spot.message === now.id) return []
  const to = keyOf(spot.place)
  const from = keyOf(now.place)
  if (sameKey(from, to)) return []
  const actedAt = atColumn(key)
  const into = { move: moveOf(now, to), slot: null }
  const message =
    spot.message === null ? undefined : textCardOf(facts, spot.message)
  if (message === undefined)
    return [moveCard(into.move, { actedAt, slot: null }, true)]
  if (!facts.filled.has(message.id)) {
    const away = moveOf(message, DISCARDED)
    return [
      {
        kind: "moveCards",
        moves: [into, { move: away, slot: null }],
        actedAt,
        close: [],
        here: taskOfTab(state),
      },
    ]
  }
  const back = {
    move: moveOf(message, from),
    slot: now.place.kind === "inventory" ? slotOf(facts.slots, now.id) : null,
  }
  return [
    { kind: "moveCards", moves: [into, back], actedAt, close: [], here: null },
  ]
}

/** Your message `card` to the note column nearest its thread. */
export function planToNote(
  card: CardId,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const now = textCardOf(state.cards, card)
  return now?.place.kind === "composing"
    ? [moveCard(moveOf(now, noteOf(now.place)), IN_COLUMN(key), true)]
    : []
}

/**
 * A new, empty note made at the end of note column `column`: a
 * creation, in no history, drawn last until the host gives it its order.
 */
export function planNewNote(
  card: TextCardId,
  column: NoteColumnId,
  state: IntentState,
): readonly Effect[] {
  return [
    {
      kind: "createCard",
      card: {
        kind: "text",
        id: card,
        owner: state.cards.me,
        placer: state.cards.me,
        place: { kind: "note", column, order: LAST_ORDER },
        content: { command: null, unsent: null, origin: null },
      },
      text: "",
      how: IN_COLUMN(column),
    },
  ]
}

/**
 * A comment on an entry: a new, empty note in its margin, made
 * by you, which the host places at the margin's end.
 */
export function planComment(
  act: Extract<MessageAct, { kind: "comment" }>,
  state: IntentState,
): readonly Effect[] {
  return [
    {
      kind: "createCard",
      card: {
        kind: "text",
        id: act.card,
        owner: state.cards.me,
        placer: state.cards.me,
        place: {
          kind: "margin",
          entry: act.entry,
          thread: act.thread,
          order: LAST_ORDER,
        },
        content: { command: null, unsent: null, origin: null },
      },
      text: "",
      how: IN_COLUMN(act.thread),
    },
  ]
}

/**
 * Edit a reference as text: a paste of its quote as a text card
 * that replaces it, in its very place, keeping its
 * address as its origin; one step of history, the reference to your trash
 * first, so a full inventory takes it too. Nothing for a card that is no
 * reference, or one you may not discard.
 */
export function planEditAsText(
  edit: {
    readonly reference: CardId
    readonly card: TextCardId
    readonly text: string
  },
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const now = cardOf(facts, edit.reference)
  if (now?.kind !== "reference" || !isDiscardable(now, facts.me)) return []
  const from = keyOf(now.place)
  return [
    {
      kind: "paste",
      paste: {
        kind: "text",
        card: edit.card,
        origin: now.content.address,
        text: edit.text,
      },
      to: from,
      replacing: { card: now.id, from },
      how: {
        actedAt: AT_INVENTORY,
        slot:
          now.place.kind === "inventory" ? slotOf(facts.slots, now.id) : null,
      },
      here: taskOfTab(state),
    },
  ]
}

/**
 * A reference to a comment, `card`, queued on its thread as `reference`:
 * a paste, its quote the comment's text under a
 * link to its entry (`commentMarkdown`), read and kept as it is queued;
 * the comment stays.
 */
export function planQueueReference(
  act: {
    readonly card: CardId
    readonly entry: EntryId
    readonly thread: ThreadId
  },
  reference: ReferenceCardId,
  how: MoveHow,
  state: IntentState,
): readonly Effect[] {
  const comment = parseTextCardId(act.card)
  return comment === undefined
    ? []
    : [
        {
          kind: "paste",
          paste: {
            kind: "reference",
            card: reference,
            address: { kind: "card", card: comment },
            quote: {
              kind: "comment",
              comment,
              entry: { kind: "entry", thread: act.thread, entry: act.entry },
            },
          },
          to: { kind: "queued", thread: act.thread, seen: "" },
          replacing: null,
          how,
          here: taskOfTab(state),
        },
      ]
}

/**
 * Pin `card`, your message or a queued card, at the top of its thread's
 * column. A move like any other: the host records it, and an undo
 * of moves reverses it.
 */
export function planPin(
  card: CardId,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const now = textCardOf(state.cards, card)
  const to = now === undefined ? null : pinnedOf(now.place)
  return now === undefined || to === null
    ? []
    : [moveCard(moveOf(now, to), IN_COLUMN(key), true)]
}

/**
 * Unpin `card`: to the note column nearest its thread; pinned to the task,
 * to the one nearest the task column.
 */
export function planUnpin(
  card: CardId,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const now = textCardOf(state.cards, card)
  if (now?.place.kind === "pinned")
    return [moveCard(moveOf(now, noteOf(now.place)), IN_COLUMN(key), true)]
  if (now?.place.kind === "task-pinned")
    return [
      moveCard(
        moveOf(now, { kind: "notes", near: "task", task: now.place.task }),
        IN_COLUMN(key),
        true,
      ),
    ]
  return []
}

/**
 * Pin `card` to the task it is in, else the task you are on:
 * every thread of it reads the card on every run. A move like any other,
 * which the undo key takes back.
 */
export function planPinToTask(
  card: CardId,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const now = textCardOf(state.cards, card)
  if (now === undefined || now.place.kind === "task-pinned") return []
  const active = state.layout.active
  const task =
    taskOfPlace(state.tasks.index, now.place) ??
    (active?.kind === "task" ? active.task : null)
  return task === null
    ? []
    : [
        moveCard(
          moveOf(now, { kind: "task-pinned", task }),
          IN_COLUMN(key),
          true,
        ),
      ]
}

/**
 * Discard `card`: a move to gone, in the history of the root it
 * is in, else of the root you are on, so the undo key there brings it back.
 * Made where `how` says; nothing for a card not drawn or not yours to move.
 */
export function planDiscard(
  card: CardId,
  how: MoveHow,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  if (now === undefined || !isDiscardable(now, state.cards.me)) return []
  const move = moveOf(now, DISCARDED)
  const emptied = emptiedNewTab(now, state)
  if (emptied === null)
    return [moveCard(move, how, false, null, taskOfTab(state))]
  // The only thread of a new tab, not yet started: the task leaves your
  // sidebar too, once the host accepts, as the host trashes its card.
  return [
    {
      kind: "moveCards",
      moves: [{ move, slot: null }],
      actedAt: how.actedAt,
      close: closeTaskEffects(emptied),
      here: emptied,
    },
  ]
}

/**
 * The task a discard of `card` empties, when it is a new tab's: a thread
 * not yet started, the only card on its canvas. Null for any other card.
 */
function emptiedNewTab(card: CardRecord, state: IntentState): TaskId | null {
  if (card.kind !== "thread" || card.place.kind !== "canvas") return null
  if (state.index.firstOf.has(card.id)) return null
  const { task } = card.place
  return (state.tasks.index.canvases.get(task) ?? []).length === 1 ? task : null
}

/**
 * Restore a trashed card back to where it was, for anyone who may: the
 * host resolves `back` and refuses one whose place is gone or taken.
 * Nothing for a card not drawn in a trash.
 */
export function planRestore(
  card: CardId,
  how: MoveHow,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  if (now === undefined || now.place.kind !== "trash") return []
  switch (now.kind) {
    case "text":
    case "reference":
    case "thread":
    case "note-column":
      return [moveCard(moveOf(now, BACK), how, false)]
    default:
      return []
  }
}

/** After a keep's answer: the column closes only if the keep was accepted. */
export const afterKeep = (
  answer: MoveAnswer,
  close: readonly Effect[],
): readonly Effect[] => (answer.kind === "accepted" ? close : [])

/**
 * The task an undo of moves acts in, and a discard's history: the task you
 * are on. None on nothing.
 */
export function taskOfTab(state: IntentState): TaskId | null {
  const active = state.layout.active
  return active?.kind === "task" ? active.task : null
}

/**
 * Undo or redo your newest move in the task you are on, or, on none, in
 * your history outside any task, which the host does whole or refuses;
 * with the inventory panel focused, this tab's
 * newest swap.
 */
export function planUndoMove(
  direction: MoveDirection,
  inPanel: boolean,
  state: IntentState,
): readonly Effect[] {
  if (inPanel) return [{ kind: "undoSwap", direction }]
  return [{ kind: "undoMoves", task: taskOfTab(state), direction }]
}

/**
 * What the host's answer to an undo of moves brings into view, so an undo
 * shows where it acts: each place a card went back to, once; or,
 * refused, the card where it is now, saying who moved it.
 */
export function afterUndo(
  outcome: Outcome,
  state: IntentState,
): readonly Effect[] {
  switch (outcome.kind) {
    case "undone": {
      const places: { readonly place: PlaceKey; readonly card: CardId }[] = []
      for (const { card, place } of outcome.cards)
        if (place !== null && !places.some(p => sameKey(p.place, place)))
          places.push({ place, card })
      return places.flatMap(p => revealOf(p.place, state, p.card).effects)
    }
    case "unmoved": {
      const shown =
        outcome.place === null
          ? {
              effects: [{ kind: "showInventory", brief: false }] as const,
              actedAt: AT_INVENTORY,
            }
          : revealOf(outcome.place, state)
      return [
        ...shown.effects,
        {
          kind: "refuse",
          refusal: {
            card: null,
            actedAt: shown.actedAt,
            code: outcome.code,
            by: outcome.by,
            fromQueue: false,
          },
        },
      ]
    }
    default:
      return []
  }
}

/**
 * Where a trace leads: the card's place now, or,
 * for a card sent, the message it became. Nothing for a card in someone
 * else's inventory, or one gone some other way.
 */
export function planOpenTrace(
  trace: TraceRecord,
  state: IntentState,
): readonly Effect[] {
  const now = state.cards.cards.find(c => c.id === trace.card)
  if (now === undefined)
    return trace.message === null ? [] : planOpenAt(trace.message, state)
  if (now.place.kind === "inventory" && now.place.holder !== state.cards.me)
    return []
  return revealOf(keyOf(now.place), state, now.id).effects
}
