// containers — a card made on a canvas to hold one dropped there whose kind
// no canvas takes (`WRAPS`): a note column for a note, a media column for an
// image; and the place of the first card in it.

import {
  type CanvasPlace,
  type CardPlace,
  type CardRecord,
  cardIdOfKind,
  type MediaId,
  makeCard,
  type NoteColumnId,
  UNTICKED,
  type WRAPS,
  type WrappedKind,
  type WriterId,
} from "@pinetrie/core"
import { orderAfter } from "./order.ts"
import { type PlaceStep, planMake } from "./place-steps.ts"

/** A kind a card is made in when dropped on a canvas (`WRAPS`). */
export type ContainerKind = (typeof WRAPS)[WrappedKind]

/** A container's kind and its new id. */
export type Container =
  | { readonly kind: "note-column"; readonly id: NoteColumnId }
  | { readonly kind: "media"; readonly id: MediaId }

/** Mints the id of a container of `kind`: the host's, or a test's. */
export type MintContainer = <K extends ContainerKind>(
  kind: K,
) => Extract<Container, { readonly kind: K }>

/** A `MintContainer` over `newId`, a uuidv7 minter. */
export const mintContainer =
  (newId: () => string): MintContainer =>
  <K extends ContainerKind>(kind: K) => {
    const made: Container =
      kind === "note-column"
        ? { kind: "note-column", id: cardIdOfKind("note-column", newId()) }
        : { kind: "media", id: cardIdOfKind("media", newId()) }
    return made as Extract<Container, { readonly kind: K }>
  }

/** `mint`, but a media column it makes is `media` when one is given. */
export const mintWith =
  (mint: MintContainer, media: MediaId | null): MintContainer =>
  <K extends ContainerKind>(kind: K) => {
    const made: Container =
      kind === "media" && media !== null
        ? { kind: "media", id: media }
        : mint(kind)
    return made as Extract<Container, { readonly kind: K }>
  }

/** The place of the first card in a container. */
export type FirstPlace = Extract<CardPlace, { kind: "note" | "image" }>

/**
 * `container`, made at `at` on a canvas by `by` through `planMake` as every
 * card is, and the place of its first card. Null when the make is refused,
 * which none is.
 */
export function makeContainer<C extends Container>(
  cards: readonly CardRecord[],
  container: C,
  at: CanvasPlace,
  by: WriterId,
): {
  readonly step: PlaceStep
  readonly place: Extract<FirstPlace, { kind: FirstKind<C> }>
} | null {
  const order = orderAfter([])
  const made =
    container.kind === "note-column"
      ? planMake(
          cards,
          makeCard("note-column", container.id, at, UNTICKED, by),
          by,
        )
      : planMake(cards, makeCard("media", container.id, at, UNTICKED, by), by)
  if (made.kind !== "write") return null
  const place: FirstPlace =
    container.kind === "note-column"
      ? { kind: "note", column: container.id, order }
      : { kind: "image", column: container.id, order }
  return {
    step: made,
    place: place as Extract<FirstPlace, { kind: FirstKind<C> }>,
  }
}

/** The kind of place a container's first card is at. */
type FirstKind<C extends Container> = C["kind"] extends "note-column"
  ? "note"
  : "image"
