// kinds — every kind of card, once (ADR-0126): its id's prefix, the places
// it is ever in, whether it is reordered where it is, what a put does to
// your hand, and where what it says is read. One row per kind, so a kind
// added to `CardKind` does not compile until each is said. Re-exported from
// `index.ts`; `PLACES_OF`, `kindOfCard` and `textSourceOf` read it.

import type { CardKind } from "./index.ts"
import type { CardPlace } from "./places.ts"

/** What is true of every card of one kind. */
export interface KindSpec {
  /** Its id's prefix; null for a bare uuidv7 (a text card). */
  readonly prefix: string | null
  /** The places a card of it is ever in. */
  readonly places: readonly CardPlace["kind"][]
  /**
   * Whether a person's move takes it anywhere: false for a kind the host
   * alone places, which a move of is refused `no-place`.
   */
  readonly moves: boolean
  /** Whether it may be reordered among its neighbours where it is. */
  readonly reordered: boolean
  /** What a put does to your hand: moves the card, or leaves it and makes another. */
  readonly put: "moves" | "copies"
  /**
   * Where what it says is read: its own text document, a blob, the fact
   * it holds, or nowhere (it says nothing a reader takes as text).
   */
  readonly text: "doc" | "blob" | "fact" | "none"
}

/**
 * Every kind of card (ADR-0116, ADR-0117, ADR-0126):
 *
 * - a text card, anywhere but a canvas;
 * - a thread's card, on a canvas or in an inventory;
 * - a note column, on a canvas;
 * - a fact, only ever queued, until its thread's end consumes it: the
 *   host places it, no person moves it (a move is refused `no-place`), and
 *   nothing passes it in its queue (`planReorder`, refused `fact`);
 * - a media card and a file card, reserved: their ids are taken, and no
 *   place takes them yet.
 *
 * A uuidv7's second character is a hex digit, never `-`, so no prefix
 * matches a text card's bare id.
 */
export const KINDS = {
  text: {
    prefix: null,
    places: [
      "composing",
      "note",
      "pinned",
      "task-pinned",
      "queued",
      "fresh",
      "gone",
      "inventory",
    ],
    moves: true,
    reordered: true,
    put: "moves",
    text: "doc",
  },
  thread: {
    prefix: "t-",
    places: ["canvas", "inventory"],
    moves: true,
    reordered: true,
    put: "moves",
    text: "none",
  },
  "note-column": {
    prefix: "n-",
    places: ["canvas"],
    moves: true,
    reordered: true,
    put: "moves",
    text: "none",
  },
  fact: {
    prefix: "x-",
    places: ["queued"],
    moves: false,
    reordered: false,
    put: "moves",
    text: "fact",
  },
  media: {
    prefix: "m-",
    places: [],
    moves: false,
    reordered: false,
    put: "moves",
    text: "none",
  },
  file: {
    prefix: "f-",
    places: [],
    moves: false,
    reordered: false,
    put: "moves",
    text: "none",
  },
} as const satisfies Record<CardKind, KindSpec>
