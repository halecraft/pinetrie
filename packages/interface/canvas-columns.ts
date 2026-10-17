// interface/canvas-columns — a canvas's columns, from its canvas.
//
// The order is the canvas's alone, the same for everyone. What is yours, the
// canvas's view (`YourCanvasView`), holds maps and a flag and no list, so it has
// nowhere to keep an order of its own.

import {
  type CanvasId,
  type CardId,
  type CardRecord,
  type CardWidth,
  type EntryId,
  type LaneView,
  type NoteColumnId,
  type ThreadId,
  type TreeIndex,
  threadAt,
  type WriterId,
} from "@pinetrie/core"
import type { CardOnCanvas, ThreadOpening } from "@pinetrie/rules"
import type { Density } from "./ask-words.ts"
import {
  BOUND,
  type Column,
  type Pending,
  type Prefill,
  threadAnchor,
  type UnstartedMode,
} from "./columns.ts"

/** Your view of one column, by its card: none of it is shared. */
export interface CardView {
  /** Drawn whole; else a narrow strip with its title. */
  readonly unfolded?: true
  /** How much of each ask is drawn; absent is story. */
  readonly density?: Density
  /** The thread's details are open under the header. */
  readonly details?: true
  /**
   * A thread you opened, until its first send: a first message
   * its column sends as it opens ("branch here" after a conflict), never
   * stored, since a reload would send it twice.
   */
  readonly pending?: Pending
  /** What a thread you opened starts its composer with, unsent. */
  readonly prefill?: Prefill
}

/**
 * Your view of one canvas: maps and a flag, so no order can be kept in it.
 * The canvas column is no card, so its fold is apart.
 */
export interface YourCanvasView {
  /** Your view of each column, by its card (a thread card's id is its thread's). */
  readonly cards: ReadonlyMap<CardId, CardView>
  /** The canvas column's fold. */
  readonly canvas: { readonly unfolded: boolean }
}

/**
 * A canvas's view before you change it: only its first card unfolded, since a
 * canvas can hold many threads, and the canvas column folded.
 */
export const defaultView = (first: CardId | null): YourCanvasView => ({
  cards: first === null ? new Map() : new Map([[first, { unfolded: true }]]),
  canvas: { unfolded: false },
})

/** The view of a canvas: as kept, else `defaultView` for its canvas. */
export const viewOf = (
  views: ReadonlyMap<string, YourCanvasView>,
  canvas: string,
  cards: readonly CardOnCanvas[],
): YourCanvasView => views.get(canvas) ?? defaultView(cards[0]?.id ?? null)

/** One column of a canvas, as the strip draws it. */
export type CardColumn =
  | {
      readonly kind: "thread"
      readonly card: ThreadId
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
 * The canvas column: the canvas's own place on its canvas, drawn
 * before every card and outside the order. It is no card, so it has no
 * card's id, and nothing moves, reorders or widens it.
 */
export interface CanvasColumn {
  readonly kind: "canvas"
  readonly canvas: CanvasId
  readonly folded: boolean
}

/** What a canvas's strip draws: its canvas column, first by type, then its cards' columns. */
export type Strip = readonly [CanvasColumn, ...CardColumn[]]

/** `canvas`'s strip: its canvas column, folded as `view` says, then `columns`. */
export const stripOf = (
  canvas: CanvasId,
  view: YourCanvasView,
  columns: readonly CardColumn[],
): Strip => [
  { kind: "canvas", canvas, folded: !view.canvas.unfolded },
  ...columns,
]

/** A strip's card columns: all but its canvas column. */
export const stripCards = ([, ...cards]: Strip): readonly CardColumn[] => cards

/** How a column is read, as your view of its card says. */
const readerOf = (
  view: CardView | undefined,
): Pick<Column, "density" | "details"> => ({
  ...(view?.density === undefined ? {} : { density: view.density }),
  ...(view?.details === true ? { details: true } : {}),
})

/**
 * A canvas's columns: each card of its canvas in its order. A thread whose
 * root this tab does not hold yet is left out.
 */
export function canvasColumns(input: {
  readonly onCanvas: readonly CardOnCanvas[]
  readonly view: YourCanvasView
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  /** Each thread opened and not yet started (`unstartedThreads`): where its column ends. */
  readonly unstarted: ReadonlyMap<ThreadId, ThreadOpening>
  /** Each thread someone else holds in their inventory, by its holder (`heldByOthers`). */
  readonly holders: ReadonlyMap<ThreadId, WriterId>
}): readonly CardColumn[] {
  const ids = new Set<string>(input.onCanvas.map(c => c.id))
  return input.onCanvas.flatMap(c => {
    const drawn = cardColumn(c, input.view.cards.get(c.id), input, ids)
    return drawn === null ? [] : [drawn]
  })
}

/**
 * A card's column; null for a thread whose root this tab does not hold. A
 * thread not yet started ends at its fork, or, a new canvas's, at its root,
 * and its first send is a branch there.
 */
function cardColumn(
  c: CardOnCanvas,
  seen: CardView | undefined,
  facts: Pick<
    Parameters<typeof canvasColumns>[0],
    "index" | "lanes" | "unstarted" | "holders"
  >,
  onCanvas: ReadonlySet<string>,
): CardColumn | null {
  const { index } = facts
  const folded = seen?.unfolded !== true
  const width = c.place.width
  switch (c.kind) {
    case "thread": {
      const opening = facts.unstarted.get(c.id)
      if (opening !== undefined)
        return {
          kind: "thread",
          card: c.id,
          column: {
            key: c.id,
            anchor: opening.fork,
            thread: c.id,
            ...readerOf(seen),
            mode: {
              kind: "unstarted",
              fork: opening.fork,
              root: opening.root,
              ...(opening.fork === null
                ? {}
                : heldAt(index, opening.fork, facts.holders)),
              ...(seen?.pending === undefined ? {} : { pending: seen.pending }),
              ...unstartedPrefill(seen, opening),
            },
          },
          folded,
          width,
        }
      const anchor = threadAnchor(index, facts.lanes, c.id)
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
 * What an unstarted thread's composer starts with: your own prefill on this
 * device, else a proposal's brief for the one who opened it (`proposalDraft`),
 * as content, so it is sent as it reads.
 */
const unstartedPrefill = (
  seen: CardView | undefined,
  opening: ThreadOpening,
): Pick<UnstartedMode, "prefill"> =>
  seen?.prefill !== undefined
    ? { prefill: seen.prefill }
    : opening.draft !== undefined
      ? { prefill: { text: opening.draft, blank: false } }
      : {}

/**
 * `thread`, when the thread it forks from is on no column of this canvas
 * (`onCanvas`), so its path above folds; null for a thread at its
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

/** The thread `at` is in, and who holds it, when someone else does. */
const heldAt = (
  index: TreeIndex,
  at: EntryId,
  holders: ReadonlyMap<ThreadId, WriterId>,
): Pick<UnstartedMode, "held"> => {
  const thread = threadAt(index, at)
  const by = thread === null ? undefined : holders.get(thread)
  return thread === null || by === undefined ? {} : { held: { thread, by } }
}

/**
 * Each thread someone other than `me` holds in their inventory, by its
 * holder: what `canvasColumns` decides a thread not yet started from it by.
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
