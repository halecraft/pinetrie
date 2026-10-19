// board — the team's workflow and each canvas's card on the board.

import {
  type CanvasId,
  ERR,
  isWorkflowStateId,
  type Refusal,
  refused,
  type ValueWrite,
  type WorkflowStateId,
  type WriterId,
  workflowStateIdFor,
} from "@pinetrie/core"
import {
  type ArchivedCanvas,
  type CardId,
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  hasPlaceKind,
  type PlaceRefusal,
  type WorkflowEdit,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { byOrder } from "./card.ts"
import type { CardHistoryRecord } from "./card-history.ts"
import { decodeRecord, fixedKey } from "./decode.ts"
import { orderAfter } from "./order.ts"
import type { PlaceStep } from "./place-steps.ts"
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

/** A workflow state: a column of the board. */
export interface WorkflowState {
  readonly id: WorkflowStateId
  readonly name: string
}

/**
 * The session's workflow: a host-written `pinetrie.workflow` singleton. The
 * open states in board order, then the archive, which is always there and
 * always last: a root in it is archived.
 */
export interface Workflow {
  readonly open: readonly WorkflowState[]
  readonly archive: WorkflowState
}

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
    decodeRecord(WorkflowSchema, contents, fixedKey(WORKFLOW_KEY, key), w => {
      const open = w.open.map(stateOf)
      const archive = stateOf(w.archive)
      if (archive === undefined || open.some(s => s === undefined))
        return undefined
      return { open: open.filter(s => s !== undefined), archive }
    }),
}

/** A new session's workflow: Topics and Active, then Archive, the archive. */
export const defaultWorkflow = (newId: () => string): Workflow => ({
  open: [
    { id: workflowStateIdFor(newId()), name: "Topics" },
    { id: workflowStateIdFor(newId()), name: "Active" },
  ],
  archive: { id: workflowStateIdFor(newId()), name: "Archive" },
})

/**
 * What a canvas on the board is, by where it is: a topic in the first open
 * state, there for teammates to find; a task in any later open state, its
 * work tracked; archived in the archive. Never stored.
 */
export type CanvasRole = "topic" | "task" | "archived"

/**
 * The role of a canvas in `state`. A state the workflow no longer holds is
 * read as the first open state, as `taskBoard` places its canvases there.
 */
export function canvasRole(w: Workflow, state: WorkflowStateId): CanvasRole {
  if (state === w.archive.id) return "archived"
  const at = w.open.findIndex(s => s.id === state)
  return at > 0 ? "task" : "topic"
}

/**
 * A store with no workflow gets the default one: a new store's first start.
 * Nothing else writes the first workflow, and no canvas is
 * opened before there is one (`planThreadOpen`).
 */
export const planWorkflowSeed = (
  workflow: Workflow | null,
  newId: () => string,
): readonly ValueWrite<"session">[] =>
  workflow === null ? [setRecord(WORKFLOW, defaultWorkflow(newId))] : []

/** Every state, open then the archive: the board's columns. */
const boardStates = (w: Workflow): readonly WorkflowState[] => [
  ...w.open,
  w.archive,
]

/** The state `id` names, or undefined. */
const stateIn = (w: Workflow, id: WorkflowStateId): WorkflowState | undefined =>
  boardStates(w).find(s => s.id === id)

/** A canvas's card on the board. */
type BoardCard = CardInPlace<"board">

/** Whether `c` is a canvas's card on the board. */
export const isBoardCard = (c: CardRecord): c is BoardCard =>
  hasPlaceKind(c, "board")

/**
 * The canvases on the board: each canvas whose card is there, not in a trash.
 * The set of canvases the session holds.
 */
export const boardCanvases = (
  cards: readonly CardRecord[],
): ReadonlySet<CanvasId> => new Set(cards.filter(isBoardCard).map(c => c.id))

/** A column of the board: a state and its canvases, in order. */
interface BoardColumn {
  readonly state: WorkflowState
  readonly canvases: readonly CanvasId[]
}

/** Every canvas in its state, in order. */
interface Board {
  readonly open: readonly BoardColumn[]
  readonly archive: BoardColumn
  /** Each canvas's state. */
  readonly stateOf: ReadonlyMap<CanvasId, WorkflowStateId>
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
 * Every canvas's card on the board, in its state by rank, then by id; one in
 * a state the workflow lacks after them at the end of the first open state.
 */
export function taskBoard(
  workflow: Workflow,
  cards: readonly CardRecord[],
): Board {
  const columns = columnsOf(workflow, cards)
  const stateOf = new Map<CanvasId, WorkflowStateId>()
  for (const [state, list] of columns)
    for (const c of list) stateOf.set(c.id, state)
  const column = (state: WorkflowState): BoardColumn => ({
    state,
    canvases: (columns.get(state.id) ?? []).map(c => c.id),
  })
  return {
    open: workflow.open.map(column),
    archive: column(workflow.archive),
    stateOf,
  }
}

/**
 * The canvases in the archive: archived, by whom and when: the
 * newest event of its card's history that put it in the archive, which a
 * history always keeps (`HISTORY_EVENTS`); its placer at 0 for a card with
 * none.
 */
export function tasksInArchive(
  workflow: Workflow,
  cards: readonly CardRecord[],
  histories: ReadonlyMap<CardId, CardHistoryRecord>,
): ReadonlyMap<CanvasId, ArchivedCanvas> {
  const archive = workflow.archive.id
  const out = new Map<CanvasId, ArchivedCanvas>()
  for (const c of cards) {
    if (!isBoardCard(c) || c.place.state !== archive) continue
    const into = histories
      .get(c.id)
      ?.events.findLast(e => e.to.kind === "board" && e.to.state === archive)
    out.set(c.id, {
      canvas: c.id,
      by: into?.by ?? c.placer,
      at: into?.at ?? 0,
    })
  }
  return out
}

/** Whether a move crosses the archive's edge: what the host must gather. */
type Transition = "within" | "archive" | "restore"

export function stateTransition(
  workflow: Workflow,
  from: WorkflowStateId,
  to: WorkflowStateId,
): Transition {
  const archive = workflow.archive.id
  if (from !== archive && to === archive) return "archive"
  if (from === archive && to !== archive) return "restore"
  return "within"
}

/** A canvas moved on the board, as the host plans it. */
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
 * Decide a move of a canvas's card on the board. The
 * sender names the state it saw the canvas in; if the canvas has left it, the
 * move is refused `moved`, the card as it is saying who moved it where.
 * `before` is the canvas it goes before in `to`, null (or a canvas no longer
 * there) for its end. Within one state it is a reorder: its rank alone
 * changes, its placer stays. Between states its sender is its placer. A
 * card with no room between its neighbours renumbers the fewest of them
 * (`rankAfter`). Refused `gone` for a canvas with no card on the board, and
 * `no-place` for a state the workflow lacks.
 */
export function planBoardMove(input: {
  readonly canvas: CanvasId
  readonly from: WorkflowStateId
  readonly to: WorkflowStateId
  readonly before: CanvasId | null
  readonly sender: WriterId
  readonly workflow: Workflow
  readonly cards: readonly CardRecord[]
}): BoardMove {
  const { workflow, cards, canvas, to } = input
  const now = cards.find(c => c.id === canvas)
  if (now === undefined || !isBoardCard(now))
    return { kind: "refused", code: "gone", now: now ?? null }
  if (stateIn(workflow, to) === undefined)
    return { kind: "refused", code: "no-place", now }
  const at = effectiveState(workflow, now)
  if (at !== input.from) return { kind: "refused", code: "moved", now }
  const column = columnsOf(workflow, cards).get(to) ?? []
  const others = column.filter(c => c.id !== canvas)
  const before = others.findIndex(c => c.id === input.before)
  const index = input.before === null || before < 0 ? others.length : before
  // A card in a stale state is drawn in `to` but stored elsewhere: its
  // state is written, so it moves.
  const within = now.place.state === to
  if (within && column[index]?.id === canvas) return { kind: "unchanged" }
  const { order, respaced } = rankAfter(others, index - 1)
  const place: CardPlace = { kind: "board", state: to, order }
  return {
    kind: within ? "reorder" : "move",
    transition: stateTransition(workflow, at, to),
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
 * A new canvas's place on the board: the end of `state`, or of the first open
 * state for none or one that is no open state.
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
type WorkflowPlan =
  | Refusal
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly workflow: Workflow }

/**
 * Decide a change to the workflow. Names are trimmed and may repeat. The
 * archive is renamed, never moved or removed; a state holding a canvas is
 * not removed, nor the only open state.
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
        board.open.find(c => c.state.id === target.id)?.canvases.length ?? 0
      if (held > 0)
        return refused(
          ERR.STATE_NOT_EMPTY,
          `${target.name} holds ${held === 1 ? "a canvas" : `${held} canvases`}: move ${held === 1 ? "it" : "them"} first`,
        )
      if (open.length === 1)
        return refused(ERR.LAST_STATE, "the board needs one open state")
      return write({ open: open.filter(s => s.id !== target.id), archive })
    }
  }
}

const sameState = (a: WorkflowState, b: WorkflowState | undefined): boolean =>
  b !== undefined && a.id === b.id && a.name === b.name

/**
 * A change to the board's states, from the workflow and the cards as they
 * are: refused before the host wrote a workflow, else `planWorkflowEdit`
 * over the board they make, as the write of the workflow it leaves.
 */
export function planWorkflowChange(input: {
  readonly workflow: Workflow | null
  readonly cards: readonly CardRecord[]
  readonly edit: WorkflowEdit
  readonly newId: () => string
}):
  | Refusal
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "write"
      readonly writes: readonly ValueWrite<"session">[]
    } {
  const { workflow } = input
  if (workflow === null)
    return refused(ERR.UNKNOWN_STATE, "the board has no states yet")
  const planned = planWorkflowEdit(
    workflow,
    taskBoard(workflow, input.cards),
    input.edit,
    input.newId,
  )
  return planned.kind === "write"
    ? { kind: "write", writes: [setRecord(WORKFLOW, planned.workflow)] }
    : planned
}
