// interface/tasks — the tasks a page shows: the rules' task index
// (`indexTasks`, the host's too), each task with its threads and their
// roots. A task's signals are its threads' (`taskStatus`, `taskWork`).

import type {
  CardRecord,
  RootId,
  TaskId,
  ThreadId,
  ThreadRecord,
} from "@pinetrie/core"
import {
  boardTasks,
  indexTasks,
  NO_TASK_INDEX,
  type TaskIndex,
} from "@pinetrie/rules"

/** One task, as the page reads it. */
export interface TaskThreads {
  readonly task: TaskId
  /** Its thread cards, in its canvas's order. */
  readonly threads: readonly ThreadId[]
  /** The roots of its threads, each once, in canvas order. */
  readonly roots: readonly RootId[]
}

/** Every task, and the index the host decides by too. */
export interface Tasks {
  readonly index: TaskIndex
  readonly byId: ReadonlyMap<TaskId, TaskThreads>
}

export const NO_TASKS: Tasks = { index: NO_TASK_INDEX, byId: new Map() }

/**
 * Every task whose card is on the board (`boardTasks`), its canvas read
 * from `cards`, and each thread's root from its record.
 */
export function tasksOf(input: {
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
}): Tasks {
  const index = indexTasks(input.cards, input.threads)
  const byId = new Map<TaskId, TaskThreads>()
  for (const task of [...boardTasks(input.cards)].sort())
    byId.set(task, {
      task,
      threads: index.threadsOf.get(task) ?? [],
      roots: index.rootsOf.get(task) ?? [],
    })
  return { index, byId }
}
