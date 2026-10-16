// core/roots — each root's tree, summarized. The host writes a root's summary
// into its directory record (`readRootRecord` in @pinetrie/reads), which the
// sidebar, your inbox and the board read.
//
// A root is found by walking up (`rootOf`), and a thread started at the root is
// rooted at its first message, so a root's id is its tab's key.

import type { EntryId, ThreadId, WriterId } from "./index.ts"
import {
  firstLine,
  isBusy,
  type LaneView,
  messageText,
  projectRail,
  type TreeIndex,
  writersOf,
} from "./tree.ts"

export interface RootSummary {
  readonly root: EntryId
  /** Its first message, as the rail finds it: the tab's label until a title names it. */
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
 * What the agent has in a busy lane: a run (`running`), cards it will be sent
 * when it is free (`waiting`), or cards that wait for someone to release the
 * queue (`held`).
 */
export type AgentWork = "running" | "waiting" | "held"

const WORK_RANK: Record<AgentWork, number> = { held: 0, waiting: 1, running: 2 }

/** The more of `was` and `now`, running over waiting over held: `now` with no `was`. */
export const moreWork = (
  was: AgentWork | undefined,
  now: AgentWork,
): AgentWork =>
  was !== undefined && WORK_RANK[was] >= WORK_RANK[now] ? was : now

/** A busy lane's work: running, else held while its queue is held, else waiting. */
export const laneWork = (lane: LaneView): AgentWork =>
  lane.running ? "running" : lane.heldBy !== null ? "held" : "waiting"

/**
 * The agent's work among `threads`' lanes: a canvas's, whatever roots its
 * threads are in. Running wins over waiting, and waiting over held; undefined
 * when none is busy. The one rule for when a canvas cannot be archived.
 */
export function threadsWork(
  lanes: readonly LaneView[],
  threads: ReadonlySet<ThreadId>,
): AgentWork | undefined {
  let work: AgentWork | undefined
  for (const lane of lanes) {
    if (threads.has(lane.name) && isBusy(lane))
      work = moreWork(work, laneWork(lane))
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
