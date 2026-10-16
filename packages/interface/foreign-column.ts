// interface/foreign-column — a column whose next run would start on a lane
// of another kind than the project's: read-only, saying why, by the rule
// the host's gate refuses it by (`foreignIn`).

import {
  atEntry,
  type EntryId,
  type ForeignLane,
  type LaneRecord,
  nearestRevision,
  type ProjectRecord,
  type RevisionRecord,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { foreignIn, type RunAt } from "@pinetrie/rules"
import type { ReadOnly } from "./app-view.ts"
import { type Column, unstartedOf } from "./columns.ts"
import type { Reader } from "./send.ts"
import { heldWords } from "./thread-link.ts"

/**
 * Why a run cannot start from `column`: its own lane, or for a thread not
 * yet started, the lane whose disk its first send would clone, keeps a
 * history of another kind. A snapshot is taken as kept: the page cannot see
 * snapshots, so where one was lost it refuses a send the host would allow,
 * which can do no harm. Null with no project (a host without tools), and
 * for a new root's thread, which forks from the base.
 */
export function columnForeign(
  column: Pick<Column, "thread" | "mode">,
  index: TreeIndex,
  work: {
    readonly project: ProjectRecord | null
    readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
    readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  },
): ForeignLane | null {
  const unstarted = unstartedOf(column)
  const at: readonly RunAt[] =
    unstarted === undefined
      ? [{ kind: "thread", thread: column.thread }]
      : unstarted.fork === null
        ? []
        : [
            {
              kind: "entry",
              root: unstarted.root,
              entry: unstarted.fork,
              starts: column.thread,
            },
          ]
  return foreignIn(at, {
    lanes: work.lanes,
    kind: work.project?.kind ?? null,
    aboveAt: (_root, entry) =>
      nearestRevision(index, work.revisions, atEntry(entry)),
  })
}

/** Why a column of another kind is read-only, in the page's words. */
export const foreignWords = (lane: ForeignLane): string =>
  lane.history === "jj"
    ? "made when the project had a jj repo: nothing runs here now"
    : "made when the project had no jj repo: nothing runs here now"

/**
 * What a thread column says in place of its composer: who holds the thread a
 * branch forks in, else its canvas's archive, else a lane of another kind;
 * null when it may be written in.
 */
export function columnReadOnly(input: {
  readonly canvas: ReadOnly | null
  readonly heldBy: WriterId | null
  readonly foreign: ForeignLane | null
  readonly reader: Reader
}): ReadOnly | null {
  if (input.heldBy !== null)
    return { label: heldWords(input.heldBy, input.reader), action: null }
  if (input.canvas !== null) return input.canvas
  return input.foreign === null
    ? null
    : { label: foreignWords(input.foreign), action: null }
}
