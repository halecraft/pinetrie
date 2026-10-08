// session/open-repair — what the sidebar's document should say (ADR-0112).
// Pure: `open-threads.ts` writes what these decide.

import type { RootId } from "@pinetrie/core"
import { keyAfter, orderBetween, orderKeys } from "@pinetrie/rules"

/** Keys to set, by root, and roots to delete: one batch to your document. */
export interface OpenWrites {
  readonly set: ReadonlyMap<RootId, string>
  readonly delete: readonly RootId[]
}

const NO_OPEN_WRITES: OpenWrites = { set: new Map(), delete: [] }

/** The open roots, in order: by key, then by id. */
export const orderOpen = (
  keys: ReadonlyMap<RootId, string>,
): readonly RootId[] =>
  [...keys]
    .toSorted(([a, ka], [b, kb]) =>
      ka !== kb ? (ka < kb ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0,
    )
    .map(([root]) => root)

/**
 * `root` put before `before` in the sidebar, or at its end for null or a root
 * not in it; a root already in it moves. Renumbers every root when there is
 * no room between its neighbours.
 */
export function placeInList(
  keys: ReadonlyMap<RootId, string>,
  root: RootId,
  before: RootId | null,
): OpenWrites {
  const others = orderOpen(keys).filter(r => r !== root)
  const at =
    before === null || !others.includes(before)
      ? others.length
      : others.indexOf(before)
  const order = [...others.slice(0, at), root, ...others.slice(at)]
  const current = orderOpen(keys)
  if (keys.has(root) && order.every((r, i) => current[i] === r))
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
  if (key !== null) return { set: new Map([[root, key]]), delete: [] }
  const renumbered = orderKeys(order.length)
  return {
    set: new Map(order.map((r, i) => [r, renumbered[i] ?? ""] as const)),
    delete: [],
  }
}

/**
 * The repair: archived roots leave the sidebar, but the one you are on, which
 * leaves once you switch away. A restore then brings a root back only for
 * whoever restores it (ADR-0030). Nothing when nothing differs.
 */
export function planOpenRepair(
  keys: ReadonlyMap<RootId, string>,
  archived: ReadonlySet<RootId>,
  here: RootId | null,
): OpenWrites {
  const gone = [...keys.keys()].filter(r => archived.has(r) && r !== here)
  return gone.length === 0 ? NO_OPEN_WRITES : { set: new Map(), delete: gone }
}
