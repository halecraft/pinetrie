// session/open-repair — what the sidebar's document should say (ADR-0122).
// Pure: `open-threads.ts` writes what these decide.

import type { TaskId } from "@pinetrie/core"
import { keyAfter, orderBetween, orderKeys } from "@pinetrie/rules"

/** Keys to set, by task, and tasks to delete: one batch to your document. */
export interface OpenWrites {
  readonly set: ReadonlyMap<TaskId, string>
  readonly delete: readonly TaskId[]
}

const NO_OPEN_WRITES: OpenWrites = { set: new Map(), delete: [] }

/** The open tasks, in order: by key, then by id. */
export const orderOpen = (
  keys: ReadonlyMap<TaskId, string>,
): readonly TaskId[] =>
  [...keys]
    .toSorted(([a, ka], [b, kb]) =>
      ka !== kb ? (ka < kb ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0,
    )
    .map(([task]) => task)

/**
 * `task` put before `before` in the sidebar, or at its end for null or a task
 * not in it; a task already in it moves. Renumbers every task when there is
 * no room between its neighbours.
 */
export function placeInList(
  keys: ReadonlyMap<TaskId, string>,
  task: TaskId,
  before: TaskId | null,
): OpenWrites {
  const others = orderOpen(keys).filter(r => r !== task)
  const at =
    before === null || !others.includes(before)
      ? others.length
      : others.indexOf(before)
  const order = [...others.slice(0, at), task, ...others.slice(at)]
  const current = orderOpen(keys)
  if (keys.has(task) && order.every((r, i) => current[i] === r))
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
  if (key !== null) return { set: new Map([[task, key]]), delete: [] }
  const renumbered = orderKeys(order.length)
  return {
    set: new Map(order.map((r, i) => [r, renumbered[i] ?? ""] as const)),
    delete: [],
  }
}

/**
 * The repair: archived tasks leave the sidebar, but the one you are on, which
 * leaves once you switch away. A restore then brings a task back only for
 * whoever restores it (ADR-0030). Nothing when nothing differs.
 */
export function planOpenRepair(
  keys: ReadonlyMap<TaskId, string>,
  archived: ReadonlySet<TaskId>,
  here: TaskId | null,
): OpenWrites {
  const gone = [...keys.keys()].filter(r => archived.has(r) && r !== here)
  return gone.length === 0 ? NO_OPEN_WRITES : { set: new Map(), delete: gone }
}
