// board — the session's workflow and each root's place on the board
// (ADR-0122).
//
// The workflow is one host-written singleton: the open states in order, then
// the closed state, which is always there and always last. A root's place is
// a host-written value keyed by its `RootId`: its state and its rank there.
// A root in the closed state is archived (ADR-0029); `archive.ts` decides
// what crossing that state's edge does.
//
// The board is total: a root with no place, or a place in a state the
// workflow no longer holds, is read at the end of the first open state, so a
// missing or stale record never hides a root.

import {
  type ArchivedRoot,
  type BoardPlace,
  ERR,
  isWorkflowStateId,
  type Refusal,
  type RootId,
  refused,
  type ValueWrite,
  type Workflow,
  type WorkflowEdit,
  type WorkflowState,
  type WorkflowStateId,
  type WriterId,
  workflowStateIdFor,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, fixedKey, rootKey } from "./decode.ts"
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
  closed: StateSchema,
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
    closed: { ...w.closed },
  }),
  decode: (contents, key) =>
    decodeAt(WorkflowSchema, contents, fixedKey(WORKFLOW_KEY, key), w => {
      const open = w.open.map(stateOf)
      const closed = stateOf(w.closed)
      if (closed === undefined || open.some(s => s === undefined))
        return undefined
      return { open: open.filter(s => s !== undefined), closed }
    }),
}

const PlaceSchema = Type.Object({
  state: Type.String({ minLength: 1 }),
  rank: Type.String(),
  by: Type.String(),
  at: Type.Number(),
})

/** Each root's place on the board, at its `RootId`. */
export const BOARD: RecordSpec<BoardPlace, RootId, "session"> = {
  namespace: "pinetrie.board",
  home: "session",
  keyOf: p => p.root,
  encode: ({ root, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(PlaceSchema, contents, rootKey(key), (p, root) =>
      isWorkflowStateId(p.state)
        ? { root, state: p.state, rank: p.rank, by: p.by as WriterId, at: p.at }
        : undefined,
    ),
}

/** A new session's workflow: Backlog and Doing, then Done, closed. */
export const defaultWorkflow = (newId: () => string): Workflow => ({
  open: [
    { id: workflowStateIdFor(newId()), name: "Backlog" },
    { id: workflowStateIdFor(newId()), name: "Doing" },
  ],
  closed: { id: workflowStateIdFor(newId()), name: "Done" },
})

/**
 * A store with no workflow gets the default one: a new store's first start
 * (ADR-0122). Nothing else writes the first workflow, and a root started
 * before there is one gets no place. Pure.
 */
export const planWorkflowSeed = (
  workflow: Workflow | null,
  newId: () => string,
): readonly ValueWrite[] =>
  workflow === null ? [setRecord(WORKFLOW, defaultWorkflow(newId))] : []

/** Every state, open then closed: the board's columns. */
export const statesOf = (w: Workflow): readonly WorkflowState[] => [
  ...w.open,
  w.closed,
]

/** The state `id` names, or undefined. */
export const stateIn = (
  w: Workflow,
  id: WorkflowStateId,
): WorkflowState | undefined => statesOf(w).find(s => s.id === id)

/** A column of the board: a state and its roots, in order. */
export interface BoardColumn {
  readonly state: WorkflowState
  readonly roots: readonly RootId[]
}

/** Every root in its state, in order. */
export interface Board {
  readonly open: readonly BoardColumn[]
  readonly closed: BoardColumn
  /** Each root's state. */
  readonly stateOf: ReadonlyMap<RootId, WorkflowStateId>
}

/** The place a root has, or the end of the first open state's. */
const effectiveState = (
  w: Workflow,
  place: BoardPlace | undefined,
): WorkflowStateId =>
  place !== undefined && stateIn(w, place.state) !== undefined
    ? place.state
    : (w.open[0]?.id ?? w.closed.id)

/**
 * Every root in `roots` on the board: in its place's state, by rank, then by
 * id; a root with no place, or one in a state the workflow lacks, after them
 * at the end of the first open state. Pure.
 */
export function boardOf(
  workflow: Workflow,
  places: ReadonlyMap<RootId, BoardPlace>,
  roots: Iterable<RootId>,
): Board {
  const byState = new Map<WorkflowStateId, RootId[]>()
  const stateOfRoot = new Map<RootId, WorkflowStateId>()
  for (const root of roots) {
    const state = effectiveState(workflow, placed(workflow, places, root))
    stateOfRoot.set(root, state)
    const list = byState.get(state) ?? []
    list.push(root)
    byState.set(state, list)
  }
  const column = (state: WorkflowState): BoardColumn => ({
    state,
    roots: (byState.get(state.id) ?? []).toSorted((a, b) =>
      compareRoots(
        placed(workflow, places, a),
        placed(workflow, places, b),
        a,
        b,
      ),
    ),
  })
  return {
    open: workflow.open.map(column),
    closed: column(workflow.closed),
    stateOf: stateOfRoot,
  }
}

/** A root's place when its state is the workflow's; else none. */
const placed = (
  w: Workflow,
  places: ReadonlyMap<RootId, BoardPlace>,
  root: RootId,
): BoardPlace | undefined => {
  const p = places.get(root)
  return p !== undefined && stateIn(w, p.state) !== undefined ? p : undefined
}

/** Placed roots by rank, then the unplaced ones; each tie by id. */
const compareRoots = (
  pa: BoardPlace | undefined,
  pb: BoardPlace | undefined,
  a: RootId,
  b: RootId,
): number => {
  if (pa !== undefined && pb === undefined) return -1
  if (pa === undefined && pb !== undefined) return 1
  const ra = pa?.rank ?? ""
  const rb = pb?.rank ?? ""
  if (ra !== rb) return ra < rb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** The roots in the closed state: archived (ADR-0029). Pure. */
export function archivedOf(
  workflow: Workflow,
  places: ReadonlyMap<RootId, BoardPlace>,
): ReadonlyMap<RootId, ArchivedRoot> {
  const out = new Map<RootId, ArchivedRoot>()
  for (const p of places.values())
    if (p.state === workflow.closed.id)
      out.set(p.root, { root: p.root, by: p.by, at: p.at })
  return out
}

/** Whether a move crosses the closed state's edge: what the host must gather. */
export type Transition = "within" | "close" | "reopen"

export function transitionOf(
  workflow: Workflow,
  from: WorkflowStateId,
  to: WorkflowStateId,
): Transition {
  const closed = workflow.closed.id
  if (from !== closed && to === closed) return "close"
  if (from === closed && to !== closed) return "reopen"
  return "within"
}

/** A root moved on the board, as the host plans it. */
export type RootMovePlan =
  | Refusal
  /** Already there: nothing is written, and the answer is the same. */
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "write"
      /** The moved root's place, and any of its new state's renumbered. */
      readonly places: readonly BoardPlace[]
      readonly transition: Transition
    }

/**
 * Decide a move of a root on the board, over the board alone. The sender
 * names the state it saw the root in; if the root has left it, the move is
 * refused, naming who moved it and where. `before` is the root it goes
 * before in `to`, null (or a root no longer there) for its end. A root moved
 * within the closed state keeps who archived it and when. Pure.
 */
export function planRootMove(input: {
  readonly root: RootId
  readonly from: WorkflowStateId
  readonly to: WorkflowStateId
  readonly before: RootId | null
  readonly by: WriterId
  readonly now: number
  readonly workflow: Workflow
  readonly places: ReadonlyMap<RootId, BoardPlace>
  /** Every root the board shows (`boardOf`'s `roots`). */
  readonly roots: readonly RootId[]
  readonly names: ReadonlyMap<WriterId, string>
}): RootMovePlan {
  const { workflow, places, root, to } = input
  const target = stateIn(workflow, to)
  if (target === undefined)
    return refused(ERR.UNKNOWN_STATE, "that workflow state is gone")
  if (!input.roots.includes(root))
    return refused(ERR.UNKNOWN_TARGET, "no such root")
  const board = boardOf(workflow, places, input.roots)
  const now = board.stateOf.get(root) ?? workflow.closed.id
  if (now !== input.from) {
    const where = stateIn(workflow, now)?.name ?? ""
    const mover = places.get(root)?.by
    return refused(
      ERR.ROOT_MOVED,
      mover === undefined
        ? `not moved: it is in ${where} now`
        : `not moved: ${displayName(mover, input.names.get(mover))} moved it to ${where} first`,
    )
  }
  const column =
    [...board.open, board.closed].find(c => c.state.id === to)?.roots ?? []
  const others = column.filter(r => r !== root)
  const at =
    input.before === null || !others.includes(input.before)
      ? others.length
      : others.indexOf(input.before)
  const order = [...others.slice(0, at), root, ...others.slice(at)]
  if (now === to && order.every((r, i) => column[i] === r))
    return { kind: "unchanged" }

  const was = places.get(root)
  const keep = now === workflow.closed.id && to === workflow.closed.id
  const moved = (rank: string): BoardPlace => ({
    root,
    state: to,
    rank,
    by: keep && was !== undefined ? was.by : input.by,
    at: keep && was !== undefined ? was.at : input.now,
  })
  const transition = transitionOf(workflow, input.from, to)
  const rankOf = (r: RootId | undefined) =>
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
      if (r === root) return moved(rank)
      const p = places.get(r)
      return p !== undefined && p.state === to
        ? { ...p, rank }
        : { root: r, state: to, rank, by: input.by, at: input.now }
    }),
  }
}

/** A new root's place: the end of `state`, or of the first open state. Pure. */
export function placeStarted(input: {
  readonly root: RootId
  readonly state: WorkflowStateId | null
  readonly by: WriterId
  readonly now: number
  readonly workflow: Workflow
  readonly places: ReadonlyMap<RootId, BoardPlace>
}): BoardPlace {
  const { workflow } = input
  const open = workflow.open.find(s => s.id === input.state)
  const state = open?.id ?? workflow.open[0]?.id ?? workflow.closed.id
  const ranks = [...input.places.values()]
    .filter(p => p.state === state)
    .map(p => p.rank)
  return {
    root: input.root,
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
 * closed state is renamed, never moved or removed; a state holding a root is
 * not removed, nor the only open state. Pure.
 */
export function planWorkflowEdit(
  workflow: Workflow,
  board: Board,
  edit: WorkflowEdit,
  newId: () => string,
): WorkflowPlan {
  const name = edit.name.trim()
  const { open, closed } = workflow
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
    sameState(next.closed, closed)
      ? { kind: "unchanged" }
      : { kind: "write", workflow: next }

  if (edit.action === "add") {
    if (name === "") return refused(ERR.EMPTY_NAME, "a state needs a name")
    return write({
      open: place(open, { id: workflowStateIdFor(newId()), name }),
      closed,
    })
  }
  const target = edit.state === null ? undefined : stateIn(workflow, edit.state)
  if (target === undefined)
    return refused(ERR.UNKNOWN_STATE, "that workflow state is gone")
  const isClosed = target.id === closed.id
  switch (edit.action) {
    case "rename":
      if (name === "") return refused(ERR.EMPTY_NAME, "a state needs a name")
      return write(
        isClosed
          ? { open, closed: { ...closed, name } }
          : {
              open: open.map(s => (s.id === target.id ? { ...s, name } : s)),
              closed,
            },
      )
    case "move":
      if (isClosed)
        return refused(ERR.STATE_CLOSED, `${closed.name} is always last`)
      if (edit.before === target.id) return { kind: "unchanged" }
      return write({
        open: place(
          open.filter(s => s.id !== target.id),
          target,
        ),
        closed,
      })
    case "remove": {
      if (isClosed)
        return refused(ERR.STATE_CLOSED, `${closed.name} cannot be removed`)
      const held =
        board.open.find(c => c.state.id === target.id)?.roots.length ?? 0
      if (held > 0)
        return refused(
          ERR.STATE_NOT_EMPTY,
          `${target.name} holds ${held === 1 ? "a root" : `${held} roots`}: move ${held === 1 ? "it" : "them"} first`,
        )
      if (open.length === 1)
        return refused(ERR.LAST_STATE, "the board needs one open state")
      return write({ open: open.filter(s => s.id !== target.id), closed })
    }
  }
}

const sameState = (a: WorkflowState, b: WorkflowState | undefined): boolean =>
  b !== undefined && a.id === b.id && a.name === b.name
