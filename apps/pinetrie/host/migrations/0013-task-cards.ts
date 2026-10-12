// host/migrations/0013-task-cards — a task is a card on the board. The places'
// rows gain `state`, so the schema's hash moves, and data moves with it: each
// task's record (`pinetrie.task`, who opened it and when) and its board place
// (`pinetrie.board`, its state, its rank, who moved it there and when) become
// its card, on the board in that state at that rank, and its card's history:
// created by its opener in the first open state, then moved by its placer into
// its state, when that is another. Both records are deleted.
//
// 0012-unstarted-threads, from the hash before, plans with this too, so a
// store there opens in one step. Delete this file once Duane's store has
// run it.

import { batch } from "@kyneta/schema"
import {
  type CardHistoryRecord,
  isTaskId,
  isWorkflowStateId,
  makeCard,
  NO_CONTENT,
  type PlaceKey,
  SESSION_TARGET,
  type TaskCard,
  type TaskId,
  type ValueWrite,
  type Workflow,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readWorkflow } from "@pinetrie/reads"
import { CARD_HISTORY, encodeCard, keyAfter, setRecord } from "@pinetrie/rules"
import {
  applyRecordWrites,
  PlacesDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import type { Migration } from "./index.ts"

/** Where tasks' records were kept. */
export const TASK_NAMESPACE = "pinetrie.task"
/** Where tasks' board places were kept. */
export const BOARD_NAMESPACE = "pinetrie.board"

/** A field of a stored value, read as text; "" for none. */
const textOf = (value: unknown, field: string): string => {
  const v =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)[field]
      : undefined
  return typeof v === "string" ? v : ""
}

/** A field of a stored value, read as a number; 0 for none. */
const numberOf = (value: unknown, field: string): number => {
  const v =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)[field]
      : undefined
  return typeof v === "number" ? v : 0
}

/** What the migration writes. */
export interface TaskCardsPlan {
  /** Each task's card. */
  readonly cards: readonly TaskCard[]
  /** Each card's history, and both old records deleted. */
  readonly records: readonly ValueWrite[]
}

/**
 * Each task's card and history from its two records, pure. A task whose
 * place names no state the workflow holds is in the first open state, and
 * one with no rank at the end of its state; none is made before there is
 * a workflow, nor for a task no one opened, and a key that is no task's is
 * only deleted.
 */
export function planTaskCards(input: {
  /** `pinetrie.task`'s stored values, by key. */
  readonly tasks: Readonly<Record<string, unknown>>
  /** `pinetrie.board`'s stored values, by key. */
  readonly board: Readonly<Record<string, unknown>>
  readonly workflow: Workflow | null
}): TaskCardsPlan {
  const records: ValueWrite[] = [
    ...Object.keys(input.tasks).map(
      (key): ValueWrite => ({
        kind: "delete",
        target: SESSION_TARGET,
        namespace: TASK_NAMESPACE,
        key,
      }),
    ),
    ...Object.keys(input.board).map(
      (key): ValueWrite => ({
        kind: "delete",
        target: SESSION_TARGET,
        namespace: BOARD_NAMESPACE,
        key,
      }),
    ),
  ]
  const { workflow } = input
  const first = workflow?.open[0]?.id ?? workflow?.archive.id
  if (workflow === null || first === undefined) return { cards: [], records }
  const known = new Set<WorkflowStateId>([
    ...workflow.open.map(s => s.id),
    workflow.archive.id,
  ])
  const keys = [
    ...new Set([...Object.keys(input.tasks), ...Object.keys(input.board)]),
  ]
    .filter(isTaskId)
    .sort()
  const ranks = new Map<WorkflowStateId, string[]>()
  const placed = keys.map(task => {
    const record = input.tasks[task]
    const place = input.board[task]
    const stored = textOf(place, "state")
    const state =
      isWorkflowStateId(stored) && known.has(stored) ? stored : first
    const rank = textOf(place, "rank")
    if (rank !== "") ranks.set(state, [...(ranks.get(state) ?? []), rank])
    return { task, record, place, state, rank }
  })
  const cards: TaskCard[] = []
  for (const { task, record, place, state, rank } of placed) {
    const opener = textOf(record, "by") || textOf(place, "by")
    if (opener === "") continue
    const placer = (textOf(place, "by") || opener) as WriterId
    let order = rank
    if (order === "") {
      order = keyAfter(ranks.get(state) ?? [])
      ranks.set(state, [...(ranks.get(state) ?? []), order])
    }
    const card: TaskCard = {
      ...makeCard(
        "task",
        task,
        { kind: "board", state, order },
        NO_CONTENT,
        opener as WriterId,
      ),
      placer,
    }
    cards.push(card)
    const start: PlaceKey = { kind: "board", state: first }
    const history: CardHistoryRecord = {
      card: task,
      events: [
        {
          kind: "created",
          by: opener as WriterId,
          from: null,
          to: start,
          at: numberOf(record, "createdAt"),
        },
        ...(state === first
          ? []
          : [
              {
                kind: "moved" as const,
                by: placer,
                from: start,
                to: { kind: "board", state } as const,
                at: numberOf(place, "at"),
              },
            ]),
      ],
    }
    records.push(setRecord(CARD_HISTORY, history))
  }
  return { cards, records }
}

/** The tasks' cards planned from a session's records (`planTaskCards`). */
export const planStoredTaskCards = (
  session: Parameters<typeof readWorkflow>[0],
): TaskCardsPlan =>
  planTaskCards({
    tasks: readNamespace(session, TASK_NAMESPACE),
    board: readNamespace(session, BOARD_NAMESPACE),
    workflow: readWorkflow(session),
  })

/** The task ids `plan` makes cards for. */
export const tasksOfPlan = (plan: TaskCardsPlan): ReadonlySet<TaskId> =>
  new Set(plan.cards.map(c => c.id))

export const taskCards: Migration = {
  name: "0013-task-cards",
  kind: "places",
  from: "0207ca431ce780d8afc2e4242da69b7f03",
  async run({ exchange, hydrated }) {
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    await hydrated(PLACES_DOC_ID)
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const plan = planStoredTaskCards(session)
    return async () => {
      applyRecordWrites(session, plan.records)
      batch(places, d => {
        for (const card of plan.cards)
          d.cards.set(card.id, encodeCard(card) as never)
      })
      places.rev.set(places.rev() + 1)
    }
  },
}
