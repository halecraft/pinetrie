// client/card-intents — what take, put, keep, remove and undo do (ADR-0048
// step 4, ADR-0052, ADR-0059), as effects. Pure: `planIntent` calls these,
// and `perform` carries out what they return.
//
// Every input makes the same moves: a key, a button and a drop each become
// one of these intents. A take lands in the selected slot when it is empty,
// else the first empty one (`firstEmpty`); a put lands where the target's
// composer would create a card (`placeOfTarget`). Each move says where it was
// made, so a refusal is said there, and what it does to the history.

import {
  type CardId,
  type CardRecord,
  type EntryId,
  INVENTORY_SLOTS,
  keyOf,
  type Move,
  type PlaceKey,
  sameKey,
} from "@pineta/core"
import {
  type ActedAt,
  AT_INVENTORY,
  type HistoryEntry,
  type MoveAnswer,
  type MoveHow,
  NO_STEP,
  NOT_RECORDED,
  type Refusal,
} from "./card-moves.ts"
import type { CardFacts, Effect, IntentState } from "./intent.ts"
import { planOpenAt } from "./intent.ts"
import { firstEmpty, type Slots } from "./inventory.ts"
import {
  type ClosedColumn,
  closedColumn,
  planOpen,
  tabOfColumn,
} from "./layout.ts"
import {
  type Direction,
  planUndo,
  type Shown,
  type UndoPlan,
} from "./move-undo.ts"
import { type PutTarget, placeOfTarget } from "./put-target.ts"

const at = (key: string): ActedAt => ({ kind: "column", key })

/**
 * A move made in column `key`, recorded as `card`'s move to `to`: a queue or
 * an unqueue. With no card the page holds, it is made all the same, and not
 * recorded.
 */
export function columnMove(
  key: string,
  moved: { readonly card: CardRecord; readonly to: PlaceKey } | null,
): MoveHow {
  if (moved === null) return NOT_RECORDED(key)
  const move: Move = {
    card: moved.card.id,
    from: keyOf(moved.card.place),
    to: moved.to,
  }
  return {
    actedAt: at(key),
    history: {
      kind: "record",
      entry: { kind: "handoff", move, slot: null, column: null },
    },
    slot: null,
  }
}

const slotOf = (slots: Slots, card: CardId): number | null => {
  const found = Object.entries(slots).find(([, c]) => c === card)
  return found === undefined ? null : Number(found[0])
}

const cardOf = (facts: CardFacts, card: CardId): CardRecord | undefined =>
  facts.cards.find(c => c.id === card)

/** The fresh column at either end of a move, kept whole for an undo. */
function freshEnd(
  state: IntentState,
  from: PlaceKey | null,
  to: PlaceKey | null,
): ClosedColumn | null {
  for (const key of [from, to])
    if (key?.kind === "fresh")
      return closedColumn(state.layout, key.column) ?? null
  return null
}

/** A take refused before it is sent: your inventory is full, as the host would say. */
const full = (card: CardId): Refusal => ({
  card,
  actedAt: AT_INVENTORY,
  code: "full",
  by: null,
  fromQueue: false,
})

/** A handoff into your inventory, at `slot`, recorded. */
function takeInto(card: CardRecord, slot: number, state: IntentState): Effect {
  const move: Move = {
    card: card.id,
    from: keyOf(card.place),
    to: { kind: "inventory", holder: state.cards.me },
  }
  return {
    kind: "moveCard",
    move,
    how: {
      actedAt: AT_INVENTORY,
      history: {
        kind: "record",
        entry: {
          kind: "handoff",
          move,
          slot,
          column: freshEnd(state, move.from, null),
        },
      },
      slot,
    },
  }
}

/**
 * Take `card` into your inventory: the selected slot if it is empty, else
 * the first empty one. Full, it is refused here, as the host would.
 */
export function planTake(card: CardId, state: IntentState): readonly Effect[] {
  const facts = state.cards
  const now = cardOf(facts, card)
  if (now === undefined || now.place.kind === "inventory") return []
  return takeAt(now, facts.selected, state)
}

function takeAt(
  now: CardRecord,
  start: number,
  state: IntentState,
): readonly Effect[] {
  const slot = firstEmpty(state.cards.slots, start)
  const show: Effect = { kind: "showInventory", brief: true }
  if (slot === null) return [show, { kind: "refuse", refusal: full(now.id) }]
  return [show, takeInto(now, slot, state)]
}

/** A copy of a message's text, or of a selection in it, as a new card in your inventory. */
export function planTakeCopy(
  card: CardId,
  text: string,
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const slot = firstEmpty(facts.slots, facts.selected)
  const show: Effect = { kind: "showInventory", brief: true }
  if (slot === null) return [show, { kind: "refuse", refusal: full(card) }]
  const to = { kind: "inventory", holder: facts.me } as const
  return [
    show,
    {
      kind: "createCard",
      card: {
        id: card,
        owner: facts.me,
        placer: facts.me,
        place: to,
        command: null,
        unsent: null,
      },
      text,
      how: {
        actedAt: AT_INVENTORY,
        history: {
          kind: "record",
          entry: {
            kind: "handoff",
            move: { card, from: null, to },
            slot,
            column: null,
          },
        },
        slot,
      },
    },
  ]
}

/**
 * Put `card` at `target`. A column: where its composer would create a card,
 * below the line. A slot: a card already in your inventory swaps with what
 * is there; any other card is taken, into that slot if it is empty.
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
      return takeAt(now, target.slot, state)
    if (from === target.slot) return []
    const there = facts.slots[String(target.slot)] ?? null
    const entry: HistoryEntry = {
      kind: "swap",
      a: from,
      b: target.slot,
      cards: [there, card],
    }
    return [
      {
        kind: "swapSlots",
        a: from,
        b: target.slot,
        step: { kind: "record", entry },
      },
    ]
  }
  const to = placeOfTarget(target, facts.composers, facts.me)
  const from = keyOf(now.place)
  if (to === null || sameKey(from, to)) return []
  const move: Move = { card, from, to }
  const slot = slotOf(facts.slots, card)
  return [
    {
      kind: "moveCard",
      move,
      how: {
        actedAt: at(target.key),
        history: {
          kind: "record",
          entry: {
            kind: "handoff",
            move,
            slot,
            column: freshEnd(state, from, to),
          },
        },
        slot: null,
      },
    },
  ]
}

/** Remove a card from your inventory: final, so not recorded. */
export function planRemove(
  card: CardId,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  if (now?.place.kind !== "inventory") return []
  return [
    {
      kind: "discardCard",
      card,
      how: { actedAt: AT_INVENTORY, history: NO_STEP, slot: null },
    },
  ]
}

/**
 * Close fresh column `key`, keeping `cards` in your inventory, one handoff
 * each into successive empty slots from the selected one. Without room for
 * all of them, nothing is sent and the column stays open, saying so.
 */
export function planKeep(
  cards: readonly CardId[],
  key: string,
  close: readonly Effect[],
  state: IntentState,
): readonly Effect[] {
  const facts = state.cards
  const slots: Record<string, CardId> = { ...facts.slots }
  const free = INVENTORY_SLOTS - Object.keys(slots).length
  const kept = cards.flatMap(id => {
    const now = cardOf(facts, id)
    return now === undefined ? [] : [now]
  })
  if (kept.length > free)
    return [
      {
        kind: "refuse",
        refusal: {
          card: null,
          actedAt: at(key),
          code: "no-room",
          need: kept.length,
          free,
        },
      },
    ]
  const column = closedColumn(state.layout, key) ?? null
  const moves = kept.flatMap(now => {
    const slot = firstEmpty(slots, facts.selected)
    if (slot === null) return []
    slots[String(slot)] = now.id
    const move: Move = {
      card: now.id,
      from: keyOf(now.place),
      to: { kind: "inventory", holder: facts.me },
    }
    return [
      {
        move,
        how: {
          actedAt: at(key),
          history: {
            kind: "record",
            entry: { kind: "handoff", move, slot, column },
          },
          slot,
        } satisfies MoveHow,
      },
    ]
  })
  return [{ kind: "keep", moves, close }]
}

/** After a keep's answers: the column closes only if every card was kept. */
export const afterKeep = (
  answers: readonly MoveAnswer[],
  close: readonly Effect[],
): readonly Effect[] => (answers.every(a => a.kind === "accepted") ? close : [])

/** Undo or redo your newest move: show where it acts, then act, or say why not. */
export function planUndoMove(
  direction: Direction,
  restored: EntryId | null,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  const archive =
    restored === null
      ? state.archive
      : new Map([...state.archive].filter(([root]) => root !== restored))
  const facts = state.cards
  const plan = planUndo(direction, facts.history, {
    cards: facts.cards,
    slots: facts.slots,
    layout: state.layout,
    index: state.index,
    lanes: facts.lanes,
    archive,
    me: facts.me,
  })
  return undoEffects(plan, direction, { ...state, archive }, fresh)
}

function undoEffects(
  plan: UndoPlan,
  direction: Direction,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  switch (plan.kind) {
    case "none":
      return []
    case "ask":
      return [{ kind: "askRestore", root: plan.root, direction }]
    case "refused":
      return [
        ...showEffects(plan.show, state, fresh),
        {
          kind: "dropEntry",
          entry: plan.entry,
          refusal: { ...plan.why, actedAt: actedAtOf(plan.show, state, fresh) },
        },
      ]
    case "swap":
      return [
        { kind: "showInventory", brief: false },
        { kind: "swapSlots", a: plan.a, b: plan.b, step: plan.step },
      ]
    case "handoff":
      return [
        ...showEffects(plan.show, state, fresh),
        {
          kind: "moveCard",
          move: plan.move,
          how: {
            actedAt: actedAtOf(plan.show, state, fresh),
            history: plan.step,
            slot: plan.slot,
          },
        },
      ]
  }
}

/** Bringing `show` into view. */
function showEffects(
  show: Shown,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  switch (show.kind) {
    case "inventory":
      return [{ kind: "showInventory", brief: false }]
    case "column": {
      const tab = tabOfColumn(state.layout, show.key)
      return tab === undefined
        ? []
        : [{ kind: "layout", action: { kind: "show", tab } }]
    }
    case "reopen":
      return [
        { kind: "layout", action: { kind: "reopen", closed: show.closed } },
      ]
    case "entry":
      return planOpenAt(show.entry, state, fresh)
  }
}

/** Where a refusal of an undo is said: the place it brought into view. */
function actedAtOf(show: Shown, state: IntentState, fresh: string): ActedAt {
  switch (show.kind) {
    case "inventory":
      return AT_INVENTORY
    case "column":
      return at(show.key)
    case "reopen":
      return at(show.closed.column.key)
    case "entry": {
      const plan = planOpen(
        state.layout,
        state.index,
        state.archive,
        show.entry,
      )
      return plan?.kind === "scroll"
        ? at(plan.key)
        : plan?.kind === "open"
          ? at(fresh)
          : AT_INVENTORY
    }
  }
}
