// archive — what crossing the archive's edge does, and the tasks a command
// writes in, which the gate (`gate.ts`) keeps out of an archived task.

import {
  type ArchivedTask,
  atEntry,
  type CardId,
  type CardRecord,
  type EntryId,
  ERR,
  type Gated,
  type LaneView,
  type MoveTarget,
  nearestRevision,
  type PointId,
  type Refusal,
  type RevisionRecord,
  type RootId,
  type RootWork,
  refused,
  type SnapshotId,
  type TaskId,
  type ThreadId,
  type TreeIndex,
  threadEnd,
  threadsWork,
  type VerdictRecord,
} from "@pinetrie/core"
import { type TaskIndex, taskOfCard, taskOfTarget } from "./task.ts"
import { unclassifiedPending } from "./verdict.ts"
import { planRetention } from "./work.ts"

/** Into the archive, or out of it: `transitionOf`'s crossings. */
export type Crossing = "archive" | "restore"

/**
 * What archiving or restoring does off the documents' keeper, after the task's
 * place is written: lanes to forget and remove (their containers
 * and disks), their refs in your repo moved (null deletes, on archiving), and
 * snapshots to delete. Empty on a host without lanes of their own.
 */
export interface ArchiveTeardown {
  readonly forget: readonly ThreadId[]
  readonly refs: readonly {
    readonly lane: ThreadId
    readonly point: PointId | null
  }[]
  readonly snapshots: readonly SnapshotId[]
}

type ArchivePlan =
  | Refusal
  | {
      readonly kind: "cross"
      /** Off the keeper, after the place is written. */
      readonly teardown: ArchiveTeardown
      /** On the keeper again, after the teardown: the roots to let go of. */
      readonly unload: readonly RootId[]
      /**
       * With the place, on archiving: each of the task's threads' verdicts
       * still pending, `unclassified`. Its run's end, a late write, is
       * refused from now on, and would have been the one to write it.
       */
      readonly verdicts: readonly VerdictRecord[]
    }

/** Why a task cannot be archived now, as the board and the host both say it. */
export const TASK_BUSY_REASON = {
  running: "an agent is working here",
  waiting: "cards are queued here",
  held: "cards are queued here",
} as const satisfies Record<RootWork, string>

/**
 * Decide what crossing the archive's edge does for a task. A task an agent
 * of its threads works in, or where cards are queued, is not archived:
 * stopping the run or holding the queue would do work nobody asked for, so
 * the person chooses. Restoring is never busy. Archiving lets go
 * of the roots no task outside the archive, and no inventory, still holds a
 * thread of (`stillHeld`).
 */
export function planArchive(input: {
  readonly crossing: Crossing
  readonly threads: readonly ThreadId[]
  readonly lanes: readonly LaneView[]
  /**
   * The task's lanes of their own, by their records, with each one's tip
   * and its root's tree; empty on a host without lanes of their own.
   */
  readonly own: readonly {
    readonly lane: ThreadId
    readonly tip: EntryId | null
    readonly index: TreeIndex
  }[]
  /** Its roots' revision records: what its lanes' turns recorded. */
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Its roots' trees, whose every thread's end keeps its snapshot. */
  readonly trees: readonly TreeIndex[]
  /** The roots of the task's threads. */
  readonly roots: readonly RootId[]
  /** The roots a thread outside this task, in no archived task, is in. */
  readonly stillHeld: ReadonlySet<RootId>
  /** Every thread's verdict, by its lane. */
  readonly verdicts: ReadonlyMap<ThreadId, VerdictRecord>
}): ArchivePlan {
  const { crossing } = input
  const busy = threadsWork(input.lanes, new Set(input.threads))
  if (crossing === "archive" && busy !== undefined)
    return refused(ERR.TASK_BUSY, TASK_BUSY_REASON[busy])
  return {
    kind: "cross",
    teardown: planTeardown(crossing, input),
    unload:
      crossing === "archive"
        ? input.roots.filter(r => !input.stillHeld.has(r))
        : [],
    verdicts:
      crossing === "archive"
        ? unclassifiedPending(input.verdicts.values(), lane =>
            input.threads.includes(lane),
          )
        : [],
  }
}

/**
 * Archive: every own lane gone (`planLanesGone`). Restore: each lane's ref
 * back at its tip's nearest revision (`nearestRevision`), none for a lane
 * with no tip or no revision yet.
 */
function planTeardown(
  crossing: Crossing,
  input: Pick<Parameters<typeof planArchive>[0], "own" | "revisions" | "trees">,
): ArchiveTeardown {
  if (crossing === "archive")
    return planLanesGone(
      input.own.map(o => o.lane),
      input.revisions,
      input.trees,
    )
  return {
    forget: [],
    refs: input.own.flatMap(({ lane, tip, index }) => {
      if (tip === null) return []
      const { point } = nearestRevision(index, input.revisions, {
        kind: "entry",
        id: tip,
      })
      return point === null ? [] : [{ lane, point }]
    }),
    snapshots: [],
  }
}

/**
 * Lanes that will not run again, an archived task's or a deleted thread's:
 * each forgotten, its ref deleted (which withdraws its offer), and every
 * snapshot of it but its newest and the one nearest each thread's end in
 * `trees`, whatever task that thread is in (`planRetention`), so a copy
 * from the archive finds its files.
 */
export function planLanesGone(
  lanes: readonly ThreadId[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  trees: readonly TreeIndex[],
): ArchiveTeardown {
  const gone = new Set<string>(lanes)
  return {
    forget: lanes,
    refs: lanes.map(lane => ({ lane, point: null })),
    snapshots: planRetention({
      records: [...revisions.values()].filter(r => gone.has(r.lane)),
      archived: true,
      keep: endSnapshots(trees, revisions),
    }),
  }
}

/**
 * The tasks a command or a send writes in, none for a name, a
 * picture, a stop, a move on the board or a change to its states, a
 * reservation, a card's command, or traces seen. A send at a thread's end,
 * or popped from its queue, writes in the thread's task, a branch in the
 * task it lands in; an offer,
 * a carry-on and a queue's hold in their lane's thread's; a card's move in
 * the task each card leaves as well as the one it goes to, so nothing moves
 * out of an archived task; an undo of moves, a mark and a retitle in their
 * own.
 */
export function writesIn(
  intent: Gated,
  tasks: TaskIndex,
  cards: readonly CardRecord[],
): readonly TaskId[] {
  const tasksOf = {
    thread: (t: ThreadId) => tasks.taskOfThread.get(t) ?? null,
    place: (to: MoveTarget) => taskOfTarget(tasks, to),
    card: (id: CardId) => taskOfCard(tasks, cards, id),
  }
  const only = (...tasks: readonly (TaskId | null)[]): readonly TaskId[] =>
    tasks.filter((t, i): t is TaskId => t !== null && tasks.indexOf(t) === i)
  switch (intent.kind) {
    case "chat":
      return only(
        intent.at.kind === "branch"
          ? intent.at.task
          : tasksOf.thread(intent.at.thread),
      )
    // An offer acts at its lane's tip: an archived task's lanes offer no
    // work out. A carry-on writes its message there.
    case "offer":
    case "carry-on":
    // A queue's hold, and its cards unqueued, are its lane's thread's.
    case "queue-hold":
    case "unqueue-all":
      return only(tasksOf.thread(intent.lane))
    // A card queued writes in its queue's task, and leaves its own.
    case "queue-card":
      return only(tasksOf.place(intent.move.to), tasksOf.card(intent.move.card))
    // A thread opened writes in the task its card lands in.
    case "open-thread":
      return only(intent.task)
    // A spin-off writes a new task, in no archive, and the card leaves its
    // own for the history its trash place names.
    case "spin-off":
      return only(tasksOf.card(intent.move.card), tasksOf.place(intent.move.to))
    // A copy writes in the task its card lands in alone: an archived
    // thread is copied, since archiving freezes its end, not its history.
    case "copy-thread":
      return only(tasksOf.place(intent.move.to))
    // A paste writes where it lands, and discards the card it replaces
    // where that is (an edit as text's reference, a slot's card).
    case "paste":
      return only(
        tasksOf.place(intent.to),
        intent.replacing === null ? null : tasksOf.card(intent.replacing.card),
      )
    // A reorder stays in the place it names.
    case "reorder":
      return only(tasksOf.place(intent.reorder.at))
    // A width is drawn on the canvas it names.
    case "card-width":
      return only(intent.at.task)
    // A note column's title writes in its column's task.
    case "mark":
      return intent.of.kind === "task"
        ? [intent.of.task]
        : only(tasksOf.card(intent.of.column))
    case "retitle":
      return [intent.task]
    case "undo-move":
      return intent.task === null ? [] : [intent.task]
    case "move":
      return only(
        ...intent.moves.flatMap(m => [
          tasksOf.place(m.to),
          tasksOf.card(m.card),
        ]),
      )
    case "name":
    case "picture":
    case "stop":
    // The board is the session's: a move into or out of the archive writes
    // in no task, so an archived task can be restored.
    case "move-task":
    case "workflow":
    case "reserve":
    // Accepted work is your repo's, in no task.
    case "setup":
    case "publish":
    // A command acts only when its card is popped, its send cleared then.
    case "set-command":
    // Traces are the session's, in no task.
    case "traces-seen":
    // An answer to a lane's ssh writes its access record, in no task: the
    // owner can take back what an archived task's lane holds.
    case "ssh-access":
      return []
  }
}

/** The archived task among the `written` tasks, which makes it read-only, or null. */
export function archivedIn(
  written: readonly TaskId[],
  archived: ReadonlyMap<TaskId, ArchivedTask>,
): ArchivedTask | null {
  for (const task of written) {
    const found = archived.get(task)
    if (found !== undefined) return found
  }
  return null
}

/** The snapshot nearest each thread's end in `trees` (`nearestRevision`). */
function endSnapshots(
  trees: readonly TreeIndex[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): ReadonlySet<SnapshotId> {
  const keep = new Set<SnapshotId>()
  for (const index of trees)
    for (const thread of index.firstOf.keys()) {
      const end = threadEnd(index, thread)
      if (end === null) continue
      const { snapshot } = nearestRevision(index, revisions, atEntry(end))
      if (snapshot !== null) keep.add(snapshot)
    }
  return keep
}
