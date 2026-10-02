// client/inventory — your inventory's slots (ADR-0048 step 4, ADR-0059). Pure.
//
// The host says which cards are in your inventory; your inventory document
// says which slot holds each. Your tabs write that document at once, so each
// repairs it from the host's record, writing only what differs (S76). One
// rule, `settleSlots`, says what the slots should be: the repair writes it,
// the panel draws it, and a take lands by the same `firstEmpty`, so what is
// drawn and what is written cannot differ. A take this tab has in flight is
// an intent: drawn in the slot it chose, and left alone by the repair until
// the host answers and the take writes its own slot.

import {
  type CardId,
  type CardRecord,
  INVENTORY_COLUMNS,
  INVENTORY_SLOTS,
  type WriterId,
} from "@pineta/core"

/** Slot index ("0"–"17", reading order) to card. */
export type Slots = Readonly<Record<string, CardId>>

/** Card to the slot this tab's take in flight chose for it. */
export type Intents = ReadonlyMap<CardId, number>

export const NO_INTENTS: Intents = new Map()

/** Every slot index, in reading order. */
export const SLOT_INDICES: readonly number[] = Array.from(
  { length: INVENTORY_SLOTS },
  (_, n) => n,
)

/**
 * The first empty slot in reading order, from `start` if it is empty; null
 * when full.
 */
export function firstEmpty(slots: Slots, start?: number): number | null {
  if (
    start !== undefined &&
    isSlot(start) &&
    slots[String(start)] === undefined
  )
    return start
  return SLOT_INDICES.find(n => slots[String(n)] === undefined) ?? null
}

const isSlot = (n: number): boolean =>
  Number.isInteger(n) && n >= 0 && n < INVENTORY_SLOTS

/**
 * The slots as they should be: `intents` in their chosen slots; every other
 * card in `held` where a slot names it (the lower, if two do), or else in the
 * first empty slot, cards in id order; slots naming a card not held, or a
 * slot that is no slot, dropped. A held card in a slot an intent chose moves
 * to the first empty one.
 */
export function settleSlots(
  held: readonly CardId[],
  slots: Slots,
  intents: Intents,
): Slots {
  const out: Record<string, CardId> = {}
  const placed = new Set<CardId>()
  for (const [card, slot] of intents) {
    if (!isSlot(slot) || out[String(slot)] !== undefined) continue
    out[String(slot)] = card
    placed.add(card)
  }
  const isHeld = new Set(held)
  for (const n of SLOT_INDICES) {
    const card = slots[String(n)]
    if (card === undefined || !isHeld.has(card) || placed.has(card)) continue
    if (out[String(n)] !== undefined) continue
    out[String(n)] = card
    placed.add(card)
  }
  for (const card of [...held].sort()) {
    if (placed.has(card)) continue
    const n = firstEmpty(out)
    if (n === null) break
    out[String(n)] = card
    placed.add(card)
  }
  return out
}

/**
 * The repair (ADR-0059, S76): the writes that take `slots` to `settleSlots`.
 * An intent's slot, and a slot holding an intent's card, are left alone: the
 * take writes them itself once the host accepts it. Nothing to do gives no
 * writes, so two tabs never write back and forth.
 *
 * A card is placed, or its slot cleared, only once it is `steady`: held, or
 * not, for a while. The host's record and another tab's slot write reach
 * this tab apart, in either order, so a tab acting at once would clear a
 * slot another tab just took a card into, or place the card before that
 * tab's own write arrives, and the card would lose its slot. A card in two
 * slots, or a slot that is no slot, is settled at once.
 */
export function planSlots(
  held: readonly CardId[],
  slots: Slots,
  intents: Intents,
  steady: (card: CardId) => boolean,
): {
  readonly set: Readonly<Record<string, CardId>>
  readonly clear: readonly string[]
} {
  const settled = settleSlots(held, slots, intents)
  const chosen = new Set([...intents.values()].map(String))
  const isHeld = new Set(held)
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
        (!isSlot(Number(slot)) || isHeld.has(card) || steady(card)),
    )
    .map(([slot]) => slot)
  return { set, clear }
}

/** When this tab last saw each card start or stop being held: `steadiness`'s memory. */
export type HeldSince = ReadonlyMap<
  CardId,
  { readonly held: boolean; readonly since: number }
>

/** How long a card must stay held, or not, before the repair acts on it. */
export const STEADY_MS = 2_000

/**
 * Which cards the repair may act on at `now`: those held, or not, for
 * `STEADY_MS`. Returns the memory to keep, and when to look again (null when
 * every card is steady).
 */
export function steadiness(
  memory: HeldSince,
  held: readonly CardId[],
  slots: Slots,
  now: number,
): {
  readonly memory: HeldSince
  readonly steady: (card: CardId) => boolean
  readonly wake: number | null
} {
  const isHeld = new Set(held)
  const next = new Map<CardId, { held: boolean; since: number }>()
  for (const card of new Set([...held, ...Object.values(slots)])) {
    const was = memory.get(card)
    const holds = isHeld.has(card)
    next.set(
      card,
      was !== undefined && was.held === holds
        ? was
        : { held: holds, since: now },
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

/** The slots a take writes: the card in `slot`, and out of any other. */
export function takeWrites(
  slots: Slots,
  card: CardId,
  slot: number,
): {
  readonly set: Readonly<Record<string, CardId>>
  readonly clear: readonly string[]
} {
  const clear = Object.entries(slots)
    .filter(([s, c]) => c === card && s !== String(slot))
    .map(([s]) => s)
  return { set: { [String(slot)]: card }, clear }
}

/** The cards the host says are in `me`'s inventory. */
export const heldBy = (
  cards: readonly CardRecord[],
  me: WriterId,
): readonly CardRecord[] =>
  cards.filter(c => c.place.kind === "inventory" && c.place.holder === me)

export interface SlotView {
  readonly index: number
  readonly card: CardRecord | null
  /** The card's first line, "" for none. */
  readonly firstLine: string
  /** "1"–"9" for the first nine slots, else null. */
  readonly label: string | null
  readonly selected: boolean
}

export interface InventoryView {
  readonly slots: readonly SlotView[]
  readonly selected: number
  /** The selected slot's card, shown whole beside the grid. */
  readonly card: CardRecord | null
  /** How many slots are empty. */
  readonly free: number
}

const firstLineOf = (text: string): string =>
  text.trimStart().split("\n", 1)[0]?.trim() ?? ""

/** What the panel draws: `settleSlots`, each slot with its card. */
export function inventoryView(input: {
  readonly held: readonly CardRecord[]
  readonly slots: Slots
  readonly intents: Intents
  readonly selected: number
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
}): InventoryView {
  const byId = new Map(input.held.map(c => [c.id, c] as const))
  const settled = settleSlots(
    input.held.map(c => c.id),
    input.slots,
    input.intents,
  )
  const slots = SLOT_INDICES.map(index => {
    const id = settled[String(index)]
    const card = id === undefined ? null : (byId.get(id) ?? null)
    return {
      index,
      card,
      firstLine:
        card === null ? "" : firstLineOf(input.texts.get(card.id) ?? ""),
      label: index < 9 ? String(index + 1) : null,
      selected: index === input.selected,
    }
  })
  return {
    slots,
    selected: input.selected,
    card: slots[input.selected]?.card ?? null,
    free: slots.filter(s => s.card === null).length,
  }
}

/** A grid move by arrow or `hjkl`. */
export type GridStep = "left" | "right" | "up" | "down"

/** The slot a grid move selects from `from`; it stops at the grid's edge. */
export function stepSlot(from: number, step: GridStep): number {
  const row = Math.floor(from / INVENTORY_COLUMNS)
  const col = from % INVENTORY_COLUMNS
  const rows = INVENTORY_SLOTS / INVENTORY_COLUMNS
  switch (step) {
    case "left":
      return row * INVENTORY_COLUMNS + Math.max(0, col - 1)
    case "right":
      return row * INVENTORY_COLUMNS + Math.min(INVENTORY_COLUMNS - 1, col + 1)
    case "up":
      return Math.max(0, row - 1) * INVENTORY_COLUMNS + col
    case "down":
      return Math.min(rows - 1, row + 1) * INVENTORY_COLUMNS + col
  }
}
