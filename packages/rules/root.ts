// root — deleting a conversation root: a thread a card was spun into, lifted
// back by the undo key while it held its first message alone (ADR-0111),
// with the task it was spun into (ADR-0116). Pure: the host writes what this
// plans.

import {
  type CardRecord,
  type RootId,
  rootDocId,
  type TaskId,
  type ThreadId,
  type ThreadRecord,
  type ValueWrite,
} from "@pinetrie/core"
import { BOARD } from "./board.ts"
import { MARK } from "./mark.ts"
import type { PlaceStep } from "./moves.ts"
import { deleteRecord } from "./records.ts"
import { ROOT } from "./roots.ts"
import { rootOfPlace, TASK } from "./task.ts"
import { THREAD } from "./thread.ts"

/** A task deleted (ADR-0116): its record, its board place and its title. */
export const planTaskDelete = (task: TaskId): readonly ValueWrite[] => [
  deleteRecord(TASK, task),
  deleteRecord(BOARD, task),
  deleteRecord(MARK, task),
]

/**
 * The tasks a step leaves empty that were a new tab's (ADR-0126): a thread
 * card that left `task`'s canvas for a trash, its thread a new root's not
 * yet started (its root one the directory does not name, `started`), and
 * nothing left on that canvas or pinned to the task. Closing an unsent new
 * tab deletes its task (`planTaskDelete`), not undone. Pure.
 */
export function emptiedTasks(input: {
  readonly before: readonly CardRecord[]
  readonly after: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  readonly started: ReadonlySet<RootId>
}): readonly TaskId[] {
  const now = new Map(input.after.map(c => [c.id, c] as const))
  const out: TaskId[] = []
  for (const c of input.before) {
    if (c.kind !== "thread" || c.place.kind !== "canvas") continue
    const { task } = c.place
    const record = input.threads.get(c.id)
    if (
      now.get(c.id)?.place.kind !== "trash" ||
      record?.origin.kind !== "root" ||
      input.started.has(record.root) ||
      out.includes(task)
    )
      continue
    const holds = input.after.some(
      d =>
        (d.place.kind === "canvas" || d.place.kind === "task-pinned") &&
        d.place.task === task,
    )
    if (!holds) out.push(task)
  }
  return out
}

/** What deleting a root writes, and what it lets go. */
export interface RootDelete {
  /** Its directory record, its thread's, and its task's record, board place and title. */
  readonly values: readonly ValueWrite[]
  /** Every card still in it, a new tab's, say, and its task's canvas. */
  readonly cards: readonly PlaceStep[]
  /** Its document, destroyed: its tree, and the records kept in it. */
  readonly doc: string
  /** The task whose stacks of moves are unloaded; the startup sweep retires them. */
  readonly histories: TaskId
}

/**
 * Delete `root`, its one thread, and the task it was spun into: their
 * records, the board place, the document and every card in either. Pure.
 */
export function planRootDelete(
  root: RootId,
  thread: ThreadId,
  task: TaskId,
  cards: readonly CardRecord[],
  rootOfThread: ReadonlyMap<ThreadId, RootId>,
): RootDelete {
  return {
    values: [
      deleteRecord(ROOT, root),
      deleteRecord(THREAD, thread),
      ...planTaskDelete(task),
    ],
    cards: cards
      .filter(
        c =>
          rootOfPlace(c.place, rootOfThread) === root ||
          (c.place.kind === "canvas" && c.place.task === task),
      )
      .map(c => ({ kind: "remove", id: c.id })),
    doc: rootDocId(root),
    histories: task,
  }
}
