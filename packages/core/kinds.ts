// kinds — every kind of card, once: its id's prefix, the places it is ever in,
// whether it is reordered where it is, and where what it says is read. One row
// per kind, so a kind added to `CardKind` does not compile until each is said.
// `PLACES_OF`, `kindOfCard` and `textSourceOf` read it.

import type { CardKind } from "./ids.ts"
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
  /**
   * Where what it says is read (`textSourceOf`): its own text document, a
   * blob, the fact it holds, the ask it relays, or nowhere (it says
   * nothing a reader takes as text).
   */
  readonly text: "doc" | "blob" | "fact" | "ask" | "none"
}

/**
 * Every kind of card:
 *
 * - a text card, anywhere but a canvas;
 * - a thread's card, on a canvas or in an inventory;
 * - a canvas's card, on the board, in a workflow state: the host places it
 *   (a board move is its own command, which crosses the archive's edge),
 *   so no person's move takes it, and only the host trashes it (a new canvas
 *   closed unsent); no reorder moves it either, since the board's own move
 *   ranks it within its state (`planBoardMove`);
 * - a note column, on a canvas;
 * - a reference, holding an address and its quote: a note, a comment in
 *   an entry's margin, queued (its quote sent as its queuer's message), in
 *   an inventory, or discarded. The readers of pinned cards read no quote,
 *   so it is never pinned;
 * - a fact, only ever queued, until its thread's end consumes it: the
 *   host places it, no person moves it (a move is refused `no-place`), and
 *   nothing passes it in its queue (`planReorder`, refused `fact`);
 * - an ask, an ask from another thread for a busy agent, only ever queued,
 *   until its thread's end consumes it: the host places it, no person moves it
 *   (it never becomes a note), and a person may reorder it, or hold the queue
 *   it waits in;
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
      "canvas-pinned",
      "queued",
      "margin",
      "trash",
      "inventory",
    ],
    moves: true,
    reordered: true,
    text: "doc",
  },
  thread: {
    prefix: "t-",
    places: ["canvas", "inventory", "trash"],
    moves: true,
    reordered: true,
    text: "none",
  },
  canvas: {
    prefix: "k-",
    places: ["board", "trash"],
    moves: false,
    reordered: false,
    text: "none",
  },
  "note-column": {
    prefix: "n-",
    places: ["canvas", "trash"],
    moves: true,
    reordered: true,
    text: "none",
  },
  fact: {
    prefix: "x-",
    places: ["queued"],
    moves: false,
    reordered: false,
    text: "fact",
  },
  reference: {
    prefix: "q-",
    places: ["note", "margin", "queued", "trash", "inventory"],
    moves: true,
    reordered: true,
    text: "blob",
  },
  ask: {
    prefix: "a-",
    places: ["queued"],
    moves: false,
    reordered: true,
    text: "ask",
  },
  media: {
    prefix: "m-",
    places: [],
    moves: false,
    reordered: false,
    text: "none",
  },
  file: {
    prefix: "f-",
    places: [],
    moves: false,
    reordered: false,
    text: "none",
  },
} as const satisfies Record<CardKind, KindSpec>
