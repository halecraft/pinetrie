// root — deleting a chat's root a card was spun into, with the canvas it
// was spun into.

import {
  type CanvasId,
  type CardRecord,
  livePlaceOf,
  ownerOf,
  type RootId,
  rootDocId,
  type ThreadId,
  type ThreadRecord,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { isBoardCard } from "./board.ts"
import { MARK } from "./mark.ts"
import type { PlaceStep } from "./moves.ts"
import { deleteRecord } from "./records.ts"
import { ROOT } from "./roots.ts"
import { THREAD } from "./thread.ts"

/**
 * The canvases a step leaves empty that were a new canvas's: a thread
 * card that left `canvas`'s canvas for a trash, its thread a new root's not
 * yet started (its root one the directory does not name, `started`), and
 * nothing left on that canvas or pinned to the canvas. Closing an unsent new
 * tab sends its canvas's card to the trash too (`planCanvasesTrashed`).
 */
export function emptiedCanvases(input: {
  readonly before: readonly CardRecord[]
  readonly after: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  readonly started: ReadonlySet<RootId>
}): readonly CanvasId[] {
  const now = new Map(input.after.map(c => [c.id, c] as const))
  const out: CanvasId[] = []
  for (const c of input.before) {
    if (c.kind !== "thread" || c.place.kind !== "canvas") continue
    const { canvas } = c.place
    const record = input.threads.get(c.id)
    if (
      now.get(c.id)?.place.kind !== "trash" ||
      record?.origin.kind !== "root" ||
      input.started.has(record.root) ||
      out.includes(canvas)
    )
      continue
    const holds = input.after.some(d => {
      if (d.place.kind === "trash") return false
      const owner = ownerOf(d.place)
      return owner.kind === "canvas" && owner.canvas === canvas
    })
    if (!holds) out.push(canvas)
  }
  return out
}

/**
 * Each of `canvases`' cards from the board to the trash, remembering where it
 * was there, its closer its placer: written in the close's step, so the
 * undo key brings the canvas back with its thread. A canvas with no card on
 * the board is left.
 */
export function planCanvasesTrashed(
  cards: readonly CardRecord[],
  canvases: readonly CanvasId[],
  closer: WriterId,
): readonly PlaceStep[] {
  return cards.flatMap((c): PlaceStep[] =>
    isBoardCard(c) && canvases.includes(c.id)
      ? [
          {
            kind: "write",
            record: {
              ...c,
              place: { kind: "trash", left: c.place },
              placer: closer,
            },
          },
        ]
      : [],
  )
}

/** What deleting a root writes, and what it lets go. */
export interface RootDelete {
  /** Its directory record, its thread's, and its canvas's title. */
  readonly values: readonly ValueWrite[]
  /** Every card still in it, a new canvas's, say, its canvas and the canvas's card. */
  readonly cards: readonly PlaceStep[]
  /** Its document, destroyed: its tree, and the records kept in it. */
  readonly doc: string
  /** The canvas whose stacks of moves are unloaded; the startup sweep retires them. */
  readonly histories: CanvasId
}

/**
 * Delete `root`, its one thread, and the canvas it was spun into: their
 * records, the canvas's title, the document and every card in either, the
 * canvas's own included.
 */
export function planRootDelete(
  root: RootId,
  thread: ThreadId,
  canvas: CanvasId,
  cards: readonly CardRecord[],
  rootOfThread: ReadonlyMap<ThreadId, RootId>,
): RootDelete {
  return {
    values: [
      deleteRecord(ROOT, root),
      deleteRecord(THREAD, thread),
      deleteRecord(MARK, canvas),
    ],
    cards: cards
      .filter(c => {
        if (c.id === canvas) return true
        const owner = ownerOf(livePlaceOf(c.place))
        return owner.kind === "canvas"
          ? owner.canvas === canvas
          : owner.kind === "thread" && rootOfThread.get(owner.thread) === root
      })
      .map(c => ({ kind: "remove", id: c.id })),
    doc: rootDocId(root),
    histories: canvas,
  }
}
