// core/roots — each root's tree, summarized (ADR-0029, ADR-0030). Pure. The
// host writes a root's summary into its directory record (`readRootRecord`
// in @pinetrie/reads), which your list, your inbox and the board read
// (ADR-0063).
//
// A root is found by walking up (`rootOf`), and a thread started at the root
// is rooted at its first message (S30), so a root's id is its tab's key.

import type { EntryId, WriterId } from "./index.ts"
import {
  firstLine,
  isBusy,
  type LaneView,
  messageText,
  projectRail,
  rootOf,
  type TreeIndex,
  writersOf,
} from "./tree.ts"

export interface RootSummary {
  readonly root: EntryId
  /** Its first message, as the rail finds it: the tab's label until a title names it (ADR-0045). */
  readonly first: EntryId
  /** Its messages: the rail's rows, some of which it draws inside a run. */
  readonly messages: number
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: EntryId
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
): ReadonlyMap<EntryId, "running" | "waiting"> {
  const work = new Map<EntryId, "running" | "waiting">()
  for (const lane of lanes) {
    if (lane.tip === null || !isBusy(lane)) continue
    const root = rootOf(index, lane.tip)
    if (root === null) continue
    if (lane.running) work.set(root, "running")
    else if (work.get(root) !== "running") work.set(root, "waiting")
  }
  return work
}

/** A root whose first message has no text, or no message yet, is called this. */
export const NO_TEXT = "(no text)"

/** A root's first message's first line: its label while it has no title. */
export const firstLineOf = (index: TreeIndex, first: EntryId | null): string =>
  (first === null
    ? ""
    : firstLine(messageText(index.entries[first]?.message), 40)) || NO_TEXT
