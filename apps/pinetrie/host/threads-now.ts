// host/threads-now — a thread as it is now, for the relays, the answers and
// the late steps: where it is, its tree, its end and its lane, and the names
// a message about it uses.

import {
  type EntryId,
  laneOf,
  type Reach,
  type ThreadId,
  type ThreadLane,
  type TreeIndex,
  threadEnd,
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

/** What a thread is, read now: its root's index, its end, and its lane. */
export interface ThreadNow {
  readonly thread: ThreadId
  readonly index: TreeIndex
  readonly end: EntryId | null
  readonly lane: ThreadLane
}

export interface ThreadsNow {
  /**
   * `thread` as it is now; null for a thread no root holds, or one whose card
   * is not at a live place (`lateAway`). Its root is opened if it is not
   * loaded, which only a live thread's may be: an archived task's root
   * stays let go, and a destroyed one is not made again.
   */
  thread(thread: ThreadId): Promise<ThreadNow | null>
  /** Where `thread` is now, from the session and the places. */
  reach(thread: ThreadId): Reach
  /** A thread's name, or the end of its id for one not named yet. */
  nameOf(thread: ThreadId): string
  /** A person's name as the session has it. */
  personName(writer: WriterId): string
}

export function threadsNow(
  basics: Pick<Basics, "docs" | "session" | "places" | "live">,
): ThreadsNow {
  const { docs, session, places, live } = basics
  return {
    async thread(thread) {
      const root = readThreads(session).get(thread)?.root
      if (root === undefined) return null
      if (lateAwayNow(basics, { kind: "thread", thread }) !== null) return null
      const doc = await docs.root(root)
      const index = readTreeIndex(doc)
      const lane = laneOf(
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
