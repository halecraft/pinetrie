// client/card-intents — what take into the inventory, put, keep, remove and
// undo do (ADR-0048 step 4, ADR-0052, ADR-0059, ADR-0066), as effects. Pure:
// `planIntent` calls these, and `perform` carries out what they return.
//
// Every input makes the same moves: a key, a button and a drop each become
// one of these intents. A take into the inventory lands in the selected
// slot when it is empty, else the first empty one (`firstEmpty`); a put
// lands where the target's composer would create a card (`placeOfTarget`). Each move says where it was
// made, so a refusal is said there. Which history a move enters is the
// host's to decide (`historyOf`); an undo names only the root you are on.

import {
  type CardId,
  type CardRecord,
  draftingOf,
  keyOf,
  type LaneName,
  type Move,
  type MoveDirection,
  moveOf,
  type PlaceKey,
  type Position,
  pinnedOf,
  queueRoot,
  type Reorder,
  type RootId,
  sameKey,
  type TraceRecord,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  AT_INVENTORY,
  atColumn,
  type CardRefusal,
  firstEmpty,
  IN_COLUMN,
  type MoveAnswer,
  type MoveHow,
  type Slots,
} from "@pinetrie/session"
import {
  type CardFacts,
  type Effect,
  type IntentState,
  planOpenAt,
} from "./intent.ts"
import { type PutTarget, placeOfTarget } from "./put-target.ts"
import { revealOf } from "./reveal.ts"

/** A move to send; `fly`: whether its card animates to where it lands. */
export const moveCard = (
  move: Move,
  how: MoveHow,
  fly: boolean,
  queuedBy: WriterId | null = null,
): Effect => ({ kind: "moveCard", move, how, queuedBy, fly })

/**
 * `card` queued on `to.lane` from `to.at`, in its lane's root (`queueRoot`);
 * null for a card that can take no root. Its text's version is left empty:
 * the session reads it as it sends (S96).
 */
export function queueMove(
  card: CardRecord,
  to: { readonly lane: LaneName; readonly at: Position },
  facts: Pick<CardFacts, "laneRecords">,
): Move | null {
  const root = queueRoot(to.lane, card, facts.laneRecords)
  return root === undefined
    ? null
    : moveOf(card, { kind: "queued", root, at: to.at, lane: to.lane, seen: "" })
}

/**
 * A queued or pinned card moved one place up (`step` -1) or down (1) in
 * `among`, its list as drawn (ADR-0048 step 7): the reorder naming its new
 * neighbours. Null at an edge, for a card in neither kind of place, or when
 * the card it would pass is a fact, which keeps its place. Pure.
 */
export function reorderOf(
  card: CardRecord,
  among: readonly CardRecord[],
  step: -1 | 1,
): Reorder | null {
  const at = keyOf(card.place)
  if (at.kind !== "queued" && at.kind !== "pinned") return null
  const from = among.findIndex(c => c.id === card.id)
  const to = from + step
  const passed = among[to]
  if (from < 0 || passed === undefined || passed.carries.kind === "fact")
    return null
  const rest = among.filter(c => c.id !== card.id)
  return {
    card: card.id,
    at,
    after: rest[to - 1]?.id ?? null,
    before: rest[to]?.id ?? null,
  }
}

const slotOf = (slots: Slots, card: CardId): number | null => {
  const found = Object.entries(slots).find(([, c]) => c === card)
  return found === undefined ? null : Number(found[0])
}

export const cardOf = (
  facts: Pick<CardFacts, "cards">,
  card: CardId,
): CardRecord | undefined => facts.cards.find(c => c.id === card)

/** A take into the inventory refused before it is sent: it is full, as the host would say. */
const full = (card: CardId): CardRefusal => ({
  card,
  actedAt: AT_INVENTORY,
  code: "full",
  by: null,
  fromQueue: false,
})

/** A handoff into your inventory, at `slot`. */
const moveIntoInventorySlot = (
  card: CardRecord,
  slot: number,
  me: CardFacts["me"],
) =>
  moveCard(
    moveOf(card, { kind: "inventory", holder: me }),
    {
      actedAt: AT_INVENTORY,
      slot,
    },
    true,
  )

/**
 * Take `card` into your inventory: the selected slot if it is empty, else
 * the first empty one. Full, it is refused here, as the host would.
 */
export function planTakeIntoInventory(
  card: CardId,
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const now = cardOf(facts, card)
  if (now === undefined || now.place.kind === "inventory") return []
  return takeIntoInventoryAt(now, facts.selected, state)
}

function takeIntoInventoryAt(
  now: CardRecord,
  start: number,
  state: IntentState,
): readonly Effect[] {
  const slot = firstEmpty(state.cards.slots, start)
  const show: Effect = { kind: "showInventory", brief: true }
  if (slot === null) return [show, { kind: "refuse", refusal: full(now.id) }]
  return [show, moveIntoInventorySlot(now, slot, state.cards.me)]
}

/**
 * A copy of a message's text, or of a selection in it, as a new card in your
 * inventory. A creation, so it enters no history: discarding removes it.
 */
export function planTakeCopyIntoInventory(
  card: CardId,
  text: string,
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const slot = firstEmpty(facts.slots, facts.selected)
  const show: Effect = { kind: "showInventory", brief: true }
  if (slot === null) return [show, { kind: "refuse", refusal: full(card) }]
  return [
    show,
    {
      kind: "createCard",
      card: {
        id: card,
        owner: facts.me,
        placer: facts.me,
        place: { kind: "inventory", holder: facts.me },
        carries: { kind: "message", command: null },
        unsent: null,
      },
      text,
      how: { actedAt: AT_INVENTORY, slot },
    },
  ]
}

/**
 * Put `card` at `target`. A column: where its composer would create a card,
 * below the line. A slot: a card already in your inventory swaps with what
 * is there; any other card is taken into the inventory, into that slot if
 * it is empty.
 */
export function planPut(
  card: CardId,
  target: PutTarget,
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const now = cardOf(facts, card)
  if (now === undefined) return []
  if (target.kind === "inventory") {
    const from = slotOf(facts.slots, card)
    if (from === null || now.place.kind !== "inventory")
      return takeIntoInventoryAt(now, target.slot, state)
    if (from === target.slot) return []
    return [{ kind: "swapSlots", a: from, b: target.slot }]
  }
  const to = placeOfTarget(target, facts.composers, facts.me)
  const from = keyOf(now.place)
  if (to === null || sameKey(from, to)) return []
  const move = moveOf(now, to)
  return [moveCard(move, { actedAt: atColumn(target.key), slot: null }, true)]
}

/**
 * Pin `card`, below the line at a thread's end, at the top of the same
 * thread's column. A move like any other: the host records it, and an undo
 * of moves reverses it (ADR-0066).
 */
export function planPin(
  card: CardId,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  const to = now === undefined ? null : pinnedOf(now.place)
  return now === undefined || to === null
    ? []
    : [moveCard(moveOf(now, to), IN_COLUMN(key), true)]
}

/** Unpin `card`: below the line where it was pinned. */
export function planUnpin(
  card: CardId,
  key: string,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  return now?.place.kind === "pinned"
    ? [moveCard(moveOf(now, draftingOf(now.place)), IN_COLUMN(key), true)]
    : []
}

/** Remove a card from your inventory: final, so not recorded. */
export function planRemove(
  card: CardId,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  if (now?.place.kind !== "inventory") return []
  return [
    moveCard(moveOf(now, null), { actedAt: AT_INVENTORY, slot: null }, false),
  ]
}

/**
 * Close fresh column `key`, keeping `cards` in your inventory: one move the
 * host accepts or refuses whole (ADR-0066), each card into the next empty
 * slot from the selected one. Without room for all of them, the host refuses
 * it `full`, and the column stays open, saying so.
 */
export function planKeep(
  cards: readonly CardId[],
  key: string,
  close: readonly Effect[],
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const slots: Record<string, CardId> = { ...facts.slots }
  const moves = cards.flatMap(id => {
    const now = cardOf(facts, id)
    if (now === undefined) return []
    const slot = firstEmpty(slots, facts.selected)
    if (slot !== null) slots[String(slot)] = now.id
    const move = moveOf(now, { kind: "inventory", holder: facts.me })
    return [{ move, slot }]
  })
  const [first, ...rest] = moves
  // Every card already gone: nothing to ask the host, so the column closes.
  if (first === undefined) return close
  return [
    { kind: "keep", moves: [first, ...rest], actedAt: atColumn(key), close },
  ]
}

/** After a keep's answer: the column closes only if the keep was accepted. */
export const afterKeep = (
  answer: MoveAnswer,
  close: readonly Effect[],
): readonly Effect[] => (answer.kind === "accepted" ? close : [])

/**
 * The root an undo of moves acts in: the root you are on, or the one a new
 * tab minted as it opened (ADR-0066). None on nothing, or for a root the
 * directory does not name yet.
 */
function rootOfTab(state: IntentState): RootId | null {
  const active = state.layout.active
  if (active === null || active.kind === "nothing") return null
  if (active.kind === "new")
    return (
      state.layout.newTabs.find(c => c.key === active.key)?.fresh?.root ?? null
    )
  return state.rootIds.get(active.root) ?? null
}

/**
 * Undo or redo your newest move in the root you are on, which the host does
 * whole or refuses (ADR-0066); with the inventory panel focused, this tab's
 * newest swap.
 */
export function planUndoMove(
  direction: MoveDirection,
  inPanel: boolean,
  state: IntentState,
): readonly Effect[] {
  if (inPanel) return [{ kind: "undoSwap", direction }]
  const root = rootOfTab(state)
  return root === null ? [] : [{ kind: "undoMoves", root, direction }]
}

/**
 * What the host's answer to an undo of moves brings into view (ADR-0052:
 * undo shows where it acts): each place a card went back to, once; or,
 * refused, the card where it is now, saying who moved it.
 */
export function afterUndo(
  outcome: Outcome,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  switch (outcome.kind) {
    case "undone": {
      const places: PlaceKey[] = []
      for (const { place } of outcome.cards)
        if (place !== null && !places.some(p => sameKey(p, place)))
          places.push(place)
      return places.flatMap(place => revealOf(place, state, fresh).effects)
    }
    case "unmoved": {
      const shown =
        outcome.place === null
          ? {
              effects: [{ kind: "showInventory", brief: false }] as const,
              actedAt: AT_INVENTORY,
            }
          : revealOf(outcome.place, state, fresh)
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
 * Where a trace leads (ADR-0048, *Other people*): the card's place now, or,
 * for a card sent, the message it became. Nothing for a card in someone
 * else's inventory, or one gone some other way.
 */
export function planOpenTrace(
  trace: TraceRecord,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  const now = state.cards.cards.find(c => c.id === trace.card)
  if (now === undefined)
    return trace.message === null ? [] : planOpenAt(trace.message, state, fresh)
  if (now.place.kind === "inventory" && now.place.holder !== state.cards.me)
    return []
  return revealOf(keyOf(now.place), state, fresh).effects
}
