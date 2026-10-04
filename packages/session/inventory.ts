// session/inventory — your inventory's slots (ADR-0048 step 4, ADR-0059). Pure.
//
// The host says which cards are in your inventory; your inventory document
// says which slot holds each. Your tabs write that document at once, so each
// repairs it from the host's record, writing only what differs (S76). One
// rule, `settleSlots`, says what the slots should be: the repair writes it,
// the page's panel draws it (`inventoryView`, `@pineta/client`), and a take
// lands by the same `firstEmpty`, so what is drawn and what is written
// cannot differ. A take this tab has in flight is an intent: drawn in the
// slot it chose, and left alone by the repair until the host answers and the
// take writes its own slot.

import {
  type CardId,
  type CardRecord,
  INVENTORY_SLOTS,
  type WriterId,
} from "@pineta/core"

/** Slot index ("0"–"17", reading order) to card. */
export type Slots = Readonly<Record<string, CardId>>

/** What to write to the slots: cards into slots, and slots to clear. */
export interface SlotWrites {
  readonly set: Readonly<Record<string, CardId>>
  readonly clear: readonly string[]
}

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
): SlotWrites {
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
  memory: HeldSince,
  input: {
    readonly held: readonly CardId[]
    readonly stored: Slots
    readonly intents: Intents
    readonly now: number
  },
): {
  readonly memory: HeldSince
  readonly wake: number | null
  readonly writes: SlotWrites
} {
  const { held, stored, intents, now } = input
  const step = steadiness(memory, held, stored, now)
  return {
    memory: step.memory,
    wake: step.wake,
    writes: planSlots(held, stored, intents, step.steady),
  }
}

/** The cards the host says are in `me`'s inventory. */
export const heldBy = (
  cards: readonly CardRecord[],
  me: WriterId,
): readonly CardRecord[] =>
  cards.filter(c => c.place.kind === "inventory" && c.place.holder === me)
