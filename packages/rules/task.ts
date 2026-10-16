// task — a task's canvas, and a thread's opening.

import {
  agentAsk,
  type CanvasKey,
  type CanvasTarget,
  type CardId,
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  type EntryId,
  forkEntry,
  hasPlaceKind,
  isThreadId,
  livePlaceOf,
  type MoveTarget,
  makeCard,
  NO_CONTENT,
  ownerOf,
  type PlaceKey,
  type PlaceOf,
  type RootId,
  type SurfaceOwner,
  type TaskId,
  type ThreadFork,
  type ThreadId,
  type ThreadOrigin,
  type ThreadRecord,
  type TreeIndex,
  threadOfPlace,
  type ValueWrite,
  type Workflow,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { boardEnd } from "./board.ts"
import {
  type MakeStep,
  type PlaceStep,
  planMake,
  rankOnCanvas,
} from "./moves.ts"
import { branchAfter, rankAfter } from "./rank.ts"
import { setRecord } from "./records.ts"
import { THREAD } from "./thread.ts"

/** A card on a canvas, in its task's order. */
export type CanvasCard = CardInPlace<"canvas">

/** A canvas card's kinds: what every consumer of a canvas switches over. */
export type CanvasKind = CanvasCard["kind"]

export const isCanvasCard = (c: CardRecord): c is CanvasCard =>
  hasPlaceKind(c, "canvas")

const onCanvas = isCanvasCard

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
 * Where every card and thread is among tasks, from the places
 * and the threads' records alone: the one derivation the host and the page
 * both read, so they cannot disagree on which task something is in.
 */
export interface TaskIndex {
  /** Each task's cards, in its canvas's order: by rank, then by id. */
  readonly canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>
  /**
   * Each canvas card's task, a thread's or a note column's; a trashed one's
   * is the task its canvas place was in, so its own cards keep a task while
   * it is in the trash.
   */
  readonly taskOfCard: ReadonlyMap<CardId, TaskId>
  /** Each thread's task, a trashed one's as `taskOfCard`'s; a thread in an inventory has none. */
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
  /**
   * Each forked thread's fork, a branch's or a copy's: where its
   * column ends before its first send, and what its fork row names after it.
   */
  readonly forkOf: ReadonlyMap<ThreadId, ThreadFork>
}

/** Every card's task, as the places and the threads' records say. */
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
  // A trashed card is in the task its `left` is in, and on no canvas.
  for (const c of cards) {
    if (c.place.kind !== "trash" || c.place.left.kind !== "canvas") continue
    taskOfCard.set(c.id, c.place.left.task)
    if (isThreadId(c.id)) taskOfThread.set(c.id, c.place.left.task)
  }
  const rootOfThread = new Map(
    [...threads].map(([thread, r]) => [thread, r.root] as const),
  )
  const forkOf = new Map(
    [...threads].flatMap(([thread, r]) =>
      r.origin.kind === "fork" ? [[thread, r.origin] as const] : [],
    ),
  )
  return {
    canvases,
    taskOfCard,
    taskOfThread,
    threadsOf,
    rootsOf,
    tasksOfRoot,
    rootOfThread,
    forkOf,
  }
}

/**
 * The root a place is in: a place at a thread, its thread's
 * (`rootOfThread`). Undefined for any other, or a thread with no record.
 */
export const rootOfPlace = (
  place: CardPlace | PlaceKey,
  rootOfThread: ReadonlyMap<ThreadId, RootId>,
): RootId | undefined => {
  const thread = threadOfPlace(place)
  return thread === null ? undefined : rootOfThread.get(thread)
}

/** No tasks: before the places arrive. */
export const NO_TASK_INDEX: TaskIndex = indexTasks([], new Map())

/**
 * The task a place is in: its surface's owner's (`ownerOf`). A task's own;
 * a note column's or a thread's task; none for an inventory, or the board
 * (a task's card is in no task: the board is the team's). A trashed card's
 * is the place it left's; a trash key names none, since the host fills in
 * where a discard leaves.
 */
export function taskOfPlace(
  tasks: TaskIndex,
  place: CardPlace | PlaceKey,
): TaskId | null {
  if (place.kind === "trash")
    return "left" in place ? taskOfPlace(tasks, place.left) : null
  return taskOfOwner(tasks, ownerOf(place))
}

/** The task a surface's owner is in: a task itself, a note column's or a thread's. */
function taskOfOwner(tasks: TaskIndex, owner: SurfaceOwner): TaskId | null {
  switch (owner.kind) {
    case "task":
      return owner.task
    case "note-column":
      return tasks.taskOfCard.get(owner.column) ?? null
    case "thread":
      return tasks.taskOfThread.get(owner.thread) ?? null
    case "person":
    case "team":
      return null
  }
}

/**
 * The task a move sends a card to: its place's (`taskOfPlace`); a thread's
 * nearest notes, its thread's; a spot on a canvas, its canvas's.
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
    case "new-task":
      return to.task
    // A restore's task is its card's, read from where the card is.
    case "back":
      return null
    default:
      return taskOfPlace(tasks, to)
  }
}

/**
 * Whether card `id` is on its task's canvas now: not in an inventory, and
 * not trashed, though the index still names a trashed card's task.
 */
export const isOnCanvas = (tasks: TaskIndex, id: CardId): boolean => {
  const task = tasks.taskOfCard.get(id)
  return (
    task !== undefined &&
    (tasks.canvases.get(task) ?? []).some(c => c.id === id)
  )
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
 * Where a thread's card lands as the thread opens: on `task`'s
 * canvas just after the thread it forks from (`branchAfter`), else at the
 * canvas's end; where it was dropped on a canvas (`rankOnCanvas`); or in an
 * inventory.
 */
export type ThreadPlacement =
  | {
      readonly kind: "after"
      readonly task: TaskId
      /** The thread it forks from; null for a root's first thread. */
      readonly parent: ThreadId | null
    }
  | { readonly kind: "spot"; readonly to: CanvasKey | CanvasTarget }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/** The task a thread opens in, when the session does not hold it yet: a new tab's. */
export interface TaskOpening {
  /** The workflow state it lands in; null for the first open one. */
  readonly state: WorkflowStateId | null
  /** The board's states; null before the host wrote them, when no task opens. */
  readonly workflow: Workflow | null
}

/** What a thread's opening writes, or why its card's make was refused. */
export type ThreadOpen =
  | {
      readonly kind: "open"
      readonly records: readonly ValueWrite[]
      /**
       * The cards re-ranked to make room, then its card; for a task the
       * session lacks, the task's card first, at the end of its state on
       * the board (`boardEnd`).
       */
      readonly steps: readonly PlaceStep[]
    }
  | Extract<MakeStep, { kind: "refused" }>

/**
 * A thread opened: the one way a thread begins, before its first
 * entry, as its column opens, a copy is made or a card is spun into it. Its
 * record says how it began (`origin`); its card is made by `by`
 * (`makeCard`, `planMake`) where `placement` says; and a task the session
 * does not hold (`opens`) is made with it, its card by the host on `by`'s
 * behalf, `by` its owner: refused `no-place` before the board has states.
 * Its first send writes only its entry.
 */
export function planThreadOpen(input: {
  readonly thread: ThreadId
  readonly origin: ThreadOrigin
  readonly root: RootId
  readonly by: WriterId
  readonly now: number
  readonly placement: ThreadPlacement
  readonly opens: TaskOpening | null
  readonly cards: readonly CardRecord[]
}): ThreadOpen {
  const { thread, by, now, placement, cards } = input
  const ranked = ((): {
    readonly to: PlaceOf<"thread">
    readonly first: readonly PlaceStep[]
  } => {
    switch (placement.kind) {
      case "inventory":
        return { to: placement, first: [] }
      case "spot": {
        const { to, first } = rankOnCanvas(cards, thread, placement.to)
        return { to: { ...to, width: 1 }, first }
      }
      case "after": {
        const canvas = canvasOf(cards, placement.task)
        const { order, respaced } = rankAfter(
          canvas,
          branchAfter(canvas, placement.parent),
        )
        return {
          to: { kind: "canvas", task: placement.task, order, width: 1 },
          first: respaced.map(
            (record): PlaceStep => ({ kind: "write", record }),
          ),
        }
      }
    }
  })()
  const made = planMake(
    cards,
    makeCard("thread", thread, ranked.to, NO_CONTENT, by),
    by,
  )
  if (made.kind === "refused") return made
  const records: ValueWrite[] = [
    setRecord(THREAD, {
      thread,
      root: input.root,
      by,
      createdAt: now,
      origin: input.origin,
    }),
  ]
  const task = ranked.to.kind === "canvas" ? ranked.to.task : null
  if (input.opens === null || task === null)
    return { kind: "open", records, steps: [...ranked.first, made] }
  const opened = planTaskOpening(task, by, input.opens, cards)
  if (opened.kind === "refused") return opened
  return { kind: "open", records, steps: [opened, ...ranked.first, made] }
}

/**
 * A task made for `by`, its owner: its card by the host at the end of its
 * state on the board (`boardEnd`), the one way a task is made, as a thread
 * opens in it or a card is dropped between tasks in the sidebar. Refused
 * `no-place` before the board has states, `exists` for an id in use.
 */
export function planTaskOpening(
  task: TaskId,
  by: WriterId,
  opens: TaskOpening,
  cards: readonly CardRecord[],
): MakeStep {
  const { workflow, state } = opens
  if (workflow === null) return { kind: "refused", code: "no-place", now: null }
  return planMake(
    cards,
    makeCard("task", task, boardEnd(workflow, cards, state), NO_CONTENT, by),
    "host",
  )
}

/** Where a thread not yet started begins: its root, and its fork, or null for a new root's first. */
export interface ThreadOpening {
  readonly root: RootId
  readonly fork: EntryId | null
  /** What its composer starts with for this reader: a proposal's brief (`proposalDraft`). */
  readonly draft?: string
}

/**
 * Each thread opened and not yet started: no entry of it in
 * `index`, and either its fork in `index` (a branch's or a copy's, its root
 * held here), or its root one the directory does not name yet (`started`:
 * a new tab's, whose root gets its document with its first entry). A
 * thread whose root this tab does not hold is in neither.
 */
export function unstartedThreads(
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  index: TreeIndex,
  started: ReadonlySet<RootId>,
  me: WriterId,
): ReadonlyMap<ThreadId, ThreadOpening> {
  const out = new Map<ThreadId, ThreadOpening>()
  for (const [thread, r] of threads) {
    if (index.firstOf.has(thread)) continue
    const fork = forkEntry(r.origin)
    if (
      fork === null ? !started.has(r.root) : index.entries[fork] !== undefined
    ) {
      const draft = proposalDraft({ record: r, index, me })
      out.set(
        thread,
        draft === undefined
          ? { root: r.root, fork }
          : { root: r.root, fork, draft },
      )
    }
  }
  return out
}

/**
 * What an opened branch's composer starts with for `me`: its row's brief,
 * asked of the agent. Only for the one who opened it, and only before its
 * first send; never stored, so it reads the same on each of their devices.
 */
export function proposalDraft(input: {
  readonly record: ThreadRecord
  readonly index: TreeIndex
  readonly me: WriterId
}): string | undefined {
  const { record, index } = input
  const { origin } = record
  if (origin.kind !== "fork" || origin.how !== "branch") return undefined
  if (origin.proposal === undefined || record.by !== input.me) return undefined
  if (index.firstOf.has(record.thread)) return undefined
  const proposal = index.entries[origin.proposal.entry]?.message?.proposal
  const brief = proposal?.branches[origin.proposal.row]?.brief
  return brief === undefined ? undefined : agentAsk(brief)
}

/**
 * Whether a thread card at `place` keeps its root held: in an inventory, or
 * on the canvas of a task outside `archived`. A trashed card is asked of the
 * place it left, so a restore, or a link to it, finds its messages until the
 * sweep deletes it. The host's late writes ask the same (`lateAway`,
 * `reach.ts`), so a write it lets through finds its root loaded.
 */
export function isLivePlace(
  place: CardPlace,
  archived: { readonly has: (task: TaskId) => boolean },
): boolean {
  const left = livePlaceOf(place)
  return (
    left.kind === "inventory" ||
    (left.kind === "canvas" && !archived.has(left.task))
  )
}

/**
 * The roots something still holds: those with a thread whose card is at a
 * live place (`isLivePlace`). What a starting host loads (`planLoads`), and
 * what archiving keeps. A root gets its document with its first entry, so
 * one the directory does not name (`started`) is not held: an unstarted new
 * tab's thread names a root with nothing to load.
 */
export function rootsHeld(
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  archived: ReadonlySet<TaskId>,
  started: ReadonlySet<RootId>,
): ReadonlySet<RootId> {
  const held = new Set<RootId>()
  for (const c of cards) {
    if (c.kind !== "thread") continue
    const root = threads.get(c.id)?.root
    if (
      isLivePlace(c.place, archived) &&
      root !== undefined &&
      started.has(root)
    )
      held.add(root)
  }
  return held
}
