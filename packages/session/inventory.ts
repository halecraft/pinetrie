// session/inventory — which slot of your inventory holds each card the host
// says you hold: one rule (`settleSlots`) that the page draws and the repair
// writes, so what is drawn and what is written cannot differ.

import type { WriterId } from "@pinetrie/core"
import {
  type CardId,
  type CardInPlace,
  type CardRecord,
  firstEmpty as firstEmptyCell,
  type Grid,
  hasPlaceKind,
  INVENTORY_GRID,
  inventoryGrid,
  isCell,
} from "@pinetrie/threads"

/** Slot index ("0"–"11", reading order; more while someone holds more) to card. */
export type Slots = Readonly<Record<string, CardId>>

/** What to write to the slots: cards into slots, and slots to clear. */
export interface SlotWrites {
  readonly set: Readonly<Record<string, CardId>>
  readonly clear: readonly string[]
}

/** Card to the slot this tab's take into the inventory in flight chose for it. */
export type Intents = ReadonlyMap<CardId, number>

export const NO_INTENTS: Intents = new Map()

/** The slots `slots` fills. */
const takenOf = (slots: Slots): ReadonlySet<number> =>
  new Set(Object.keys(slots).map(Number))

/**
 * The first empty slot in reading order, from `start` if it is empty; null
 * when full (threads' `firstEmpty` over the inventory's grid). It never names a
 * slot past the twelfth: those exist only to draw what someone holds past it.
 */
export const firstEmpty = (slots: Slots, start?: number): number | null =>
  firstEmptyCell(INVENTORY_GRID, takenOf(slots), start)

/** Every cell of `grid`, in reading order. */
const cellsOf = (grid: Grid): readonly number[] =>
  Array.from({ length: grid.width * grid.rows }, (_, n) => n)

/**
 * The slots as they should be: `intents` in their chosen slots; every other
 * card of `inventoryCards` where a slot names it (the lower, if two do), or
 * else in the first empty slot, cards in id order; slots naming a card not in
 * the inventory, or a slot that is no slot, dropped. A card in a slot an
 * intent chose moves to the first empty one. The grid is
 * `inventoryGrid(inventoryCards.length)`, so a card past the twelfth slot
 * keeps its place while the inventory has more than 12, and settles into the
 * first empty slot once it has 12 or fewer.
 */
export function settleSlots(
  inventoryCards: readonly CardId[],
  slots: Slots,
  intents: Intents,
): Slots {
  const grid = inventoryGrid(inventoryCards.length)
  const out: Record<string, CardId> = {}
  const placed = new Set<CardId>()
  for (const [card, slot] of intents) {
    if (!isCell(grid, slot) || out[String(slot)] !== undefined) continue
    out[String(slot)] = card
    placed.add(card)
  }
  const isInInventory = new Set(inventoryCards)
  for (const n of cellsOf(grid)) {
    const card = slots[String(n)]
    if (card === undefined || !isInInventory.has(card) || placed.has(card))
      continue
    if (out[String(n)] !== undefined) continue
    out[String(n)] = card
    placed.add(card)
  }
  for (const card of [...inventoryCards].sort()) {
    if (placed.has(card)) continue
    const n = firstEmptyCell(grid, takenOf(out))
    if (n === null) break
    out[String(n)] = card
    placed.add(card)
  }
  return out
}

/**
 * The repair: the writes that bring `slots` to
 * `settleSlots`. An intent's slot, and a slot holding an intent's card, are
 * left alone: the take into the inventory writes them itself once the host
 * accepts it. Nothing to do gives no writes, so two tabs never write back
 * and forth.
 *
 * A card is placed, or its slot cleared, only once it is `steady`: in the
 * inventory, or not, for a while. The host's record and another tab's slot write reach
 * this tab apart, in either order, so a tab acting at once would clear a
 * slot another tab just took a card into, or place the card before that
 * tab's own write arrives, and the card would lose its slot. A card in two
 * slots, or a slot that is no slot, is settled at once.
 */
export function planSlots(
  inventoryCards: readonly CardId[],
  slots: Slots,
  intents: Intents,
  steady: (card: CardId) => boolean,
): SlotWrites {
  const settled = settleSlots(inventoryCards, slots, intents)
  const grid = inventoryGrid(inventoryCards.length)
  const chosen = new Set([...intents.values()].map(String))
  const isInInventory = new Set(inventoryCards)
  const set: Record<string, CardId> = {}
  for (const [slot, card] of Object.entries(settled))
    if (!chosen.has(slot) && slots[slot] !== card && steady(card))
      set[slot] = card
  const clear = Object.entries(slots)
    .filter(
      ([slot, card]) =>
        !chosen.has(slot) &&
        !intents.has(card) &&
        settled[slot] === undefined &&
        (!isCell(grid, Number(slot)) ||
          isInInventory.has(card) ||
          steady(card)),
    )
    .map(([slot]) => slot)
  return { set, clear }
}

/**
 * When this tab last saw each card come into the inventory or leave it:
 * `steadiness`'s memory, kept by the tab and never stored.
 */
export type InInventorySince = ReadonlyMap<
  CardId,
  { readonly inInventory: boolean; readonly since: number }
>

/** How long a card must stay in the inventory, or out, before the repair acts on it. */
export const STEADY_MS = 2_000

/**
 * Which cards the repair may act on at `now`: those in the inventory, or out, for
 * `STEADY_MS`. Returns the memory to keep, and when to look again (null when
 * every card is steady).
 */
export function steadiness(
  memory: InInventorySince,
  inventoryCards: readonly CardId[],
  slots: Slots,
  now: number,
): {
  readonly memory: InInventorySince
  readonly steady: (card: CardId) => boolean
  readonly wake: number | null
} {
  const isInInventory = new Set(inventoryCards)
  const next = new Map<CardId, { inInventory: boolean; since: number }>()
  for (const card of new Set([...inventoryCards, ...Object.values(slots)])) {
    const was = memory.get(card)
    const inInventory = isInInventory.has(card)
    next.set(
      card,
      was !== undefined && was.inInventory === inInventory
        ? was
        : { inInventory, since: now },
    )
  }
  const pending = [...next.values()]
    .map(s => s.since + STEADY_MS)
    .filter(at => at > now)
  return {
    memory: next,
    steady: card => (next.get(card)?.since ?? now) + STEADY_MS <= now,
    wake: pending.length === 0 ? null : Math.min(...pending),
  }
}

/** The slots a take into the inventory writes: the card in `slot`, and out of any other. */
export function putAwayWrites(
  slots: Slots,
  card: CardId,
  slot: number,
): SlotWrites {
  const clear = Object.entries(slots)
    .filter(([s, c]) => c === card && s !== String(slot))
    .map(([s]) => s)
  return { set: { [String(slot)]: card }, clear }
}

/**
 * The slots a swap writes: `cards[0]` into `a` and `cards[1]` into `b`, a
 * null one clearing its slot. It reads no slots, so it writes exactly what
 * the swap's history entry records.
 */
export function swapWrites(
  a: number,
  b: number,
  cards: readonly [CardId | null, CardId | null],
): SlotWrites {
  const set: Record<string, CardId> = {}
  const clear: string[] = []
  for (const [slot, card] of [
    [a, cards[0]],
    [b, cards[1]],
  ] as const)
    if (card === null) clear.push(String(slot))
    else set[String(slot)] = card
  return { set, clear }
}

/**
 * One repair at `now`: which cards are steady (`steadiness`), the writes
 * that settle the slots for them (`planSlots`), the memory to keep, and
 * when to repair again (null: every card is steady).
 */
export function repairStep(
  memory: InInventorySince,
  input: {
    readonly inventoryCards: readonly CardId[]
    readonly stored: Slots
    readonly intents: Intents
    readonly now: number
  },
): {
  readonly memory: InInventorySince
  readonly wake: number | null
  readonly writes: SlotWrites
} {
  const { inventoryCards, stored, intents, now } = input
  const step = steadiness(memory, inventoryCards, stored, now)
  return {
    memory: step.memory,
    wake: step.wake,
    writes: planSlots(inventoryCards, stored, intents, step.steady),
  }
}

/** The cards the host says are in `me`'s inventory. */
export const ownInventoryCards = (
  cards: readonly CardRecord[],
  me: WriterId,
): readonly CardInPlace<"inventory">[] =>
  cards.filter(
    (c): c is CardInPlace<"inventory"> =>
      hasPlaceKind(c, "inventory") && c.place.holder === me,
  )
