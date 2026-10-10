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
   * Where what it says is read (`textSourceOf`): its own text document, a
   * blob, the fact it holds, the ask it relays, or nowhere (it says
   * nothing a reader takes as text).
   */
  readonly text: "doc" | "blob" | "fact" | "ask" | "none"
}

/**
 * Every kind of card (ADR-0116, ADR-0117, ADR-0126):
 *
 * - a text card, anywhere but a canvas;
 * - a thread's card, on a canvas or in an inventory;
 * - a note column, on a canvas;
 * - a reference, holding an address and its quote: a note, a comment in
 *   an entry's margin, queued (its quote sent as its queuer's message), in
 *   an inventory, or discarded. The readers of pinned cards read no quote,
 *   so it is never pinned; a put leaves it in your hand and makes another
 *   where it lands;
 * - a fact, only ever queued, until its thread's end consumes it: the
 *   host places it, no person moves it (a move is refused `no-place`), and
 *   nothing passes it in its queue (`planReorder`, refused `fact`);
 * - an ask, an ask from another thread for a busy agent (ADR-0128), only
 *   ever queued, until its thread's end consumes it: the host places it, no
 *   person moves it (it never becomes a note), and a person may reorder it,
 *   or hold the queue it waits in;
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
      "margin",
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
  reference: {
    prefix: "q-",
    places: ["note", "margin", "queued", "gone", "inventory"],
    moves: true,
    reordered: true,
    put: "copies",
    text: "blob",
  },
  ask: {
    prefix: "a-",
    places: ["queued"],
    moves: false,
    reordered: true,
    put: "moves",
    text: "ask",
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
