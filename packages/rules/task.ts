// task — a task's record and its canvas (ADR-0116).
//
// A task is the board's card. Its record says only who opened it and when:
// what it holds is where the places document puts each card (a `canvas`
// place, with the task and a rank), so a card has one place by construction
// and no list can disagree with it. A thread card's id is its thread's.

import {
  type BoardPlace,
  type CardId,
  type CardPlace,
  type CardRecord,
  isThreadId,
  type MoveTarget,
  type PlaceKey,
  type RootId,
  type TaskId,
  type TaskRecord,
  type ThreadCard,
  type ThreadId,
  type ThreadRecord,
  threadOfPlace,
  type ValueWrite,
  type Workflow,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { BOARD, placeStarted } from "./board.ts"
import { decodeAt, taskKey } from "./decode.ts"
import { branchAfter, rankAfter } from "./rank.ts"
import { type RecordSpec, setRecord } from "./records.ts"
import { THREAD } from "./thread.ts"

const TaskSchema = Type.Object({
  by: Type.String({ minLength: 1 }),
  createdAt: Type.Number(),
})

/** Each task, at its id, in the session: written as it opens. */
export const TASK: RecordSpec<TaskRecord, TaskId, "session"> = {
  namespace: "pinetrie.task",
  home: "session",
  keyOf: r => r.task,
  encode: ({ task, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(TaskSchema, contents, taskKey(key), (r, task) => ({
      task,
      by: r.by as WriterId,
      createdAt: r.createdAt,
    })),
}

/** A card on a canvas, in its task's order. */
export type CanvasCard = CardRecord & {
  readonly place: Extract<CardPlace, { readonly kind: "canvas" }>
}

const onCanvas = (c: CardRecord): c is CanvasCard => c.place.kind === "canvas"

const byRank = (a: CanvasCard, b: CanvasCard): number =>
  a.place.order < b.place.order
    ? -1
    : a.place.order > b.place.order
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0

/**
 * Where every card and thread is among tasks (ADR-0116), from the places
 * and the threads' records alone: the one derivation the host and the page
 * both read, so they cannot disagree on which task something is in.
 */
export interface TaskIndex {
  /** Each task's cards, in its canvas's order: by rank, then by id. */
  readonly canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>
  /** Each canvas card's task: a thread's, a note column's. */
  readonly taskOfCard: ReadonlyMap<CardId, TaskId>
  /** Each thread's task; a thread in an inventory has none. */
  readonly taskOfThread: ReadonlyMap<ThreadId, TaskId>
  /** Each task's thread cards, in canvas order. */
  readonly threadsOf: ReadonlyMap<TaskId, readonly ThreadId[]>
  /**
   * The roots of each task's threads, each once, in the order its first
   * thread is on the canvas; a thread with no record yet is left out.
   */
  readonly rootsOf: ReadonlyMap<TaskId, readonly RootId[]>
  /** The tasks each root has a thread in, by task id. */
  readonly tasksOfRoot: ReadonlyMap<RootId, readonly TaskId[]>
  /**
   * Each recorded thread's root: a place at a thread names no root, so a
   * place's root is its thread's (`THREAD`).
   */
  readonly rootOfThread: ReadonlyMap<ThreadId, RootId>
}

/** Every card's task, as the places and the threads' records say. Pure. */
export function indexTasks(
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
): TaskIndex {
  const canvases = new Map<TaskId, CanvasCard[]>()
  for (const c of cards.filter(onCanvas)) {
    const list = canvases.get(c.place.task) ?? []
    list.push(c)
    canvases.set(c.place.task, list)
  }
  const taskOfCard = new Map<CardId, TaskId>()
  const taskOfThread = new Map<ThreadId, TaskId>()
  const threadsOf = new Map<TaskId, readonly ThreadId[]>()
  const rootsOf = new Map<TaskId, readonly RootId[]>()
  const tasksOfRoot = new Map<RootId, TaskId[]>()
  for (const task of [...canvases.keys()].sort()) {
    const canvas = canvases.get(task) ?? []
    canvas.sort(byRank)
    for (const c of canvas) taskOfCard.set(c.id, task)
    const ids = canvas.flatMap(c => (isThreadId(c.id) ? [c.id] : []))
    threadsOf.set(task, ids)
    const roots: RootId[] = []
    for (const thread of ids) {
      taskOfThread.set(thread, task)
      const root = threads.get(thread)?.root
      if (root !== undefined && !roots.includes(root)) roots.push(root)
    }
    rootsOf.set(task, roots)
    for (const root of roots)
      tasksOfRoot.set(root, [...(tasksOfRoot.get(root) ?? []), task])
  }
  const rootOfThread = new Map(
    [...threads].map(([thread, r]) => [thread, r.root] as const),
  )
  return {
    canvases,
    taskOfCard,
    taskOfThread,
    threadsOf,
    rootsOf,
    tasksOfRoot,
    rootOfThread,
  }
}

/**
 * The root a place is in: a fresh column's own; a place at a thread, its
 * thread's (`rootOfThread`). Undefined for any other, or a thread with no
 * record. Pure.
 */
export const rootOfPlace = (
  place: CardPlace | PlaceKey,
  rootOfThread: ReadonlyMap<ThreadId, RootId>,
): RootId | undefined => {
  if (place.kind === "fresh") return place.root
  const thread = threadOfPlace(place)
  return thread === null ? undefined : rootOfThread.get(thread)
}

/** No tasks: before the places arrive. */
export const NO_TASK_INDEX: TaskIndex = indexTasks([], new Map())

/**
 * The task a place is in (ADR-0116): a canvas card's, a fresh column's, a
 * card pinned to a task's or a gone card's own; a note, its note column's; a card at a thread, its
 * thread's task (a queued card's thread is its lane). Null for an
 * inventory, or a thread or a note column in none. Pure.
 */
export function taskOfPlace(
  tasks: TaskIndex,
  place: CardPlace | PlaceKey,
): TaskId | null {
  switch (place.kind) {
    case "canvas":
    case "fresh":
    case "task-pinned":
      return place.task
    // A gone key names no history: the host gives it one (`historyOf`).
    case "gone":
      return "task" in place ? place.task : null
    case "inventory":
      return null
    case "note":
      return tasks.taskOfCard.get(place.column) ?? null
    case "queued":
    case "composing":
    case "pinned":
      return tasks.taskOfThread.get(place.thread) ?? null
  }
}

/**
 * The task a move sends a card to: its place's (`taskOfPlace`); a thread's
 * nearest notes, its thread's; a spot on a canvas, its canvas's. Pure.
 */
export function taskOfTarget(
  tasks: TaskIndex,
  to: CardPlace | MoveTarget,
): TaskId | null {
  switch (to.kind) {
    case "notes":
      return to.near === "thread"
        ? (tasks.taskOfThread.get(to.thread) ?? null)
        : to.task
    case "canvas-at":
      return to.task
    default:
      return taskOfPlace(tasks, to)
  }
}

/** The task a card is in now: its place's (`taskOfPlace`); null for none. */
export const taskOfCard = (
  tasks: TaskIndex,
  cards: readonly CardRecord[],
  id: CardId,
): TaskId | null => {
  const now = cards.find(c => c.id === id)
  return now === undefined ? null : taskOfPlace(tasks, now.place)
}

/** One task's cards, in order. */
export const canvasOf = (
  cards: readonly CardRecord[],
  task: TaskId,
): readonly CanvasCard[] =>
  cards
    .filter(onCanvas)
    .filter(c => c.place.task === task)
    .sort(byRank)

/**
 * A thread's card as it first lands on `task`'s canvas, one column wide,
 * its starter its owner and placer: a branch just after the thread it forks
 * from (`parent`, `branchAfter`), anything else at the canvas's end. With
 * it, the cards given new ranks to make room (`rankAfter`). Pure.
 */
export function planThreadCard(input: {
  readonly thread: ThreadId
  readonly task: TaskId
  readonly by: WriterId
  readonly cards: readonly CardRecord[]
  /** The thread a branch forks from; null for a new root. */
  readonly parent: ThreadId | null
}): { readonly card: ThreadCard; readonly respaced: readonly CardRecord[] } {
  const canvas = canvasOf(input.cards, input.task)
  const { order, respaced } = rankAfter(
    canvas,
    branchAfter(canvas, input.parent),
  )
  return {
    card: {
      kind: "thread",
      id: input.thread,
      owner: input.by,
      place: { kind: "canvas", task: input.task, order, width: 1 },
      placer: input.by,
    },
    respaced,
  }
}

/** A thread's card as it first lands on `task`'s canvas: at its end (`planThreadCard`). */
export const threadCardOf = (input: {
  readonly thread: ThreadId
  readonly task: TaskId
  readonly by: WriterId
  readonly cards: readonly CardRecord[]
}): ThreadCard => planThreadCard({ ...input, parent: null }).card

/** What a thread's first message writes besides itself (ADR-0116, ADR-0117). */
export interface ThreadStart {
  /** Its record; and for a new task, the task's record and its board place. */
  readonly records: readonly ValueWrite[]
  /**
   * Its card, just after the thread it branches from, else at the end of
   * its task's canvas (`planThreadCard`), then any card given a new rank to
   * make room.
   */
  readonly cards: readonly [ThreadCard, ...CardRecord[]]
}

/**
 * A thread's start, planned: its record, its card on `task`'s canvas just
 * after the thread it branches from (`parent`), else at its end, and, when
 * `task` is new (a new tab's), the task's record and its place at the end
 * of `state` on the board, or of the first open state. With no workflow
 * yet, a new task gets no board place. Pure.
 */
export function planThreadStart(input: {
  readonly thread: ThreadId
  /** The thread a branch forks from; null for a new root. */
  readonly parent: ThreadId | null
  readonly root: RootId
  readonly task: TaskId
  readonly by: WriterId
  readonly now: number
  readonly state: WorkflowStateId | null
  /** Every task the session holds. */
  readonly tasks: ReadonlySet<TaskId>
  readonly workflow: Workflow | null
  readonly board: ReadonlyMap<TaskId, BoardPlace>
  readonly cards: readonly CardRecord[]
}): ThreadStart {
  const { thread, task, by, now } = input
  const opens = !input.tasks.has(task)
  const records: ValueWrite[] = [
    setRecord(THREAD, {
      thread,
      root: input.root,
      by,
      createdAt: now,
      fork: null,
    }),
  ]
  if (opens) {
    records.push(setRecord(TASK, { task, by, createdAt: now }))
    if (input.workflow !== null)
      records.push(
        setRecord(
          BOARD,
          placeStarted({
            task,
            state: input.state,
            by,
            now,
            workflow: input.workflow,
            places: input.board,
          }),
        ),
      )
  }
  const { card, respaced } = planThreadCard({
    thread,
    task,
    by,
    cards: input.cards,
    parent: input.parent,
  })
  return { records, cards: [card, ...respaced] }
}

/**
 * The roots something still holds (ADR-0116): those with a thread whose
 * card is on the canvas of a task outside `archived`, or in an inventory.
 * What a starting host loads (`planLoads`), and what archiving keeps. Pure.
 */
export function rootsHeld(
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  archived: ReadonlySet<TaskId>,
): ReadonlySet<RootId> {
  const held = new Set<RootId>()
  for (const c of cards) {
    if (c.kind !== "thread") continue
    const live =
      c.place.kind === "inventory" ||
      (c.place.kind === "canvas" && !archived.has(c.place.task))
    const root = threads.get(c.id)?.root
    if (live && root !== undefined) held.add(root)
  }
  return held
}
