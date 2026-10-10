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
  type WriterId,
} from "@pinetrie/core"
import { isBoardCard } from "./board.ts"
import { MARK } from "./mark.ts"
import type { PlaceStep } from "./moves.ts"
import { deleteRecord } from "./records.ts"
import { ROOT } from "./roots.ts"
import { rootOfPlace } from "./task.ts"
import { THREAD } from "./thread.ts"

/**
 * The tasks a step leaves empty that were a new tab's (ADR-0126): a thread
 * card that left `task`'s canvas for a trash, its thread a new root's not
 * yet started (its root one the directory does not name, `started`), and
 * nothing left on that canvas or pinned to the task. Closing an unsent new
 * tab sends its task's card to the trash too (`planTasksTrashed`). Pure.
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

/**
 * Each of `tasks`' cards from the board to `closer`'s trash (ADR-0126),
 * remembering the task, whose closer placed it there: written in the
 * close's step, so the undo key brings the task back with its thread. A
 * task with no card on the board is left. Pure.
 */
export function planTasksTrashed(
  cards: readonly CardRecord[],
  tasks: readonly TaskId[],
  closer: WriterId,
): readonly PlaceStep[] {
  return cards.flatMap((c): PlaceStep[] =>
    isBoardCard(c) && tasks.includes(c.id)
      ? [
          {
            kind: "write",
            record: {
              ...c,
              place: { kind: "trash", holder: closer, task: c.id },
              placer: closer,
            },
          },
        ]
      : [],
  )
}

/** What deleting a root writes, and what it lets go. */
export interface RootDelete {
  /** Its directory record, its thread's, and its task's title. */
  readonly values: readonly ValueWrite[]
  /** Every card still in it, a new tab's, say, its task's canvas and the task's card. */
  readonly cards: readonly PlaceStep[]
  /** Its document, destroyed: its tree, and the records kept in it. */
  readonly doc: string
  /** The task whose stacks of moves are unloaded; the startup sweep retires them. */
  readonly histories: TaskId
}

/**
 * Delete `root`, its one thread, and the task it was spun into: their
 * records, the task's title, the document and every card in either, the
 * task's own included. Pure.
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
      deleteRecord(MARK, task),
    ],
    cards: cards
      .filter(
        c =>
          c.id === task ||
          rootOfPlace(c.place, rootOfThread) === root ||
          (c.place.kind === "canvas" && c.place.task === task),
      )
      .map(c => ({ kind: "remove", id: c.id })),
    doc: rootDocId(root),
    histories: task,
  }
}
