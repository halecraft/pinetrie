// session/open-repair — what the sidebar's document should say;
// `open-threads.ts` writes it.

import type { CanvasId } from "@pinetrie/core"
import { keyAfter, orderBetween, orderKeys } from "@pinetrie/rules"

/** Keys to set, by canvas, and canvases to delete: one batch to your document. */
export interface OpenWrites {
  readonly set: ReadonlyMap<CanvasId, string>
  readonly delete: readonly CanvasId[]
}

const NO_OPEN_WRITES: OpenWrites = { set: new Map(), delete: [] }

/** The open canvases, in order: by key, then by id. */
export const orderOpen = (
  keys: ReadonlyMap<CanvasId, string>,
): readonly CanvasId[] =>
  [...keys]
    .toSorted(([a, ka], [b, kb]) =>
      ka !== kb ? (ka < kb ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0,
    )
    .map(([canvas]) => canvas)

/**
 * `canvas` put before `before` in the sidebar, or at its end for null or a canvas
 * not in it; a canvas already in it moves. Renumbers every canvas when there is
 * no room between its neighbours.
 */
export function placeInList(
  keys: ReadonlyMap<CanvasId, string>,
  canvas: CanvasId,
  before: CanvasId | null,
): OpenWrites {
  const others = orderOpen(keys).filter(r => r !== canvas)
  const at =
    before === null || !others.includes(before)
      ? others.length
      : others.indexOf(before)
  const order = [...others.slice(0, at), canvas, ...others.slice(at)]
  const current = orderOpen(keys)
  if (keys.has(canvas) && order.every((r, i) => current[i] === r))
    return NO_OPEN_WRITES
  const low = order[at - 1]
  const high = order[at + 1]
  const key =
    high === undefined
      ? keyAfter(others.map(r => keys.get(r) ?? ""))
      : orderBetween(
          low === undefined ? null : (keys.get(low) ?? null),
          keys.get(high) ?? null,
        )
  if (key !== null) return { set: new Map([[canvas, key]]), delete: [] }
  const renumbered = orderKeys(order.length)
  return {
    set: new Map(order.map((r, i) => [r, renumbered[i] ?? ""] as const)),
    delete: [],
  }
}

/**
 * The repair: archived canvases leave the sidebar, but the one you are on, which
 * leaves once you switch away. A restore then brings a canvas back only for
 * whoever restores it. Nothing when nothing differs.
 */
export function planOpenRepair(
  keys: ReadonlyMap<CanvasId, string>,
  archived: ReadonlySet<CanvasId>,
  here: CanvasId | null,
): OpenWrites {
  const gone = [...keys.keys()].filter(r => archived.has(r) && r !== here)
  return gone.length === 0 ? NO_OPEN_WRITES : { set: new Map(), delete: gone }
}
