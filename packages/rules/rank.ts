// rank — where a card goes on a canvas (ADR-0116): a rank just after a
// card, a drop's rank, and where a branch lands, beside the thread it forks
// from.

import {
  type CardId,
  type CardRecord,
  placed,
  type ThreadId,
} from "@pinetrie/core"
import { orderAfter, orderBetween, respace } from "./order.ts"
import type { CanvasCard } from "./task.ts"

/**
 * Where a branch of `parent` lands on `canvas` (ADR-0116): the index of the
 * card it goes just after, its parent thread's; the last card's when the
 * parent is not on this canvas or there is none (a new root lands at the
 * end); -1 on an empty canvas. The host ranks a branch's card by it and the
 * page draws a fresh column there (`canvasColumns`), so the column does not
 * move as its first send lands. Pure.
 */
export function branchAfter(
  canvas: readonly CanvasCard[],
  parent: ThreadId | null,
): number {
  const at = parent === null ? -1 : canvas.findIndex(c => c.id === parent)
  return at < 0 ? canvas.length - 1 : at
}

/**
 * A rank for a card going just after index `after` of `canvas` (-1: before
 * every card), and the cards given new ranks to make room when its
 * neighbours have none between them (`respace`), each at its new rank.
 * Pure.
 */
export function rankAfter(
  canvas: readonly CanvasCard[],
  after: number,
): { readonly order: string; readonly respaced: readonly CardRecord[] } {
  const order =
    after >= canvas.length - 1
      ? orderAfter(canvas)
      : orderBetween(
          canvas[after]?.place.order ?? null,
          canvas[after + 1]?.place.order ?? null,
        )
  if (order !== null) return { order, respaced: [] }
  const made = respace(
    canvas.map(c => c.place.order),
    after + 1,
  )
  return {
    order: made.inserted,
    respaced: [...made.changed].flatMap(([i, key]) => {
      const c = canvas[i]
      const moved =
        c === undefined ? undefined : placed(c, { ...c.place, order: key })
      return moved === undefined ? [] : [moved]
    }),
  }
}

/**
 * The rank of a drop on `canvas` just after the card `after` (null: before
 * every card), or at the end when that card is not on it (`CanvasTarget`),
 * with the cards given new ranks to make room (`rankAfter`). Pure.
 */
export function rankOfDrop(
  canvas: readonly CanvasCard[],
  after: CardId | null,
): ReturnType<typeof rankAfter> {
  const at = canvas.findIndex(c => c.id === after)
  return rankAfter(
    canvas,
    after === null ? -1 : at < 0 ? canvas.length - 1 : at,
  )
}
