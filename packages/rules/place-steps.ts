// place-steps — a write to the places document, and the one rule every card
// is made by. The planners of moves, queues, notes and canvases all import
// it, so it imports none of them: an import of one here closes a cycle.

import {
  type CardId,
  type CardRecord,
  fitsPlace,
  INVENTORY_SLOTS,
  KINDS,
  kindOfCard,
  type MoveRefusal,
  type PlaceKey,
  placeKey,
  type WriterId,
} from "@pinetrie/core"

/** A write to the places document, as the host's one writer carries it out. */
export type PlaceStep =
  | { readonly kind: "write"; readonly record: CardRecord }
  | { readonly kind: "remove"; readonly id: CardId }

/** What the host makes of a move: a step to carry out, or a refusal. */
export type MoveStep =
  | PlaceStep
  | {
      readonly kind: "refused"
      readonly code: MoveRefusal
      /** The card as it is, or null when it is gone. */
      readonly now: CardRecord | null
    }

/** What the host makes of a card made: its write, or a refusal. */
export type MakeStep = Extract<MoveStep, { readonly kind: "write" | "refused" }>

/**
 * Whether `sender` may move a card into or out of `key`: every place but
 * someone else's inventory.
 */
export const ownsPlace = (key: PlaceKey, sender: WriterId): boolean =>
  key.kind !== "inventory" || key.holder === sender

/** Whether `holder`'s inventory holds `INVENTORY_SLOTS` cards, `card` not counted. */
export const inventoryFull = (
  cards: readonly CardRecord[],
  holder: WriterId,
  card: CardId,
): boolean =>
  cards.filter(
    c =>
      c.id !== card &&
      c.place.kind === "inventory" &&
      c.place.holder === holder,
  ).length >= INVENTORY_SLOTS

/**
 * Why a move into `to` is refused before the card is looked at; null for
 * none. A kind no person moves (`KINDS`' `moves`: a fact) and a place the
 * card's kind is never in are refused alike, `no-place`.
 */
export function placeRefusal(
  to: PlaceKey,
  cards: readonly CardRecord[],
  card: CardId,
  sender: WriterId,
): MoveRefusal | null {
  const kind = kindOfCard(card)
  if (!KINDS[kind].moves || !fitsPlace(kind, to.kind)) return "no-place"
  if (!ownsPlace(to, sender)) return "not-yours"
  return to.kind === "inventory" && inventoryFull(cards, sender, card)
    ? "full"
    : null
}

/**
 * Whether the host writes `card`, made (`makeCard`): the one rule every card
 * is made by, a person's or the host's. Refused `exists` for an
 * id in use, else as any move into its place is (`placeRefusal`: a kind no
 * person moves, someone else's inventory, a full one); the host makes the
 * kinds no person moves, so its own make is refused only for a full
 * inventory. Its place fits its kind by its type, so a misplaced card never
 * reaches this. `planMove`'s creations, a copy's card (`planCopy`), a
 * thread's card, a note column made for a note, a fact's card and a
 * split's card all go through it, so their refusals cannot drift.
 */
export function planMake(
  cards: readonly CardRecord[],
  card: CardRecord,
  sender: WriterId | "host",
): MakeStep {
  const now = cards.find(c => c.id === card.id)
  if (now !== undefined) return { kind: "refused", code: "exists", now }
  const to = placeKey(card.place)
  const refusal =
    sender === "host"
      ? to.kind === "inventory" && inventoryFull(cards, to.holder, card.id)
        ? "full"
        : null
      : placeRefusal(to, cards, card.id, sender)
  return refusal === null
    ? { kind: "write", record: card }
    : { kind: "refused", code: refusal, now: null }
}

/** `cards` as `steps` leave them, in order. */
export const afterSteps = (
  cards: readonly CardRecord[],
  steps: readonly PlaceStep[],
): readonly CardRecord[] => steps.reduce(afterStep, cards)

/** `cards` as `step` leaves them. */
const afterStep = (
  cards: readonly CardRecord[],
  step: PlaceStep,
): readonly CardRecord[] =>
  step.kind === "remove"
    ? cards.filter(c => c.id !== step.id)
    : [...cards.filter(c => c.id !== step.record.id), step.record]
