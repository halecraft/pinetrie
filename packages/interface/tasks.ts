// interface/tasks — the tasks a page shows (ADR-0116): the rules' task index
// (`indexTasks`, the host's too), with each task's first root's root entry
// from the directory, which keys a root's columns, labels and signals. Pure.

import type {
  CardRecord,
  EntryId,
  RootId,
  RootRecord,
  TaskId,
  ThreadId,
  ThreadRecord,
} from "@pinetrie/core"
import { indexTasks, NO_TASK_INDEX, type TaskIndex } from "@pinetrie/rules"

/** One task, as the page reads it. */
export interface TaskView {
  readonly task: TaskId
  /** Its thread cards, in its canvas's order. */
  readonly threads: readonly ThreadId[]
  /** The roots of its threads, each once, in canvas order. */
  readonly roots: readonly RootId[]
  /** Its first root's root entry; null before that root has a message. */
  readonly entry: EntryId | null
}

/** Every task, and the lookups between tasks and roots. */
export interface Tasks {
  /** The index the host decides by too. */
  readonly index: TaskIndex
  readonly byId: ReadonlyMap<TaskId, TaskView>
  /** Each root entry's task: the first, by id, holding a thread of its root. */
  readonly ofEntry: ReadonlyMap<EntryId, TaskId>
}

export const NO_TASKS: Tasks = {
  index: NO_TASK_INDEX,
  byId: new Map(),
  ofEntry: new Map(),
}

/**
 * Every task in `known` (the session's task records), its canvas read from
 * `cards`, and each thread's root from its record. Pure.
 */
export function tasksOf(input: {
  readonly known: Iterable<TaskId>
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  readonly directory: ReadonlyMap<RootId, RootRecord>
}): Tasks {
  const index = indexTasks(input.cards, input.threads)
  const entryOf = (root: RootId | undefined) =>
    root === undefined ? null : (input.directory.get(root)?.entry ?? null)
  const byId = new Map<TaskId, TaskView>()
  for (const task of [...input.known].sort()) {
    const roots = index.rootsOf.get(task) ?? []
    byId.set(task, {
      task,
      threads: index.threadsOf.get(task) ?? [],
      roots,
      entry: entryOf(roots[0]),
    })
  }
  const ofEntry = new Map<EntryId, TaskId>()
  for (const [root, tasks] of index.tasksOfRoot) {
    const entry = entryOf(root)
    const first = tasks.find(t => byId.has(t))
    if (entry !== null && first !== undefined) ofEntry.set(entry, first)
  }
  return { index, byId, ofEntry }
}

/** Each task's first root's root entry, for those that have one. */
export const entriesOf = (tasks: Tasks): ReadonlyMap<TaskId, EntryId> =>
  new Map(
    [...tasks.byId.values()].flatMap(t =>
      t.entry === null ? [] : [[t.task, t.entry] as const],
    ),
  )
