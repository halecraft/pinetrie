// board — the team's workflow and each canvas's card on the board.

import {
  type CanvasId,
  ERR,
  isWorkflowStateId,
  type Refusal,
  refused,
  type ThreadId,
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
  WORKFLOW_MARKS,
  type WorkflowEdit,
  type WorkflowMark,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { byOrder } from "./card.ts"
import type { CardHistoryRecord } from "./card-history.ts"
import { choiceSchema, fixedKey, recordDecoder } from "./decode.ts"
import { orderAfter } from "./order.ts"
import type { PlaceStep } from "./place-steps.ts"
import { rankAfter } from "./rank.ts"
import { type RecordSpec, setRecord } from "./records.ts"

export const WORKFLOW_KEY = "workflow"

const StateSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
})

const OpenStateSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  /** Absent for a state with no mark. */
  mark: Type.Optional(choiceSchema(WORKFLOW_MARKS)),
})

const WorkflowSchema = Type.Object({
  open: Type.Array(OpenStateSchema, { minItems: 1 }),
  archive: StateSchema,
})

/** A workflow state: a column of the board. */
export interface WorkflowState {
  readonly id: WorkflowStateId
  readonly name: string
}

/** An open state: a column before the archive, and its mark, if any. */
interface OpenState extends WorkflowState {
  readonly mark: WorkflowMark | null
}

declare const workflowBrand: unique symbol
/**
 * The session's workflow: a host-written `pinetrie.workflow` singleton. The
 * open states in board order, then the archive, which is always there and
 * always last: a root in it is archived. Only `checkedWorkflow` makes one.
 * A spread of one (`{ ...w, open }`) keeps the brand unchecked, so a
 * workflow is never spread into another.
 */
export interface Workflow {
  readonly open: readonly OpenState[]
  readonly archive: WorkflowState
  /** The open state marked Topics: the same object as in `open`. */
  readonly topics: OpenState
  /** The open state marked Active, or null. */
  readonly active: OpenState | null
  readonly [workflowBrand]: true
}

/**
 * `open` and the archive as a workflow; undefined unless exactly one open
 * state is marked Topics, at most one is marked Active, and no two states
 * share an id.
 */
export function checkedWorkflow(
  open: readonly OpenState[],
  archive: WorkflowState,
): Workflow | undefined {
  const ids = new Set([...open.map(s => s.id), archive.id])
  if (ids.size !== open.length + 1) return undefined
  const topics = open.filter(s => s.mark === "topics")
  const active = open.filter(s => s.mark === "active")
  const [first] = topics
  if (first === undefined || topics.length > 1 || active.length > 1)
    return undefined
  return {
    open,
    archive,
    topics: first,
    active: active[0] ?? null,
  } as Workflow
}

const decodedState = (s: {
  id: string
  name: string
}): WorkflowState | undefined =>
  isWorkflowStateId(s.id) ? { id: s.id, name: s.name } : undefined

/** The session's workflow: one value, at `WORKFLOW_KEY`. */
export const WORKFLOW: RecordSpec<
  Workflow,
  typeof WORKFLOW_KEY,
  "session",
  typeof WorkflowSchema
> = {
  namespace: "pinetrie.workflow",
  home: "session",
  keyOf: () => WORKFLOW_KEY,
  encode: w => ({
    open: w.open.map(({ id, name, mark }) =>
      mark === null ? { id, name } : { id, name, mark },
    ),
    archive: { id: w.archive.id, name: w.archive.name },
  }),
  decode: recordDecoder(
    WorkflowSchema,
    key => fixedKey(WORKFLOW_KEY, key),
    w => {
      const open: OpenState[] = []
      for (const s of w.open) {
        const state = decodedState(s)
        if (state === undefined) return undefined
        open.push({ ...state, mark: s.mark ?? null })
      }
      const archive = decodedState(w.archive)
      return archive === undefined ? undefined : checkedWorkflow(open, archive)
    },
  ),
}

/**
 * A new session's workflow: Topics, marked Topics, and Active, marked
 * Active, then Archive, the archive.
 */
export function defaultWorkflow(newId: () => string): Workflow {
  const made = checkedWorkflow(
    [
      { id: workflowStateIdFor(newId()), name: "Topics", mark: "topics" },
      { id: workflowStateIdFor(newId()), name: "Active", mark: "active" },
    ],
    { id: workflowStateIdFor(newId()), name: "Archive" },
  )
  if (made === undefined) throw new Error("the default workflow is invalid")
  return made
}

/**
 * What a canvas on the board is, by where it is: a topic in the state marked
 * Topics, there for teammates to find; a task in any other open state, its
 * work tracked; archived in the archive. Never stored.
 */
export type CanvasRole = "topic" | "task" | "archived"

/**
 * The role of a canvas in `state`. A state the workflow no longer holds is
 * read as Topics, as `taskBoard` places its canvases there.
 */
export function canvasRole(w: Workflow, state: WorkflowStateId): CanvasRole {
  if (state === w.archive.id) return "archived"
  if (state === w.topics.id) return "topic"
  return w.open.some(s => s.id === state) ? "task" : "topic"
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
export const boardStates = (w: Workflow): readonly WorkflowState[] => [
  ...w.open,
  w.archive,
]

/** The state of `w` that `id` names, or undefined. */
export const workflowState = (
  w: Workflow,
  id: WorkflowStateId,
): WorkflowState | undefined => boardStates(w).find(s => s.id === id)

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

/** The state a card on the board is read in: its own, or Topics when the workflow lacks it. */
const effectiveState = (w: Workflow, card: BoardCard): WorkflowStateId =>
  workflowState(w, card.place.state) !== undefined
    ? card.place.state
    : w.topics.id

/** Each state's cards, in order: by rank, then by id; a stale state's after them at the end of Topics. */
function stateColumns(
  workflow: Workflow,
  cards: readonly CardRecord[],
): ReadonlyMap<WorkflowStateId, readonly BoardCard[]> {
  const placed = cards.filter(isBoardCard)
  const fits = (c: BoardCard) =>
    workflowState(workflow, c.place.state) !== undefined
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
 * a state the workflow lacks after them at the end of Topics.
 */
export function taskBoard(
  workflow: Workflow,
  cards: readonly CardRecord[],
): Board {
  const columns = stateColumns(workflow, cards)
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
 * changes, its placer stays. Between states its sender is its placer, and
 * its card records that its state changed, which no other write sets. A
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
  if (workflowState(workflow, to) === undefined)
    return { kind: "refused", code: "no-place", now }
  const at = effectiveState(workflow, now)
  if (at !== input.from) return { kind: "refused", code: "moved", now }
  const column = stateColumns(workflow, cards).get(to) ?? []
  const others = column.filter(c => c.id !== canvas)
  const before = others.findIndex(c => c.id === input.before)
  const index = input.before === null || before < 0 ? others.length : before
  // A card in a stale state is drawn in `to` but stored elsewhere: its
  // state is written, so it moves, though the state it is read in does not
  // change.
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
        record: {
          ...now,
          place,
          placer: within ? now.placer : input.sender,
          content: at === to ? now.content : { stateChanged: true },
        },
      },
      ...respaced.map((record): PlaceStep => ({ kind: "write", record })),
    ],
  }
}

/**
 * The writes that move `thread`'s canvas to the end of Active as an agent
 * starts work in it: none unless the thread's card is on a canvas in Topics,
 * Active is marked, and the canvas's state has never changed. The move is the
 * board's own (`planBoardMove`), from Topics, which it refuses for a canvas
 * elsewhere; its placer is kept, as the host's write keeps it.
 */
export function planMoveToActive(input: {
  readonly workflow: Workflow | null
  readonly cards: readonly CardRecord[]
  readonly thread: ThreadId
}): readonly PlaceStep[] {
  const { workflow, cards, thread } = input
  const active = workflow?.active ?? null
  if (workflow === null || active === null) return []
  const threadCard = cards.find(c => c.id === thread)
  if (threadCard === undefined || !hasPlaceKind(threadCard, "canvas")) return []
  const { canvas } = threadCard.place
  const card = cards.find(c => c.id === canvas)
  if (card === undefined || !isBoardCard(card) || card.content.stateChanged)
    return []
  const moved = planBoardMove({
    canvas: card.id,
    from: workflow.topics.id,
    to: active.id,
    before: null,
    sender: card.placer,
    workflow,
    cards,
  })
  return moved.kind === "move" ? moved.steps : []
}

/**
 * A new canvas's place on the board: the end of `state`, or of Topics for
 * none or one that is no open state.
 */
export function boardEnd(
  workflow: Workflow,
  cards: readonly CardRecord[],
  state: WorkflowStateId | null,
): Extract<CardPlace, { readonly kind: "board" }> {
  const at = workflow.open.find(s => s.id === state)?.id ?? workflow.topics.id
  return {
    kind: "board",
    state: at,
    order: orderAfter(stateColumns(workflow, cards).get(at) ?? []),
  }
}

/** A change to the workflow, as the host plans it. */
type WorkflowPlan =
  | Refusal
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly workflow: Workflow }

/** What a state's mark makes it, as a refusal names it. */
const markWhy = (state: OpenState): string =>
  state.mark === "topics"
    ? `${state.name} is where new canvases start`
    : `${state.name} is where agent work moves canvases`

/**
 * Decide a change to the workflow. Names are trimmed and may repeat. The
 * archive is renamed, never moved, removed or marked. A state holding a
 * canvas is not removed, nor the state marked Topics, so an open state is
 * always left. A mark moves to its state from the one that held it, and is
 * refused on a state holding the other. Every result is `checkedWorkflow`'s.
 */
export function planWorkflowEdit(
  workflow: Workflow,
  board: Board,
  edit: WorkflowEdit,
  newId: () => string,
): WorkflowPlan {
  const { open, archive } = workflow
  const placed = (
    states: readonly OpenState[],
    s: OpenState,
    before: WorkflowStateId | null,
  ): readonly OpenState[] => {
    const at = states.findIndex(x => x.id === before)
    return at < 0
      ? [...states, s]
      : [...states.slice(0, at), s, ...states.slice(at)]
  }
  const write = (
    nextOpen: readonly OpenState[],
    nextArchive: WorkflowState = archive,
  ): WorkflowPlan => {
    if (
      nextOpen.length === open.length &&
      nextOpen.every((s, i) => sameOpenState(s, open[i])) &&
      sameState(nextArchive, archive)
    )
      return { kind: "unchanged" }
    // The checks before each write leave one Topics; this refusal is the
    // backstop for a plan that would not.
    const next = checkedWorkflow(nextOpen, nextArchive)
    return next === undefined
      ? refused(ERR.STATE_MARKED, "the board needs one state marked Topics")
      : { kind: "write", workflow: next }
  }

  if (edit.action === "add") {
    const name = edit.name.trim()
    if (name === "") return refused(ERR.EMPTY_NAME, "a state needs a name")
    const added = { id: workflowStateIdFor(newId()), name, mark: null }
    return write(placed(open, added, edit.before))
  }
  if (edit.action === "unmark-active")
    return write(
      open.map(s => (s.mark === "active" ? { ...s, mark: null } : s)),
    )
  const target = open.find(s => s.id === edit.state)
  if (edit.action === "rename") {
    const name = edit.name.trim()
    if (name === "") return refused(ERR.EMPTY_NAME, "a state needs a name")
    if (edit.state === archive.id) return write(open, { id: archive.id, name })
    if (target === undefined)
      return refused(ERR.UNKNOWN_STATE, "that workflow state is gone")
    return write(open.map(s => (s.id === target.id ? { ...s, name } : s)))
  }
  if (edit.state === archive.id)
    return refused(
      ERR.STATE_ARCHIVE,
      edit.action === "move"
        ? `${archive.name} is always last`
        : edit.action === "remove"
          ? `${archive.name} cannot be removed`
          : `${archive.name} takes no mark`,
    )
  if (target === undefined)
    return refused(ERR.UNKNOWN_STATE, "that workflow state is gone")
  switch (edit.action) {
    case "move":
      if (edit.before === target.id) return { kind: "unchanged" }
      return write(
        placed(
          open.filter(s => s.id !== target.id),
          target,
          edit.before,
        ),
      )
    case "remove": {
      if (target.mark === "topics")
        return refused(
          ERR.STATE_MARKED,
          `${markWhy(target)}: mark another state Topics first`,
        )
      const held =
        board.open.find(c => c.state.id === target.id)?.canvases.length ?? 0
      if (held > 0)
        return refused(
          ERR.STATE_NOT_EMPTY,
          `${target.name} holds ${held === 1 ? "a canvas" : `${held} canvases`}: move ${held === 1 ? "it" : "them"} first`,
        )
      return write(open.filter(s => s.id !== target.id))
    }
    case "mark":
      if (target.mark === edit.mark) return { kind: "unchanged" }
      if (target.mark !== null)
        return refused(
          ERR.STATE_MARKED,
          `${markWhy(target)}: mark another state first`,
        )
      return write(
        open.map(s =>
          s.id === target.id
            ? { ...s, mark: edit.mark }
            : s.mark === edit.mark
              ? { ...s, mark: null }
              : s,
        ),
      )
  }
}

const sameState = (a: WorkflowState, b: WorkflowState | undefined): boolean =>
  b !== undefined && a.id === b.id && a.name === b.name

const sameOpenState = (a: OpenState, b: OpenState | undefined): boolean =>
  b !== undefined && sameState(a, b) && a.mark === b.mark

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
