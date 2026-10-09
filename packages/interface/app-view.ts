// interface/app-view — what the page shows, decided. PURE.
//
// `appView` decides; it does not project. The projections (`projectColumns`,
// `pathIds`, `branchColors`, `cardMarks`) stay in `App`'s own `useMemo`s and
// their results come in: one tree rebuilt each render would give every
// memoised child new props (S54, S59).

import {
  type ArchivedTask,
  type EntryId,
  isBusy,
  type LaneRecord,
  type LaneView,
  laneWork,
  type OfferRecord,
  projectRail,
  type RailRow,
  type RootId,
  type RootWork,
  type TaskId,
  type ThreadId,
  type TreeIndex,
  type Workflow,
  type WriterId,
} from "@pinetrie/core"
import { displayName, offerStatus } from "@pinetrie/rules"
import { PENDING_TRACK } from "./column-paths.ts"
import type { Column } from "./columns.ts"
import type { Intent } from "./intent.ts"
import type { Here } from "./layout.ts"

/**
 * A column nothing may be written in (ADR-0029): its composer stays mounted,
 * disabled, so what was typed survives, and shows `label` and `action` in
 * place of its buttons. `action` is null when nothing can restore it (no
 * workflow yet).
 */
export interface ReadOnly {
  readonly label: string
  readonly action: { readonly title: string; readonly intent: Intent } | null
}

/** One column of the task you are on, or of a new tab, as the strip draws it. */
export interface ColumnSlot {
  readonly key: string
  readonly position: number
  /**
   * Whether × shows: not on a task's only column, which the task would
   * give back at once (`columnsOf`). A new tab's one column closes the tab.
   */
  readonly closable: boolean
  readonly track: number
}

export type Workspace =
  /** Before the first `prune`: nothing is chosen yet. */
  | { readonly kind: "connecting" }
  /** No task and no new tab: the board, and ＋ (ADR-0122). */
  | { readonly kind: "nothing" }
  | {
      readonly kind: "task"
      readonly task: TaskId
      readonly readOnly: ReadOnly | null
      readonly slots: readonly ColumnSlot[]
    }
  /** A new tab: an empty rail, and its one fresh column. */
  | {
      readonly kind: "new"
      readonly key: string
      readonly slots: readonly ColumnSlot[]
    }

/** Facts `App` already holds; nothing here is projected again. */
export interface AppViewInput {
  readonly active: Here | null
  /** The tab's columns: `columnsOf`, or the new tab's one. */
  readonly columns: readonly Column[]
  /** `branchColors(rail, views).track`, memoised by `App`. */
  readonly tracks: readonly number[]
  /** The tasks in the archive (ADR-0122). */
  readonly archived: ReadonlyMap<TaskId, ArchivedTask>
  readonly workflow: Workflow | null
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly offers: ReadonlyMap<ThreadId, OfferRecord>
  /** The lanes of the roots this tab holds. */
  readonly lanes: readonly LaneView[]
  /** Every lane's root entry (`laneRootsOf`), held or not. */
  readonly laneRoots: ReadonlyMap<ThreadId, EntryId>
}

/** Every lane's root entry: its `LaneRecord`'s root, through `rootEntries` (ADR-0063). */
export const laneRootsOf = (
  records: ReadonlyMap<ThreadId, LaneRecord>,
  rootEntries: ReadonlyMap<RootId, EntryId>,
): ReadonlyMap<ThreadId, EntryId> =>
  new Map(
    [...records.values()].flatMap(r => {
      const entry = rootEntries.get(r.root)
      return entry === undefined ? [] : [[r.lane, entry] as const]
    }),
  )

/**
 * The agent's work in each thread, held by this tab or not: each held
 * lane's that is busy (`laneWork`), and every lane running in the session
 * (ADR-0063, ADR-0091), running winning. What refuses a task's move to the
 * archive, and, but for `held`, what rings it in the sidebar and on the
 * board (`threadStatus`).
 */
export function threadWork(input: {
  /** The lanes of the roots this tab holds. */
  readonly lanes: readonly LaneView[]
  /** Lanes running in any root (`readRunningLanes`). */
  readonly running: readonly { readonly lane: ThreadId }[]
}): ReadonlyMap<ThreadId, RootWork> {
  const work = new Map<ThreadId, RootWork>()
  for (const lane of input.lanes)
    if (isBusy(lane)) work.set(lane.name, laneWork(lane))
  for (const { lane } of input.running) work.set(lane, "running")
  return work
}

/**
 * Each task's work (ADR-0116): the most among its threads', running over
 * waiting over held. A thread in no task counts for none.
 */
export function taskWork(
  threads: ReadonlyMap<ThreadId, RootWork>,
  taskOfThread: ReadonlyMap<ThreadId, TaskId>,
): ReadonlyMap<TaskId, RootWork> {
  const out = new Map<TaskId, RootWork>()
  for (const [thread, work] of threads) {
    const task = taskOfThread.get(thread)
    if (task === undefined) continue
    const was = out.get(task)
    if (was === undefined || WORK_ORDER.indexOf(work) > WORK_ORDER.indexOf(was))
      out.set(task, work)
  }
  return out
}

/** Least first: `taskWork` keeps the most. */
const WORK_ORDER: readonly RootWork[] = ["held", "waiting", "running"]

/**
 * An open offer (`offerStatus`), for your inbox and the board's ⇡ (ADR-0091):
 * its lane, its root entry, and where it opens: its lane's tip, or its root
 * entry in a root this tab does not hold.
 */
export interface OpenOffer {
  readonly lane: ThreadId
  readonly root: EntryId
  readonly end: EntryId
  /**
   * The lane tip it holds (`ledger.source`): "not needed" holds until new
   * work moves it (ADR-0077). Null for an offer whose message carries none.
   */
  readonly source: string | null
}

export function appView(input: AppViewInput): {
  readonly workspace: Workspace
  /** Open offers whose lane has a tip, for your inbox and the board. */
  readonly offers: readonly OpenOffer[]
} {
  return { workspace: workspaceOf(input), offers: openOffers(input) }
}

function workspaceOf(input: AppViewInput): Workspace {
  const { active, columns, tracks } = input
  if (active === null) return { kind: "connecting" }
  const slots = (closable: boolean): readonly ColumnSlot[] =>
    columns.map((c, position) => ({
      key: c.key,
      position,
      closable,
      track: tracks[position] ?? PENDING_TRACK,
    }))
  switch (active.kind) {
    case "nothing":
      return { kind: "nothing" }
    case "new":
      return { kind: "new", key: active.key, slots: slots(true) }
    case "task": {
      const archived = input.archived.get(active.task)
      return {
        kind: "task",
        task: active.task,
        readOnly:
          archived === undefined
            ? null
            : readOnlyWords(archived, input.workflow, input.nameOf),
        slots: slots(columns.length > 1),
      }
    }
  }
}

/**
 * The offers with work to add (`offerStatus`'s `open`; not one accepted, nor
 * one accepted work already holds), each in a root with an entry. A lane this
 * tab holds opens at its tip, and one with none yet is left out; any other
 * lane opens at its root entry (ADR-0063).
 */
const openOffers = (input: AppViewInput): readonly OpenOffer[] =>
  [...input.offers.values()].flatMap(o => {
    const root = input.laneRoots.get(o.lane)
    if (offerStatus(o).kind !== "open" || root === undefined) return []
    const source = o.ledger?.source ?? null
    const held = input.lanes.find(l => l.name === o.lane)
    if (held === undefined) return [{ lane: o.lane, root, end: root, source }]
    return held.tip === null
      ? []
      : [{ lane: o.lane, root, end: held.tip, source }]
  })

/**
 * The rows the rail draws: the task you are on's root's only (`entry`, its
 * first root's root entry), and none off a task.
 */
export const hereRail = (
  index: TreeIndex,
  active: Here | null,
  entry: EntryId | null,
): readonly RailRow[] =>
  active?.kind === "task" && entry !== null ? projectRail(index, entry) : []

/**
 * What an archived task's column says and offers (ADR-0122): who moved it to
 * the archive, and Restore, which moves it to the first open state.
 */
export function readOnlyWords(
  archived: ArchivedTask,
  workflow: Workflow | null,
  nameOf: ReadonlyMap<WriterId, string>,
): ReadOnly {
  const to = workflow?.open[0]
  return {
    label: `archived by ${displayName(archived.by, nameOf.get(archived.by))}`,
    action:
      workflow === null || to === undefined
        ? null
        : {
            title: "Restore",
            intent: {
              kind: "moveTask",
              task: archived.task,
              from: workflow.archive.id,
              to: to.id,
              before: null,
              closes: false,
            },
          },
  }
}
