// client/put-target — where a put or a drop lands (ADR-0048). Pure.
//
// Every input makes the same moves: a drop names a target by the attribute
// the drop code marks it with, and a put by key or button names the same
// target. Both become a place through `placeOfTarget`, and a column's place
// is the one its composer creates cards in (`composerPlace`), published per
// column. So every place a drag can drop on is reachable by put, and every
// place put reaches accepts a drop.

import {
  type CardPlace,
  keyOf,
  type PlaceKey,
  sameKey,
  type WriterId,
} from "@pineta/core"

export type PutTarget =
  /** Below the line at a column's end, or a fresh column's card. */
  | { readonly kind: "column"; readonly key: string }
  /** A slot of your inventory. */
  | { readonly kind: "inventory"; readonly slot: number }

/** The drag data type a card's id travels under, Pineta's own. */
export const CARD_MIME = "application/x-pineta-card"

/** The attribute a column's drop zone carries: its key. */
export const PUT_COLUMN = "putColumn"
/** The attribute a slot carries: its index. */
export const PUT_SLOT = "putSlot"

/** The `dataset` an element marked as `target` carries. */
export function datasetOf(target: PutTarget): Readonly<Record<string, string>> {
  return target.kind === "column"
    ? { [PUT_COLUMN]: target.key }
    : { [PUT_SLOT]: String(target.slot) }
}

/** The target an element marks, by `data-put-column` or `data-put-slot`; null for none. */
export function targetOfElement(el: {
  readonly dataset: Readonly<Record<string, string | undefined>>
}): PutTarget | null {
  const key = el.dataset[PUT_COLUMN]
  if (key !== undefined && key !== "") return { kind: "column", key }
  const slot = el.dataset[PUT_SLOT]
  if (slot === undefined || !/^\d+$/.test(slot)) return null
  return { kind: "inventory", slot: Number(slot) }
}

/** Column key to the place its composer creates cards in (`composerPlace`). */
export type ComposerPlaces = ReadonlyMap<string, CardPlace>

/**
 * The place `target` names: a column's composer place, or your inventory;
 * null for a column no composer publishes.
 */
export function placeOfTarget(
  target: PutTarget,
  places: ComposerPlaces,
  me: WriterId,
): PlaceKey | null {
  if (target.kind === "inventory") return { kind: "inventory", holder: me }
  const place = places.get(target.key)
  return place === undefined ? null : keyOf(place)
}

/** A store each column writes its composer place to as it renders; reading it redraws nothing. */
export interface ComposerPlacesStore {
  readonly current: () => ComposerPlaces
  set(key: string, place: CardPlace | null): void
}

export function composerPlacesStore(): ComposerPlacesStore {
  let places: ComposerPlaces = new Map()
  return {
    current: () => places,
    set(key, place) {
      const now = places.get(key)
      if (
        place === null
          ? now === undefined
          : now !== undefined && sameKey(keyOf(now), keyOf(place))
      )
        return
      const next = new Map(places)
      if (place === null) next.delete(key)
      else next.set(key, place)
      places = next
    },
  }
}
