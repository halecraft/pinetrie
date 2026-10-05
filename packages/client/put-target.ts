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
  pinnedOf,
  sameKey,
  type WriterId,
} from "@pinetrie/core"

export type PutTarget =
  /** Below the line at a column's end, or a fresh column's card. */
  | { readonly kind: "column"; readonly key: string }
  /** The pinned strip at the top of a thread's column (ADR-0048). */
  | { readonly kind: "pinned"; readonly key: string }
  /** A slot of your inventory. */
  | { readonly kind: "inventory"; readonly slot: number }

/** The drag data type a card's id travels under, pinetrie's own. */
export const CARD_MIME = "application/x-pinetrie-card"

/** The attribute a column's drop zone carries: its key. */
const PUT_COLUMN = "data-put-column"
/** The attribute a column's pinned strip carries: its column's key. */
const PUT_PINNED = "data-put-pinned"
/** The attribute a slot carries: its index. */
const PUT_SLOT = "data-put-slot"

/** What an element a drop may land on matches: any mark. */
export const DROP_ZONE = `[${PUT_COLUMN}],[${PUT_PINNED}],[${PUT_SLOT}]`

/** The attributes that mark an element as `target`, spread onto it by the page. */
export function dropProps(target: PutTarget): Readonly<Record<string, string>> {
  switch (target.kind) {
    case "column":
      return { [PUT_COLUMN]: target.key }
    case "pinned":
      return { [PUT_PINNED]: target.key }
    case "inventory":
      return { [PUT_SLOT]: String(target.slot) }
  }
}

/** The target an element marks (`dropProps`); null for none. */
export function targetOfElement(el: {
  getAttribute(name: string): string | null
}): PutTarget | null {
  const key = el.getAttribute(PUT_COLUMN)
  if (key !== null && key !== "") return { kind: "column", key }
  const pinned = el.getAttribute(PUT_PINNED)
  if (pinned !== null && pinned !== "") return { kind: "pinned", key: pinned }
  const slot = el.getAttribute(PUT_SLOT)
  if (slot === null || !/^\d+$/.test(slot)) return null
  return { kind: "inventory", slot: Number(slot) }
}

/** Column key to the place its composer creates cards in (`composerPlace`). */
export type ComposerPlaces = ReadonlyMap<string, CardPlace>

/**
 * The place `target` names: a column's composer place, the same thread end
 * pinned (`pinnedOf`), or your inventory; null for a column no composer
 * publishes, and for a fresh column's strip, which it has none of.
 */
export function placeOfTarget(
  target: PutTarget,
  places: ComposerPlaces,
  me: WriterId,
): PlaceKey | null {
  if (target.kind === "inventory") return { kind: "inventory", holder: me }
  const place = places.get(target.key)
  if (place === undefined) return null
  return target.kind === "pinned" ? pinnedOf(place) : keyOf(place)
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
