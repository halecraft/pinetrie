// interface/columns — a thread's column as the page draws it, and a new tab's
// one column, which is the layout's until its first message is written.
//
// Which columns a task shows, and in what order, is its canvas's
// (`canvas-columns.ts`, ADR-0116); a new tab has no canvas yet, so its
// column is kept here, in this browser tab's view state (ADR-0027). Pure: a
// reducer over values, tested without a DOM.

import {
  type CardId,
  type EntryId,
  type LaneView,
  type NoteColumnId,
  type RootId,
  type TaskId,
  type TextCardId,
  type ThreadId,
  type TreeIndex,
  threadEnd,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { Density } from "./ask-words.ts"

/**
 * Text a fresh column's composer starts with, unsent. A blank one means
 * nothing sent alone (a branch's `@agent `); anything else is content, which
 * sent unchanged is still a message (an edit's text: a retry).
 */
export interface Prefill {
  readonly text: string
  readonly blank: boolean
}

/**
 * A first message a fresh column sends as it opens ('branch here' after a
 * conflict), and the card it came from, which that send spends (ADR-0048).
 */
export interface Pending {
  readonly text: string
  readonly card?: TextCardId
}

/**
 * What the shell mints for one intent: a key, the root and the task a new
 * tab keeps (ADR-0066, ADR-0116), the thread a fresh column's first send
 * starts (ADR-0117), and a note column made on a canvas (ADR-0116).
 */
export interface Minted {
  readonly key: string
  readonly root: RootId
  readonly task: TaskId
  readonly thread: ThreadId
  readonly noteColumn: NoteColumnId
}

export interface Column {
  /** React key; stable when columns move. */
  readonly key: string
  /**
   * Where the column's path ends: its thread's end (`threadEnd`), or a fresh
   * column's fork. Null only for a fresh column at the root: a new tab's.
   */
  readonly anchor: EntryId | null
  /**
   * The thread it shows (ADR-0117), which names its lane when it has one
   * (`laneOf`). A fresh column's is minted as it opens, for its first send to
   * start.
   */
  readonly thread: ThreadId
  /** A Start Agent column: a message with no mention asks the agent. */
  readonly asksAgent?: true
  /**
   * How much of each ask is drawn (ADR-0106); absent is story. The reader's
   * choice, never the document's.
   */
  readonly density?: Density
  /**
   * The thread's details are open under the header (ADR-0073). The reader's
   * choice, never the document's.
   */
  readonly details?: true
  /**
   * A fresh column: nothing of its own yet. Once its first message is sent,
   * `sendId` is that send's id, and `sync` anchors the column at the entry it
   * wrote (`TreeIndex.bySend`): exactly, whatever else appeared meanwhile.
   * `pending` is a first message to send on opening ("branch here" after a
   * conflict), sent by the column's own composer so its outcome shows there.
   * `prefill` is what its composer starts with. `root` is a new tab's
   * root, minted as it opens (ADR-0066): its cards and its first send name
   * it. A branch's root is its tab's. `task` is a new tab's task, minted
   * with its root (ADR-0116): its first send starts it, and its cards'
   * places and their moves' history name it. `state` is the workflow state
   * a new tab opened from a board column lands its task in (ADR-0122).
   */
  readonly fresh?: {
    readonly sendId?: string
    readonly pending?: Pending
    readonly prefill?: Prefill
    readonly root?: RootId
    readonly task?: TaskId
    readonly state?: WorkflowStateId
  }
}

/**
 * Which column something is said or done in, by kind (ADR-0116), carried
 * in an intent so what each kind allows is the type's: a card's column on
 * the canvas folds and moves; a branch not yet sent and a new tab's column
 * close; the task column holds the task's pins. `keyText` is its key as the
 * page draws it.
 */
export type ColumnKey =
  | { readonly kind: "card"; readonly card: CardId }
  | { readonly kind: "fresh"; readonly thread: ThreadId }
  | { readonly kind: "newTab"; readonly thread: ThreadId }
  | { readonly kind: "task"; readonly task: TaskId }

/** A card's column on the canvas: it folds and moves. */
export type CardKey = Extract<ColumnKey, { kind: "card" }>

/** A column yours alone until its first send: a branch's, or a new tab's. */
export type FreshKey = Extract<ColumnKey, { kind: "fresh" | "newTab" }>

/**
 * A column's key as text: a card's id, the thread a branch or a new tab
 * minted, a task's id. It holds no `:`, as no key may (`readingKey`).
 */
export const keyText = (key: ColumnKey): string => {
  switch (key.kind) {
    case "card":
      return key.card
    case "fresh":
    case "newTab":
      return key.thread
    case "task":
      return key.task
  }
}

/** What happens to a new tab's one column (`newTabReducer`). */
export type NewTabAction =
  /** Its first message was sent, as send `sendId`. */
  | { readonly kind: "sent"; readonly sendId: string }
  | ReaderAction
  | {
      readonly kind: "sync"
      readonly index: TreeIndex
      readonly lanes: readonly LaneView[]
    }

/**
 * A reader's setting (ADR-0106, ADR-0073): how much of each ask a column
 * draws, and whether its thread's details are open.
 */
export type ReaderAction =
  | { readonly kind: "density"; readonly density: Density }
  | { readonly kind: "details"; readonly open: boolean }

/** A new tab's column, changed by `action`; the same column when nothing changes. */
export function newTabReducer(column: Column, action: NewTabAction): Column {
  switch (action.kind) {
    case "sent":
      return column.fresh === undefined
        ? column
        : {
            ...column,
            // A new tab keeps its task: once written, it is that task's.
            fresh: {
              sendId: action.sendId,
              ...(column.fresh.task === undefined
                ? {}
                : { task: column.fresh.task }),
            },
          }
    case "density":
      return column.density === action.density
        ? column
        : { ...column, density: action.density }
    case "details": {
      if ((column.details === true) === action.open) return column
      const { details: _, ...rest } = column
      return action.open ? { ...rest, details: true } : rest
    }
    case "sync":
      return settle(column, action.index, action.lanes)
  }
}

/**
 * A column settled against the tree:
 *
 * - A fresh column waits for the entry its send wrote (`TreeIndex.bySend`),
 *   or for its thread's first entry, sent from another browser tab, then
 *   follows its thread.
 * - Every other column's anchor is its thread's end (`threadEnd`, ADR-0117):
 *   a reply moves it on, and a branch, which starts another thread, never
 *   does. Before its first entry is written, a thread's lane holds its fork.
 *
 * The same column when nothing changes.
 */
export function settle(
  column: Column,
  index: TreeIndex,
  lanes: readonly LaneView[],
): Column {
  const { fresh, ...rest } = column
  if (fresh !== undefined) {
    const own =
      fresh.sendId === undefined ? undefined : index.bySend.get(fresh.sendId)
    // Its thread started from another browser tab holding the same column.
    const started = index.firstOf.has(column.thread)
    // Anchored at its own message, it follows its thread from here.
    return own === undefined && !started
      ? column
      : settle({ ...rest, anchor: own ?? column.anchor }, index, lanes)
  }
  const end = threadAnchor(index, lanes, column.thread) ?? column.anchor
  return end === column.anchor ? column : { ...column, anchor: end }
}

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
