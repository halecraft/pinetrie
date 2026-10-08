// root — deleting a conversation root: a thread a card was spun into, lifted
// back by the undo key while it held its first message alone (ADR-0111).
// Pure: the host writes what this plans.

import {
  type CardRecord,
  type RootId,
  rootDocId,
  type ValueWrite,
} from "@pinetrie/core"
import { BOARD } from "./board.ts"
import type { PlaceStep } from "./card.ts"
import { deleteRecord } from "./records.ts"
import { ROOT } from "./roots.ts"

/** What deleting a root writes, and what it lets go. */
export interface RootDelete {
  /** Its directory record and its board place. */
  readonly values: readonly ValueWrite[]
  /** Every card still in it: a new tab's, say. */
  readonly cards: readonly PlaceStep[]
  /** Its document, destroyed: its tree, and the records kept in it. */
  readonly doc: string
  /** The root whose stacks of moves are unloaded; the startup sweep retires them. */
  readonly histories: RootId
}

/** Delete `root`: its directory record, board place, document and cards. Pure. */
export function planRootDelete(
  root: RootId,
  cards: readonly CardRecord[],
): RootDelete {
  return {
    values: [deleteRecord(ROOT, root), deleteRecord(BOARD, root)],
    cards: cards
      .filter(c => "root" in c.place && c.place.root === root)
      .map(c => ({ kind: "remove", id: c.id })),
    doc: rootDocId(root),
    histories: root,
  }
}
