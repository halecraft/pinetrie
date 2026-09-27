// core/roots — each root's tree, as the tabs, the header and the Archive tab
// see it (ADR-0029, ADR-0030). Pure.
//
// A root is found by walking up (`rootOf`), and a thread started at the root
// is rooted at its first message (S30), so a root's id is its tab's key.

import type { WriterId } from "./index.ts"
import {
  type LaneView,
  projectRail,
  rootOf,
  type TreeIndex,
  writersOf,
} from "./tree.ts"

export interface RootSummary {
  readonly root: string
  /** Its first message, as the rail finds it: the tab's label. */
  readonly first: string
  /** Its messages: the rail's rows, some of which it draws inside a run. */
  readonly messages: number
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: string
  /** Everyone who wrote a chat in it, in order of first message. */
  readonly writers: readonly WriterId[]
}

const ascending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Every root with at least one message, ascending by id. Built from each
 * root's rail rows, so "a message" and "its first message" mean what the rail
 * means by them.
 */
export function summarizeRoots(index: TreeIndex): readonly RootSummary[] {
  return [...index.roots, ...index.orphans].sort(ascending).flatMap(root => {
    const rows = projectRail(index, root)
    const first = rows[0]?.id
    if (first === undefined) return []
    const ids = rows.map(r => r.id).sort(ascending)
    return [
      {
        root,
        first,
        messages: rows.length,
        newest: ids.at(-1) ?? first,
        writers: writersOf(index, ids),
      },
    ]
  })
}

/**
 * The agent's work in each root, by the root that holds each lane's tip. A
 * lane with no tip is in no root, and `running` wins over `waiting`. The one
 * rule for when a root cannot be archived: `planArchive` refuses from it, and
 * the tab's menu disables Archive from it.
 */
export function rootWork(
  index: TreeIndex,
  lanes: readonly LaneView[],
): ReadonlyMap<string, "running" | "waiting"> {
  const work = new Map<string, "running" | "waiting">()
  for (const lane of lanes) {
    if (lane.tip === null) continue
    const root = rootOf(index, lane.tip)
    if (root === null) continue
    if (lane.running) work.set(root, "running")
    else if (lane.waiting > 0 && work.get(root) !== "running")
      work.set(root, "waiting")
  }
  return work
}

const UUIDV7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-/i

/** A uuidv7's creation time in ms since the epoch: its first 48 bits. Null for any other id. */
export function idTime(id: string): number | null {
  const m = UUIDV7.exec(id)
  return m === null ? null : Number.parseInt(`${m[1]}${m[2]}`, 16)
}
