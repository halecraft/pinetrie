// archive — what crossing the archive's edge does (ADR-0029, ADR-0122,
// ADR-0116), and the gate that keeps an archived task read-only.
//
// A task is archived while its board place is in the archive (`board.ts`).
// Moving it there or out writes only its place: entries are immutable
// (ADR-0004), so a task is hidden and its threads made read-only, never
// removed. What follows the place is planned here: the busy check, the
// teardown off the documents' keeper (ADR-0065), and the roots to unload.

import {
  type ArchivedTask,
  type CardId,
  type CardRecord,
  type CommitId,
  type EntryId,
  ERR,
  type Intent,
  type LaneView,
  nearestRevision,
  type PlaceKey,
  type Refusal,
  type RevisionRecord,
  type RootId,
  type RootWork,
  refused,
  type SnapshotId,
  type TaskId,
  type ThreadId,
  type TreeIndex,
  threadsWork,
} from "@pinetrie/core"
import { type TaskIndex, taskOfCard, taskOfPlace } from "./task.ts"
import { planRetention } from "./work.ts"

/** Into the archive, or out of it: `transitionOf`'s crossings. */
export type Crossing = "archive" | "restore"

/**
 * What archiving or restoring does off the documents' keeper, after the task's
 * place is written (ADR-0065): lanes to forget and remove (their containers
 * and disks), their refs in your repo moved (null deletes, on archiving), and
 * snapshots to delete. Empty on a host without lanes of their own.
 */
export interface ArchiveTeardown {
  readonly forget: readonly ThreadId[]
  readonly refs: readonly {
    readonly lane: ThreadId
    readonly commit: CommitId | null
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
 * the person chooses (ADR-0029). Restoring is never busy. Archiving lets go
 * of the roots no task outside the archive, and no inventory, still holds a
 * thread of (`stillHeld`).
 */
export function planArchive(input: {
  readonly crossing: Crossing
  /** The task's threads. */
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
  /** The roots of the task's threads. */
  readonly roots: readonly RootId[]
  /** The roots a thread outside this task, in no archived task, is in. */
  readonly stillHeld: ReadonlySet<RootId>
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
  }
}

/**
 * Archive: every own lane forgotten, its ref deleted, and every snapshot but
 * each lane's newest (`planRetention`). Restore: each lane's ref back at its
 * tip's nearest revision (`nearestRevision`), none for a lane with no tip or
 * no revision yet.
 */
function planTeardown(
  crossing: Crossing,
  input: Pick<Parameters<typeof planArchive>[0], "own" | "revisions">,
): ArchiveTeardown {
  const lanes = input.own.map(o => o.lane)
  if (crossing === "archive") {
    const inRoot = new Set<string>(lanes)
    return {
      forget: lanes,
      refs: lanes.map(lane => ({ lane, commit: null })),
      snapshots: planRetention({
        records: [...input.revisions.values()].filter(r => inRoot.has(r.lane)),
        archived: true,
      }),
    }
  }
  return {
    forget: [],
    refs: input.own.flatMap(({ lane, tip, index }) => {
      if (tip === null) return []
      const { commit } = nearestRevision(index, input.revisions, {
        kind: "entry",
        id: tip,
      })
      return commit === null ? [] : [{ lane, commit }]
    }),
    snapshots: [],
  }
}

/**
 * The tasks a command writes in (ADR-0063, ADR-0116), none for a name, a
 * picture, a stop, a move on the board or a change to its states, a
 * reservation, a card's command, or traces seen. A send at a thread's end
 * writes in the thread's task, a branch in the task it lands in; an offer,
 * a carry-on and a queue's hold in their lane's thread's; a card's move in
 * the task each card leaves as well as the one it goes to, so nothing moves
 * out of an archived task; an undo of moves, a mark and a retitle in their
 * own (ADR-0066, ADR-0074).
 */
export function writesIn(
  intent: Intent,
  tasks: TaskIndex,
  cards: readonly CardRecord[],
): readonly TaskId[] {
  const tasksOf = {
    thread: (t: ThreadId) => tasks.taskOfThread.get(t) ?? null,
    place: (key: PlaceKey) => taskOfPlace(tasks, key),
    card: (id: CardId) => taskOfCard(tasks, cards, id),
  }
  const only = (...tasks: readonly (TaskId | null)[]): readonly TaskId[] =>
    tasks.filter((t, i): t is TaskId => t !== null && tasks.indexOf(t) === i)
  switch (intent.kind) {
    case "chat":
      return only(
        intent.at.kind === "end"
          ? tasksOf.thread(intent.at.thread)
          : intent.at.task,
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
    // A spin-off writes a new task, in no archive, and the card leaves its
    // own for the history its gone place names.
    case "spin-off":
      return only(tasksOf.card(intent.move.card), tasksOf.place(intent.move.to))
    // A reorder stays in the place it names.
    case "reorder":
      return only(tasksOf.place(intent.reorder.at))
    // A note column's title writes in its column's task.
    case "mark":
      return intent.of.kind === "task"
        ? [intent.of.task]
        : only(tasksOf.card(intent.of.column))
    case "retitle":
    case "undo-move":
      return [intent.task]
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
    // A command acts only when its card is popped, behind the pop's own check.
    case "set-command":
    // Traces are the session's, in no task.
    case "traces-seen":
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
