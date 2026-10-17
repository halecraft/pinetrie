// host/threads-now — a thread as it is now, for the relays, the answers and
// the late steps: where it is, its tree, its end and its lane, and the names
// a message about it uses.

import {
  type EntryId,
  type Reach,
  type ThreadId,
  type ThreadLane,
  type TreeIndex,
  threadEnd,
  threadLane,
  type WriterId,
} from "@pinetrie/core"
import {
  readArchived,
  readLanes,
  readNames,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import { displayName, NONE_BLANK, threadReach } from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import { lateAwayNow } from "./later.ts"
import type { StepDocs } from "./roots.ts"

/** What a thread is, read now: its root's index, its end, and its lane. */
interface ThreadNow {
  readonly thread: ThreadId
  readonly index: TreeIndex
  readonly end: EntryId | null
  readonly lane: ThreadLane
}

interface ThreadsNow {
  /**
   * `thread` as it is now, its root loaded through the step's `roots`; null
   * for a thread no root holds, or one whose card is not at a live place
   * (`lateAway`): an archived canvas's root is not loaded, and a destroyed one
   * is not made again.
   */
  thread(roots: StepDocs, thread: ThreadId): Promise<ThreadNow | null>
  /** Where `thread` is now, from the session and the places. */
  reach(thread: ThreadId): Reach
  /** A thread's name, or the end of its id for one not named yet. */
  nameOf(thread: ThreadId): string
  /** A person's name as the session has it. */
  personName(writer: WriterId): string
}

export function threadsNow(
  basics: Pick<Basics, "session" | "places" | "live">,
): ThreadsNow {
  const { session, places, live } = basics
  return {
    async thread(roots, thread) {
      const root = readThreads(session).get(thread)?.root
      if (root === undefined) return null
      if (lateAwayNow(basics, { kind: "thread", thread }) !== null) return null
      const doc = await roots.root(root)
      const index = readTreeIndex(doc)
      const lane = threadLane(
        readLanes(
          { doc, live },
          index,
          readPlaces(places),
          readQueueHolds(session),
          NONE_BLANK,
        ),
        thread,
      )
      const end =
        lane.kind === "lane"
          ? (readLaneTip(doc, thread) ?? null)
          : threadEnd(index, thread)
      return { thread, index, end, lane }
    },
    reach: thread =>
      threadReach(thread, {
        cards: readPlaces(places),
        archived: readArchived(session, places),
      }),
    nameOf: thread => readNames(session).get(thread) ?? thread.slice(-8),
    personName: w => displayName(w, readParticipantNames(session).get(w)),
  }
}
