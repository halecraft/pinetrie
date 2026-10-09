// interface/canvas-columns — a task's columns, from its canvas (ADR-0116).
//
// Every card on a task's canvas is a column, in the canvas's order, the
// same for everyone. What is yours is the task's view (`TaskView`): which
// columns you unfolded, how you read each, and the branches you opened and
// have not sent. It holds maps and a flag and no list, so it has nowhere to
// keep an order of its own (`canvasColumns` reads the order from the
// canvas alone). Pure.

import {
  type CardId,
  type CardRecord,
  type CardWidth,
  type EntryId,
  type LaneView,
  type NoteColumnId,
  type TaskId,
  type ThreadId,
  type TreeIndex,
  threadAt,
  type WriterId,
} from "@pinetrie/core"
import { branchAfter, type CanvasCard } from "@pinetrie/rules"
import type { Density } from "./ask-words.ts"
import {
  BOUND,
  type Column,
  type FreshMode,
  type Pending,
  type Prefill,
  threadAnchor,
} from "./columns.ts"

/** Your view of one column, by its card: none of it is shared (ADR-0116). */
export interface CardView {
  /** Drawn whole; else a narrow strip with its title. */
  readonly unfolded?: true
  /** How much of each ask is drawn (ADR-0106); absent is story. */
  readonly density?: Density
  /** The thread's details are open under the header (ADR-0073). */
  readonly details?: true
}

/**
 * A branch you opened and have not sent (ADR-0021): yours until its first
 * send, kept under the thread it minted, which its card will have.
 */
export interface FreshColumn {
  /** Its fork: where its first send writes. */
  readonly at: EntryId
  /** Its first send's id, once sent: the entry it wrote is `bySend`'s. */
  readonly sendId?: string
  /** A first message it sends as it opens ("branch here" after a conflict). */
  readonly pending?: Pending
  /** What its composer starts with, unsent. */
  readonly prefill?: Prefill
}

/**
 * Your view of one task: maps and a flag, so no order can be kept in it
 * (ADR-0116). The task column is no card, so its fold is apart.
 */
export interface TaskView {
  /** Your view of each column, by its card (a thread card's id is its thread's). */
  readonly cards: ReadonlyMap<CardId, CardView>
  /** The task column's fold. */
  readonly task: { readonly unfolded: boolean }
  /** Branches not yet sent, by the thread each minted. */
  readonly fresh: ReadonlyMap<ThreadId, FreshColumn>
}

/**
 * A task's view before you change it: only its first card unfolded, since a
 * task can hold many threads, and the task column folded.
 */
export const defaultView = (first: CardId | null): TaskView => ({
  cards: first === null ? new Map() : new Map([[first, { unfolded: true }]]),
  task: { unfolded: false },
  fresh: new Map(),
})

/** The view of a task: as kept, else `defaultView` for its canvas. */
export const viewOf = (
  views: ReadonlyMap<string, TaskView>,
  task: string,
  canvas: readonly CanvasCard[],
): TaskView => views.get(task) ?? defaultView(canvas[0]?.id ?? null)

/** One column of a task, as the strip draws it. */
export type CardColumn =
  | {
      readonly kind: "thread"
      /** Its card; null for a branch not yet on the canvas. */
      readonly card: ThreadId | null
      readonly column: Column
      readonly folded: boolean
      readonly width: CardWidth
    }
  | {
      readonly kind: "notes"
      readonly card: NoteColumnId
      readonly folded: boolean
      readonly width: CardWidth
    }

/**
 * The task column (ADR-0116): the task's own place on its canvas, drawn
 * before every card and outside the order. It is no card, so it has no
 * card's id, and nothing moves, reorders or widens it.
 */
export interface TaskColumn {
  readonly kind: "task"
  readonly task: TaskId
  readonly folded: boolean
}

/** What a task's strip draws: its task column, first by type, then its cards' columns. */
export type Strip = readonly [TaskColumn, ...CardColumn[]]

/** `task`'s strip: its task column, folded as `view` says, then `columns`. */
export const stripOf = (
  task: TaskId,
  view: TaskView,
  columns: readonly CardColumn[],
): Strip => [{ kind: "task", task, folded: !view.task.unfolded }, ...columns]

/** A strip's card columns: all but its task column. */
export const stripCards = ([, ...cards]: Strip): readonly CardColumn[] => cards

/** The key a strip column is drawn by: its card's, or a fresh one's thread. */
export const keyOfColumn = (c: CardColumn): string =>
  c.kind === "thread" ? c.column.key : c.card

/** How a column is read, as your view of its card says. */
const readerOf = (
  view: CardView | undefined,
): Pick<Column, "density" | "details"> => ({
  ...(view?.density === undefined ? {} : { density: view.density }),
  ...(view?.details === true ? { details: true } : {}),
})

/**
 * A task's columns: each card of its canvas in its order, and each branch
 * you have not sent just after the thread its fork is in (`branchAfter`, as
 * the host will rank its card), two at one thread in the order they were
 * opened. A thread whose root this tab does not hold yet is left out, as is
 * a branch whose fork it lacks. Pure.
 */
export function canvasColumns(input: {
  readonly canvas: readonly CanvasCard[]
  readonly view: TaskView
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  /** Each copy's fork (`TaskIndex.forkOf`): its column's end before its first send. */
  readonly forks: ReadonlyMap<ThreadId, EntryId>
  /** Each thread someone else holds in their inventory, by its holder (`heldByOthers`). */
  readonly holders: ReadonlyMap<ThreadId, WriterId>
}): readonly CardColumn[] {
  const { canvas, view, index, lanes } = input
  const onCanvas = new Set<string>(canvas.map(c => c.id))
  // Each branch not yet on the canvas, under the card index it goes after.
  const after = new Map<number, CardColumn[]>()
  for (const [thread, fresh] of [...view.fresh].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (onCanvas.has(thread) || index.entries[fresh.at] === undefined) continue
    const at = branchAfter(canvas, threadAt(index, fresh.at))
    after.set(at, [
      ...(after.get(at) ?? []),
      {
        kind: "thread",
        card: null,
        column: freshColumn(
          thread,
          fresh,
          view.cards.get(thread),
          index,
          input.holders,
        ),
        folded: false,
        width: 1,
      },
    ])
  }
  const out: CardColumn[] = [...(after.get(-1) ?? [])]
  for (const [i, c] of canvas.entries()) {
    const drawn = cardColumn(
      c,
      view.cards.get(c.id),
      index,
      lanes,
      input.forks,
      onCanvas,
    )
    if (drawn !== null) out.push(drawn)
    out.push(...(after.get(i) ?? []))
  }
  return out
}

/**
 * A card's column; null for a thread whose root this tab does not hold. A
 * copy before its first send ends at its fork, and its first send is a
 * branch there, as a fresh column's is (ADR-0117).
 */
function cardColumn(
  c: CanvasCard,
  seen: CardView | undefined,
  index: TreeIndex,
  lanes: readonly LaneView[],
  forks: ReadonlyMap<ThreadId, EntryId>,
  onCanvas: ReadonlySet<string>,
): CardColumn | null {
  const folded = seen?.unfolded !== true
  const width = c.place.width
  switch (c.kind) {
    case "thread": {
      const anchor = threadAnchor(index, lanes, c.id)
      const fork = forks.get(c.id)
      if (
        anchor === null &&
        fork !== undefined &&
        index.entries[fork] !== undefined
      )
        return {
          kind: "thread",
          card: c.id,
          column: {
            key: c.id,
            anchor: fork,
            thread: c.id,
            ...readerOf(seen),
            mode: { kind: "copy", fork },
          },
          folded,
          width,
        }
      if (anchor === null) return null
      const above = foldAboveOf(index, c.id, onCanvas)
      const column = {
        key: c.id,
        anchor,
        thread: c.id,
        ...readerOf(seen),
        ...(above === null ? {} : { foldAbove: above }),
        mode: BOUND,
      }
      return { kind: "thread", card: c.id, column, folded, width }
    }
    case "note-column":
      return { kind: "notes", card: c.id, folded, width }
    // A new kind of canvas card does not compile until it has its column.
    default:
      return c satisfies never
  }
}

/**
 * `thread`, when the thread it forks from is on no column of this canvas
 * (`onCanvas`), so its path above folds (ADR-0117); null for a thread at its
 * root, or whose parent is here.
 */
function foldAboveOf(
  index: TreeIndex,
  thread: ThreadId,
  onCanvas: ReadonlySet<string>,
): ThreadId | null {
  const first = index.firstOf.get(thread)
  const parent =
    first === undefined ? undefined : index.entries[first]?.parentId
  if (parent === undefined || parent === null) return null
  const from = threadAt(index, parent)
  return from === null || onCanvas.has(from) ? null : thread
}

/**
 * A branch's column: fresh until its thread's first entry is written, then
 * following its thread, as the card the host makes for it will.
 */
function freshColumn(
  thread: ThreadId,
  fresh: FreshColumn,
  seen: CardView | undefined,
  index: TreeIndex,
  holders: ReadonlyMap<ThreadId, WriterId>,
): Column {
  const own =
    fresh.sendId === undefined ? undefined : index.bySend.get(fresh.sendId)
  const started = own !== undefined || index.firstOf.has(thread)
  const reader = readerOf(seen)
  if (started)
    return {
      key: thread,
      anchor: threadAnchor(index, [], thread) ?? own ?? fresh.at,
      thread,
      ...reader,
      mode: BOUND,
    }
  return {
    key: thread,
    anchor: fresh.at,
    thread,
    ...reader,
    mode: {
      kind: "fresh",
      ...heldAt(index, fresh.at, holders),
      ...(fresh.sendId === undefined ? {} : { sendId: fresh.sendId }),
      ...(fresh.pending === undefined ? {} : { pending: fresh.pending }),
      ...(fresh.prefill === undefined ? {} : { prefill: fresh.prefill }),
    },
  }
}

/** The thread `at` is in, and who holds it, when someone else does (ADR-0124). */
const heldAt = (
  index: TreeIndex,
  at: EntryId,
  holders: ReadonlyMap<ThreadId, WriterId>,
): Pick<FreshMode, "held"> => {
  const thread = threadAt(index, at)
  const by = thread === null ? undefined : holders.get(thread)
  return thread === null || by === undefined ? {} : { held: { thread, by } }
}

/**
 * Each thread someone other than `me` holds in their inventory, by its
 * holder: what `canvasColumns` decides a branch not yet sent from it by.
 */
export const heldByOthers = (
  cards: readonly CardRecord[],
  me: WriterId,
): ReadonlyMap<ThreadId, WriterId> =>
  new Map(
    cards.flatMap(c =>
      c.kind === "thread" &&
      c.place.kind === "inventory" &&
      c.place.holder !== me
        ? [[c.id, c.place.holder] as const]
        : [],
    ),
  )

/** The thread columns drawn whole, in order: the paths laid out side by side (`projectColumns`). */
export const openColumns = (
  columns: readonly CardColumn[],
): readonly Column[] =>
  columns.flatMap(c => (c.kind === "thread" && !c.folded ? [c.column] : []))
