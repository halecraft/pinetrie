// interface/fixtures — test support for the interface's unit tests and the
// page's: core's entries (`@pinetrie/core/fixtures`), and the trees and roots
// these tests share. Production code never imports it; the page's tests take
// it as `@pinetrie/interface/fixtures`.

import {
  cardIdOfKind,
  type EntryId,
  type EntryLike,
  indexTree,
  NO_CONTENT,
  rootIdFor,
  rootOf,
  type TaskId,
  type ThreadCard,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { entriesOf, entry, withThreads } from "@pinetrie/core/fixtures"

export {
  entriesOf,
  entry,
  fromParents,
  threadOfEntry,
  withThreads,
} from "@pinetrie/core/fixtures"

import { type Tasks, tasksOf } from "./tasks.ts"

/**
 * The index of `list`, keyed by each entry's own id as the reads key them,
 * in threads as a branch writes them (`withThreads`).
 */
export const indexOf = (list: Iterable<EntryLike>): TreeIndex =>
  indexTree(withThreads(entriesOf(list)))

/**
 * A tree of chat messages from `child: parent` pairs, each message's text its
 * id; `sends` gives some entries a send id.
 */
export const tree = (
  parents: Record<string, string | null>,
  sends: Record<string, string> = {},
): TreeIndex =>
  indexOf(
    Object.entries(parents).map(([id, parentId]) =>
      entry(id, parentId, {
        role: "chat",
        content: id,
        ...(sends[id] === undefined ? {} : { sendId: sends[id] }),
      }),
    ),
  )

/** The root a test's places and entries are in (ADR-0063). */
export const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** A root a new tab minted as it opened (ADR-0066), in the shape the host accepts. */
export const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
/** A thread a column minted as it opened (ADR-0117, ADR-0126), in the shape the host accepts. */
export const NEW_THREAD = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")

/** A note column minted for an intent (ADR-0116), in `parseCardId`'s shape. */
export const NEW_NOTE_COLUMN = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000cc",
)

/** The task a new tab's first send starts, in `parseNewTask`'s shape (ADR-0116). */
export const NEW_TASK = taskIdFor("01a0ffd2-0000-7000-8000-0000000000bb")

/** A task the fixtures' threads are in. */
export const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

/**
 * The page's tasks for a test (ADR-0116): each task holding every thread of
 * `index` whose first entry is under the root entry named with it, each a
 * thread card on its canvas in thread order, its root `TEST_ROOT`.
 */
export function tasksFor(
  index: TreeIndex,
  ...pairs: readonly (readonly [TaskId, EntryId])[]
): Tasks {
  const cards: ThreadCard[] = []
  const threads = new Map<ThreadId, ThreadRecord>()
  for (const [thread, first] of [...index.firstOf].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const root = rootOf(index, first)
    const task = pairs.find(([, entry]) => entry === root)?.[0]
    if (task === undefined) continue
    cards.push({
      kind: "thread",
      id: thread,
      owner: TEST_WRITER,
      placer: TEST_WRITER,
      place: { kind: "canvas", task, order: `a${cards.length}`, width: 1 },
      content: NO_CONTENT,
    })
    threads.set(thread, {
      thread,
      root: TEST_ROOT,
      by: TEST_WRITER,
      createdAt: 0,
      origin: { kind: "root" },
    })
  }
  return tasksOf({ known: pairs.map(([task]) => task), cards, threads })
}

const TEST_WRITER = writerId("ada@x.io")
