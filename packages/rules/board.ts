// board — the session's workflow and each task's place on the board
// (ADR-0122, ADR-0116).
//
// The workflow is one host-written singleton: the open states in order, then
// the archive, which is always there and always last. A task's place is
// a host-written value keyed by its `TaskId`: its state and its rank there.
// A task in the archive is archived (ADR-0029); `archive.ts` decides
// what crossing that state's edge does.
//
// The board is total: a task with no place, or a place in a state the
// workflow no longer holds, is read at the end of the first open state, so a
// missing or stale record never hides a task.

import {
  type ArchivedTask,
  type BoardPlace,
  ERR,
  isWorkflowStateId,
  type Refusal,
  refused,
  type TaskId,
  type ValueWrite,
  type Workflow,
  type WorkflowEdit,
  type WorkflowState,
  type WorkflowStateId,
  type WriterId,
  workflowStateIdFor,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, fixedKey, taskKey } from "./decode.ts"
import { keyAfter, orderBetween, orderKeys } from "./order.ts"
import { displayName } from "./participant.ts"
import { type RecordSpec, setRecord } from "./records.ts"

export const WORKFLOW_KEY = "workflow"

const StateSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
})

const WorkflowSchema = Type.Object({
  open: Type.Array(StateSchema, { minItems: 1 }),
  archive: StateSchema,
})

const stateOf = (s: { id: string; name: string }): WorkflowState | undefined =>
  isWorkflowStateId(s.id) ? { id: s.id, name: s.name } : undefined

/** The session's workflow: one value, at `WORKFLOW_KEY`. */
export const WORKFLOW: RecordSpec<Workflow, typeof WORKFLOW_KEY, "session"> = {
  namespace: "pinetrie.workflow",
  home: "session",
  keyOf: () => WORKFLOW_KEY,
  encode: w => ({
    open: w.open.map(s => ({ ...s })),
    archive: { ...w.archive },
  }),
  decode: (contents, key) =>
    decodeAt(WorkflowSchema, contents, fixedKey(WORKFLOW_KEY, key), w => {
      const open = w.open.map(stateOf)
      const archive = stateOf(w.archive)
      if (archive === undefined || open.some(s => s === undefined))
        return undefined
      return { open: open.filter(s => s !== undefined), archive }
    }),
}

const PlaceSchema = Type.Object({
  state: Type.String({ minLength: 1 }),
  rank: Type.String(),
  by: Type.String(),
  at: Type.Number(),
})

/** Each task's place on the board, at its `TaskId`. */
export const BOARD: RecordSpec<BoardPlace, TaskId, "session"> = {
  namespace: "pinetrie.board",
  home: "session",
  keyOf: p => p.task,
  encode: ({ task, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(PlaceSchema, contents, taskKey(key), (p, task) =>
      isWorkflowStateId(p.state)
        ? { task, state: p.state, rank: p.rank, by: p.by as WriterId, at: p.at }
        : undefined,
    ),
}

/** A new session's workflow: Backlog and Doing, then Done, the archive. */
export const defaultWorkflow = (newId: () => string): Workflow => ({
  open: [
    { id: workflowStateIdFor(newId()), name: "Backlog" },
    { id: workflowStateIdFor(newId()), name: "Doing" },
  ],
  archive: { id: workflowStateIdFor(newId()), name: "Done" },
})

/**
 * A store with no workflow gets the default one: a new store's first start
 * (ADR-0122). Nothing else writes the first workflow, and a task started
 * before there is one gets no place. Pure.
 */
export const planWorkflowSeed = (
  workflow: Workflow | null,
  newId: () => string,
): readonly ValueWrite[] =>
  workflow === null ? [setRecord(WORKFLOW, defaultWorkflow(newId))] : []

/** Every state, open then the archive: the board's columns. */
export const statesOf = (w: Workflow): readonly WorkflowState[] => [
  ...w.open,
  w.archive,
]

/** The state `id` names, or undefined. */
export const stateIn = (
  w: Workflow,
  id: WorkflowStateId,
): WorkflowState | undefined => statesOf(w).find(s => s.id === id)

/** A column of the board: a state and its tasks, in order. */
export interface BoardColumn {
  readonly state: WorkflowState
  readonly tasks: readonly TaskId[]
}

/** Every task in its state, in order. */
export interface Board {
  readonly open: readonly BoardColumn[]
  readonly archive: BoardColumn
  /** Each task's state. */
  readonly stateOf: ReadonlyMap<TaskId, WorkflowStateId>
}

/** The place a task has, or the end of the first open state's. */
const effectiveState = (
  w: Workflow,
  place: BoardPlace | undefined,
): WorkflowStateId =>
  place !== undefined && stateIn(w, place.state) !== undefined
    ? place.state
    : (w.open[0]?.id ?? w.archive.id)

/**
 * Every task in `tasks` on the board: in its place's state, by rank, then by
 * id; a task with no place, or one in a state the workflow lacks, after them
 * at the end of the first open state. Pure.
 */
export function boardOf(
  workflow: Workflow,
  places: ReadonlyMap<TaskId, BoardPlace>,
  tasks: Iterable<TaskId>,
): Board {
  const byState = new Map<WorkflowStateId, TaskId[]>()
  const stateOfTask = new Map<TaskId, WorkflowStateId>()
  for (const task of tasks) {
    const state = effectiveState(workflow, placed(workflow, places, task))
    stateOfTask.set(task, state)
    const list = byState.get(state) ?? []
    list.push(task)
    byState.set(state, list)
  }
  const column = (state: WorkflowState): BoardColumn => ({
    state,
    tasks: (byState.get(state.id) ?? []).toSorted((a, b) =>
      compareTasks(
        placed(workflow, places, a),
        placed(workflow, places, b),
        a,
        b,
      ),
    ),
  })
  return {
    open: workflow.open.map(column),
    archive: column(workflow.archive),
    stateOf: stateOfTask,
  }
}

/** A task's place when its state is the workflow's; else none. */
const placed = (
  w: Workflow,
  places: ReadonlyMap<TaskId, BoardPlace>,
  task: TaskId,
): BoardPlace | undefined => {
  const p = places.get(task)
  return p !== undefined && stateIn(w, p.state) !== undefined ? p : undefined
}

/** Placed tasks by rank, then the unplaced ones; each tie by id. */
const compareTasks = (
  pa: BoardPlace | undefined,
  pb: BoardPlace | undefined,
  a: TaskId,
  b: TaskId,
): number => {
  if (pa !== undefined && pb === undefined) return -1
  if (pa === undefined && pb !== undefined) return 1
  const ra = pa?.rank ?? ""
  const rb = pb?.rank ?? ""
  if (ra !== rb) return ra < rb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** The tasks in the archive: archived (ADR-0029). Pure. */
export function archivedOf(
  workflow: Workflow,
  places: ReadonlyMap<TaskId, BoardPlace>,
): ReadonlyMap<TaskId, ArchivedTask> {
  const out = new Map<TaskId, ArchivedTask>()
  for (const p of places.values())
    if (p.state === workflow.archive.id)
      out.set(p.task, { task: p.task, by: p.by, at: p.at })
  return out
}

/** Whether a move crosses the archive's edge: what the host must gather. */
export type Transition = "within" | "archive" | "restore"

export function transitionOf(
  workflow: Workflow,
  from: WorkflowStateId,
  to: WorkflowStateId,
): Transition {
  const archive = workflow.archive.id
  if (from !== archive && to === archive) return "archive"
  if (from === archive && to !== archive) return "restore"
  return "within"
}

/** A task moved on the board, as the host plans it. */
export type TaskMovePlan =
  | Refusal
  /** Already there: nothing is written, and the answer is the same. */
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "write"
      /** The moved task's place, and any of its new state's renumbered. */
      readonly places: readonly BoardPlace[]
      readonly transition: Transition
    }

/**
 * Decide a move of a task on the board, over the board alone. The sender
 * names the state it saw the task in; if the task has left it, the move is
 * refused, naming who moved it and where. `before` is the task it goes
 * before in `to`, null (or a task no longer there) for its end. A task moved
 * within the archive keeps who archived it and when. Pure.
 */
export function planTaskMove(input: {
  readonly task: TaskId
  readonly from: WorkflowStateId
  readonly to: WorkflowStateId
  readonly before: TaskId | null
  readonly by: WriterId
  readonly now: number
  readonly workflow: Workflow
  readonly places: ReadonlyMap<TaskId, BoardPlace>
  /** Every task the board shows (`boardOf`'s `tasks`). */
  readonly tasks: readonly TaskId[]
  readonly names: ReadonlyMap<WriterId, string>
}): TaskMovePlan {
  const { workflow, places, task, to } = input
  const target = stateIn(workflow, to)
  if (target === undefined)
    return refused(ERR.UNKNOWN_STATE, "that workflow state is gone")
  if (!input.tasks.includes(task))
    return refused(ERR.UNKNOWN_TARGET, "no such task")
  const board = boardOf(workflow, places, input.tasks)
  const now = board.stateOf.get(task) ?? workflow.archive.id
  if (now !== input.from) {
    const where = stateIn(workflow, now)?.name ?? ""
    const mover = places.get(task)?.by
    return refused(
      ERR.TASK_MOVED,
      mover === undefined
        ? `not moved: it is in ${where} now`
        : `not moved: ${displayName(mover, input.names.get(mover))} moved it to ${where} first`,
    )
  }
  const column =
    [...board.open, board.archive].find(c => c.state.id === to)?.tasks ?? []
  const others = column.filter(r => r !== task)
  const at =
    input.before === null || !others.includes(input.before)
      ? others.length
      : others.indexOf(input.before)
  const order = [...others.slice(0, at), task, ...others.slice(at)]
  if (now === to && order.every((r, i) => column[i] === r))
    return { kind: "unchanged" }

  const was = places.get(task)
  const keep = now === workflow.archive.id && to === workflow.archive.id
  const moved = (rank: string): BoardPlace => ({
    task,
    state: to,
    rank,
    by: keep && was !== undefined ? was.by : input.by,
    at: keep && was !== undefined ? was.at : input.now,
  })
  const transition = transitionOf(workflow, input.from, to)
  const rankOf = (r: TaskId | undefined) =>
    r === undefined ? null : (placed(workflow, places, r)?.rank ?? undefined)
  const low = rankOf(order[at - 1])
  const high = rankOf(order[at + 1])
  const between =
    low === undefined || high === undefined ? null : orderBetween(low, high)
  if (between !== null)
    return { kind: "write", places: [moved(between)], transition }
  // No room, or a neighbour with no place yet: the whole state renumbered.
  const keys = orderKeys(order.length)
  return {
    kind: "write",
    transition,
    places: order.map((r, i) => {
      const rank = keys[i] ?? ""
      if (r === task) return moved(rank)
      const p = places.get(r)
      return p !== undefined && p.state === to
        ? { ...p, rank }
        : { task: r, state: to, rank, by: input.by, at: input.now }
    }),
  }
}

/** A new task's place: the end of `state`, or of the first open state. Pure. */
export function placeStarted(input: {
  readonly task: TaskId
  readonly state: WorkflowStateId | null
  readonly by: WriterId
  readonly now: number
  readonly workflow: Workflow
  readonly places: ReadonlyMap<TaskId, BoardPlace>
}): BoardPlace {
  const { workflow } = input
  const open = workflow.open.find(s => s.id === input.state)
  const state = open?.id ?? workflow.open[0]?.id ?? workflow.archive.id
  const ranks = [...input.places.values()]
    .filter(p => p.state === state)
    .map(p => p.rank)
  return {
    task: input.task,
    state,
    rank: keyAfter(ranks),
    by: input.by,
    at: input.now,
  }
}

/** A change to the workflow, as the host plans it. */
export type WorkflowPlan =
  | Refusal
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly workflow: Workflow }

/**
 * Decide a change to the workflow. Names are trimmed and may repeat. The
 * archive is renamed, never moved or removed; a state holding a task is
 * not removed, nor the only open state. Pure.
 */
export function planWorkflowEdit(
  workflow: Workflow,
  board: Board,
  edit: WorkflowEdit,
  newId: () => string,
): WorkflowPlan {
  const name = edit.name.trim()
  const { open, archive } = workflow
  const place = (
    states: readonly WorkflowState[],
    s: WorkflowState,
  ): readonly WorkflowState[] => {
    const at = states.findIndex(x => x.id === edit.before)
    return at < 0
      ? [...states, s]
      : [...states.slice(0, at), s, ...states.slice(at)]
  }
  const write = (next: Workflow): WorkflowPlan =>
    next.open.length === open.length &&
    next.open.every((s, i) => sameState(s, open[i])) &&
    sameState(next.archive, archive)
      ? { kind: "unchanged" }
      : { kind: "write", workflow: next }

  if (edit.action === "add") {
    if (name === "") return refused(ERR.EMPTY_NAME, "a state needs a name")
    return write({
      open: place(open, { id: workflowStateIdFor(newId()), name }),
      archive,
    })
  }
  const target = edit.state === null ? undefined : stateIn(workflow, edit.state)
  if (target === undefined)
    return refused(ERR.UNKNOWN_STATE, "that workflow state is gone")
  const isArchive = target.id === archive.id
  switch (edit.action) {
    case "rename":
      if (name === "") return refused(ERR.EMPTY_NAME, "a state needs a name")
      return write(
        isArchive
          ? { open, archive: { ...archive, name } }
          : {
              open: open.map(s => (s.id === target.id ? { ...s, name } : s)),
              archive,
            },
      )
    case "move":
      if (isArchive)
        return refused(ERR.STATE_ARCHIVE, `${archive.name} is always last`)
      if (edit.before === target.id) return { kind: "unchanged" }
      return write({
        open: place(
          open.filter(s => s.id !== target.id),
          target,
        ),
        archive,
      })
    case "remove": {
      if (isArchive)
        return refused(ERR.STATE_ARCHIVE, `${archive.name} cannot be removed`)
      const held =
        board.open.find(c => c.state.id === target.id)?.tasks.length ?? 0
      if (held > 0)
        return refused(
          ERR.STATE_NOT_EMPTY,
          `${target.name} holds ${held === 1 ? "a task" : `${held} tasks`}: move ${held === 1 ? "it" : "them"} first`,
        )
      if (open.length === 1)
        return refused(ERR.LAST_STATE, "the board needs one open state")
      return write({ open: open.filter(s => s.id !== target.id), archive })
    }
  }
}

const sameState = (a: WorkflowState, b: WorkflowState | undefined): boolean =>
  b !== undefined && a.id === b.id && a.name === b.name
