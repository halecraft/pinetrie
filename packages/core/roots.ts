// core/roots — each root's tree, summarized. The host writes a root's summary
// into its directory record (`readRootRecord` in @pinetrie/reads), which the
// sidebar, your inbox and the board read.
//
// A root is found by walking up (`treeRoot`), and a thread started at the root is
// rooted at its first message, so a root's id is its tab's key.

import type { EntryId, RootId, ThreadId, WriterId } from "./ids.ts"
import type { Sha256 } from "./images.ts"
import {
  firstLine,
  isBusy,
  type LaneView,
  messageText,
  messageWriters,
  projectRail,
  type TreeIndex,
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
        writers: messageWriters(index, ids),
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
export const rootFirstLine = (
  index: TreeIndex,
  first: EntryId | null,
): string =>
  (first === null
    ? ""
    : firstLine(messageText(index.entries[first]?.message), 40)) || NO_TEXT

/**
 * A root as the sidebar, the board and your inbox see it,
 * without its document: a host-written `pinetrie.root` value in the session,
 * keyed by the root's id, refreshed whenever the root's document changes.
 */
export interface RootRecord {
  readonly root: RootId
  /** Its root entry, the tab's key; null before its first message. */
  readonly entry: EntryId | null
  /** Its first message, as the rail finds it (`RootSummary.first`). */
  readonly first: EntryId | null
  /** That message's first line: the label while it has no title. */
  readonly firstLine: string
  /** Its messages: the rail's rows. */
  readonly messages: number
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: EntryId | null
  /** Everyone who wrote a chat in it, in order of first message. */
  readonly writers: readonly WriterId[]
  /**
   * Per thread, everyone who wrote a chat on its path from the root to its tip,
   * in order of first message: its followers.
   */
  readonly threads: Readonly<Record<ThreadId, readonly WriterId[]>>
  /**
   * Its sends that name someone (`@`), for the inbox to resolve, each with the
   * thread it is in, which the inbox opens it in.
   */
  readonly mentions: readonly {
    readonly id: EntryId
    readonly by: WriterId
    readonly text: string
    readonly thread: ThreadId
  }[]
  /** Every blob it shows or shares (`referencedBlobs`), for the sweep. */
  readonly blobs: readonly Sha256[]
}
