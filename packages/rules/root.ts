// root — deleting a conversation root a card was spun into, with the task it
// was spun into.

import {
  type CardRecord,
  livePlaceOf,
  ownerOf,
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
import { THREAD } from "./thread.ts"

/**
 * The tasks a step leaves empty that were a new tab's: a thread
 * card that left `task`'s canvas for a trash, its thread a new root's not
 * yet started (its root one the directory does not name, `started`), and
 * nothing left on that canvas or pinned to the task. Closing an unsent new
 * tab sends its task's card to the trash too (`planTasksTrashed`).
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
    const holds = input.after.some(d => {
      if (d.place.kind === "trash") return false
      const owner = ownerOf(d.place)
      return owner.kind === "task" && owner.task === task
    })
    if (!holds) out.push(task)
  }
  return out
}

/**
 * Each of `tasks`' cards from the board to the trash, remembering where it
 * was there, its closer its placer: written in the close's step, so the
 * undo key brings the task back with its thread. A task with no card on
 * the board is left.
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
              place: { kind: "trash", left: c.place },
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
 * task's own included.
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
      .filter(c => {
        if (c.id === task) return true
        const owner = ownerOf(livePlaceOf(c.place))
        return owner.kind === "task"
          ? owner.task === task
          : owner.kind === "thread" && rootOfThread.get(owner.thread) === root
      })
      .map(c => ({ kind: "remove", id: c.id })),
    doc: rootDocId(root),
    histories: task,
  }
}
