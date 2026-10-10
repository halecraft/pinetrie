// board — the team's workflow and each task's card on the board (ADR-0122,
// ADR-0116, ADR-0126).
//
// The workflow is one host-written singleton: the open states in order, then
// the archive, which is always there and always last. A task is a card
// (`KINDS.task`), its id its `TaskId`, placed on the board in a state at a
// rank there: the places document is the one record of where it is, and its
// card's history says who moved it there and when. A task in the archive is
// archived (ADR-0029); `archive.ts` decides what crossing that state's edge
// does.
//
// The board is total: a task's card in a state the workflow no longer holds
// is read at the end of the first open state, so a stale place never hides
// a task.

import {
  type ArchivedTask,
  type CardHistoryRecord,
  type CardId,
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  ERR,
  hasPlaceKind,
  isWorkflowStateId,
  type PlaceRefusal,
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
import { byOrder } from "./card.ts"
import { decodeAt, fixedKey } from "./decode.ts"
import type { PlaceStep } from "./moves.ts"
import { orderAfter } from "./order.ts"
import { rankAfter } from "./rank.ts"
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
 * (ADR-0122). Nothing else writes the first workflow, and no task is
 * opened before there is one (`planThreadOpen`). Pure.
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

/** A task's card on the board. */
export type BoardCard = CardInPlace<"board">

/** Whether `c` is a task's card on the board. */
export const isBoardCard = (c: CardRecord): c is BoardCard =>
  hasPlaceKind(c, "board")

/**
 * The tasks on the board: each task whose card is there, not in a trash
 * (ADR-0126). The set of tasks the session holds. Pure.
 */
export const boardTasks = (cards: readonly CardRecord[]): ReadonlySet<TaskId> =>
  new Set(cards.filter(isBoardCard).map(c => c.id))

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

/** The state a card on the board is read in: its own, or the first open state's when the workflow lacks it. */
const effectiveState = (w: Workflow, card: BoardCard): WorkflowStateId =>
  stateIn(w, card.place.state) !== undefined
    ? card.place.state
    : (w.open[0]?.id ?? w.archive.id)

/** Each state's cards, in order: by rank, then by id; a stale state's after them at the end of the first open state. */
function columnsOf(
  workflow: Workflow,
  cards: readonly CardRecord[],
): ReadonlyMap<WorkflowStateId, readonly BoardCard[]> {
  const placed = cards.filter(isBoardCard)
  const fits = (c: BoardCard) => stateIn(workflow, c.place.state) !== undefined
  const byState = new Map<WorkflowStateId, BoardCard[]>()
  for (const c of [
    ...placed.filter(fits).sort(byOrder),
    ...placed.filter(c => !fits(c)).sort(byOrder),
  ]) {
    const state = effectiveState(workflow, c)
    byState.set(state, [...(byState.get(state) ?? []), c])
  }
  return byState
}

/**
 * Every task's card on the board, in its state by rank, then by id; one in
 * a state the workflow lacks after them at the end of the first open state.
 * Pure.
 */
export function boardOf(
  workflow: Workflow,
  cards: readonly CardRecord[],
): Board {
  const columns = columnsOf(workflow, cards)
  const stateOf = new Map<TaskId, WorkflowStateId>()
  for (const [state, list] of columns)
    for (const c of list) stateOf.set(c.id, state)
  const column = (state: WorkflowState): BoardColumn => ({
    state,
    tasks: (columns.get(state.id) ?? []).map(c => c.id),
  })
  return {
    open: workflow.open.map(column),
    archive: column(workflow.archive),
    stateOf,
  }
}

/**
 * The tasks in the archive: archived (ADR-0029), by whom and when: the
 * newest event of its card's history that put it in the archive, which a
 * history always keeps (`HISTORY_EVENTS`); its placer at 0 for a card with
 * none. Pure.
 */
export function archivedOf(
  workflow: Workflow,
  cards: readonly CardRecord[],
  histories: ReadonlyMap<CardId, CardHistoryRecord>,
): ReadonlyMap<TaskId, ArchivedTask> {
  const archive = workflow.archive.id
  const out = new Map<TaskId, ArchivedTask>()
  for (const c of cards) {
    if (!isBoardCard(c) || c.place.state !== archive) continue
    const into = histories
      .get(c.id)
      ?.events.findLast(e => e.to.kind === "board" && e.to.state === archive)
    out.set(c.id, {
      task: c.id,
      by: into?.by ?? c.placer,
      at: into?.at ?? 0,
    })
  }
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
export type BoardMove =
  | {
      readonly kind: "refused"
      readonly code: PlaceRefusal
      /** The card as it is, or null when it is gone. */
      readonly now: CardRecord | null
    }
  /** Already there: nothing is written. */
  | { readonly kind: "unchanged" }
  /**
   * Its card's writes: within its state, a reorder, which changes no key
   * and so enters no history; between states, a move, with whether it
   * crosses the archive's edge. Either way the cards re-ranked to make room
   * follow it.
   */
  | {
      readonly kind: "reorder" | "move"
      readonly steps: readonly PlaceStep[]
      readonly transition: Transition
    }

/**
 * Decide a move of a task's card on the board (ADR-0122, ADR-0126). The
 * sender names the state it saw the task in; if the task has left it, the
 * move is refused `moved`, the card as it is saying who moved it where.
 * `before` is the task it goes before in `to`, null (or a task no longer
 * there) for its end. Within one state it is a reorder: its rank alone
 * changes, its placer stays. Between states its sender is its placer. A
 * card with no room between its neighbours renumbers the fewest of them
 * (`rankAfter`). Refused `gone` for a task with no card on the board, and
 * `no-place` for a state the workflow lacks. Pure.
 */
export function planBoardMove(input: {
  readonly task: TaskId
  readonly from: WorkflowStateId
  readonly to: WorkflowStateId
  readonly before: TaskId | null
  readonly sender: WriterId
  readonly workflow: Workflow
  readonly cards: readonly CardRecord[]
}): BoardMove {
  const { workflow, cards, task, to } = input
  const now = cards.find(c => c.id === task)
  if (now === undefined || !isBoardCard(now))
    return { kind: "refused", code: "gone", now: now ?? null }
  if (stateIn(workflow, to) === undefined)
    return { kind: "refused", code: "no-place", now }
  const at = effectiveState(workflow, now)
  if (at !== input.from) return { kind: "refused", code: "moved", now }
  const column = columnsOf(workflow, cards).get(to) ?? []
  const others = column.filter(c => c.id !== task)
  const before = others.findIndex(c => c.id === input.before)
  const index = input.before === null || before < 0 ? others.length : before
  // A card in a stale state is drawn in `to` but stored elsewhere: its
  // state is written, so it moves.
  const within = now.place.state === to
  if (within && column[index]?.id === task) return { kind: "unchanged" }
  const { order, respaced } = rankAfter(others, index - 1)
  const place: CardPlace = { kind: "board", state: to, order }
  return {
    kind: within ? "reorder" : "move",
    transition: transitionOf(workflow, at, to),
    steps: [
      {
        kind: "write",
        record: { ...now, place, placer: within ? now.placer : input.sender },
      },
      ...respaced.map((record): PlaceStep => ({ kind: "write", record })),
    ],
  }
}

/**
 * A new task's place on the board: the end of `state`, or of the first open
 * state for none or one that is no open state. Pure.
 */
export function boardEnd(
  workflow: Workflow,
  cards: readonly CardRecord[],
  state: WorkflowStateId | null,
): Extract<CardPlace, { readonly kind: "board" }> {
  const open = workflow.open.find(s => s.id === state)
  const at = open?.id ?? workflow.open[0]?.id ?? workflow.archive.id
  return {
    kind: "board",
    state: at,
    order: orderAfter(columnsOf(workflow, cards).get(at) ?? []),
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
