// interface/columns — a thread's column as the page draws it.

import {
  type CardId,
  type EntryId,
  type LaneView,
  type NoteColumnId,
  type ReferenceCardId,
  type RootId,
  type TaskId,
  type TextCardId,
  type ThreadId,
  type TreeIndex,
  threadEnd,
  type WriterId,
} from "@pinetrie/core"
import type { Density } from "./ask-words.ts"

/**
 * Text an unstarted thread's composer starts with, unsent. A blank one means
 * nothing sent alone (a branch's `@agent `); anything else is content, which
 * sent unchanged is still a message (an edit's text: a retry).
 */
export interface Prefill {
  readonly text: string
  readonly blank: boolean
}

/**
 * A first message an unstarted thread's column sends as it opens ('branch
 * here' after a conflict), and the card it came from, which that send
 * spends.
 */
export interface Pending {
  readonly text: string
  readonly card?: TextCardId
}

/**
 * What the shell mints for one intent: a key, the root and the task a new
 * tab opens, the thread a column opens, and a note column made on a canvas.
 */
export interface Minted {
  readonly key: string
  readonly root: RootId
  readonly task: TaskId
  readonly thread: ThreadId
  readonly noteColumn: NoteColumnId
  /** A reference a paste makes where it lands. */
  readonly reference: ReferenceCardId
  /** A text card a paste makes where it lands. */
  readonly text: TextCardId
}

export interface Column {
  /** React key; stable when columns move. */
  readonly key: string
  /**
   * Where the column's path ends: its thread's end (`threadEnd`), or an
   * unstarted thread's fork. Null only for an unstarted new root's thread: a
   * new tab's.
   */
  readonly anchor: EntryId | null
  /**
   * The thread it shows, which names its lane when it has one
   * (`laneOf`). A column opens its thread before its first send.
   */
  readonly thread: ThreadId
  /** A Start Agent column: a message with no mention asks the agent. */
  readonly asksAgent?: true
  /**
   * Its own thread, when the thread it forks from is on no column of its
   * canvas: the path above the thread's first message folds
   * behind its fork row.
   */
  readonly foldAbove?: ThreadId
  /**
   * How much of each ask is drawn; absent is story. The reader's
   * choice, never the document's.
   */
  readonly density?: Density
  /**
   * The thread's details are open under the header. The reader's
   * choice, never the document's.
   */
  readonly details?: true
  /**
   * How its next send writes: at its thread's end; or, not yet
   * started, as a branch at its anchor, its thread's first message.
   */
  readonly mode: ColumnMode
}

/**
 * A thread not yet started: its card is on its task's canvas,
 * shared, and its first send writes its first entry, a branch at `fork`, or
 * a new root's first for null, in `root`. `held`: the thread it forks from,
 * when someone else holds it: its entries are left out, the
 * column says who has it, and a send there is refused until it is on a
 * canvas again. `pending` and `prefill` are the opener's own (`CardView`).
 */
export interface UnstartedMode {
  readonly kind: "unstarted"
  readonly fork: EntryId | null
  readonly root: RootId
  readonly held?: { readonly thread: ThreadId; readonly by: WriterId }
  readonly pending?: Pending
  readonly prefill?: Prefill
}

/**
 * How a column's next send writes: `bound` at its thread's end;
 * `unstarted`, its thread's first message (`UnstartedMode`).
 */
export type ColumnMode = { readonly kind: "bound" } | UnstartedMode

/** A column's unstarted mode, or undefined for a bound one. */
export const unstartedOf = (
  column: Pick<Column, "mode">,
): UnstartedMode | undefined =>
  column.mode.kind === "unstarted" ? column.mode : undefined

/** A bound column's mode. */
export const BOUND: ColumnMode = { kind: "bound" }

/** Whether a column's next send is a branch at its anchor: its thread's first. */
export const branchesAt = (column: Pick<Column, "mode">): boolean =>
  column.mode.kind !== "bound"

/**
 * Which column something is said or done in, by kind, carried
 * in an intent so what each kind allows is the type's: a card's column on
 * the canvas folds, moves and, unstarted, closes; the task column holds the
 * task's pins. `keyText` is its key as the page draws it.
 */
export type ColumnKey =
  | { readonly kind: "card"; readonly card: CardId }
  | { readonly kind: "task"; readonly task: TaskId }

/** A card's column on the canvas: it folds and moves. */
export type CardKey = Extract<ColumnKey, { kind: "card" }>

/**
 * A column's key as text: a card's id, a task's id. It holds no `:`, as no
 * key may (`readingKey`).
 */
export const keyText = (key: ColumnKey): string =>
  key.kind === "card" ? key.card : key.task

/**
 * A reader's setting: how much of each ask a column
 * draws, and whether its thread's details are open.
 */
export type ReaderAction =
  | { readonly kind: "density"; readonly density: Density }
  | { readonly kind: "details"; readonly open: boolean }

/**
 * Where a thread's column ends: its thread's end (`threadEnd`), or, before
 * its first entry is written, its lane's tip, which holds its fork. Null for
 * a thread neither shows: one whose root this tab does not hold.
 */
export const threadAnchor = (
  index: TreeIndex,
  lanes: readonly LaneView[],
  thread: ThreadId,
): EntryId | null =>
  threadEnd(index, thread) ?? lanes.find(l => l.name === thread)?.tip ?? null
