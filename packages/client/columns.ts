// client/columns — which paths of one root are open, and in what order.
//
// A view choice, never written to the document: which paths a person reads is
// theirs. `layout.ts` holds a list of these per root and stores them
// (ADR-0027, ADR-0029). Pure: a reducer over values, tested without a DOM.

import {
  type CardId,
  followTip,
  type LaneName,
  type LaneView,
  type TreeIndex,
} from "@pineta/core"

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
  readonly card?: CardId
}

export interface Column {
  /** React key; stable when columns move. */
  readonly key: string
  /**
   * The entry the column follows from (`followTip`); a bound column's is its
   * lane's tip. Null only for a fresh column at the root: a new tab's.
   */
  readonly anchor: string | null
  /**
   * The lane this column's thread is (ADR-0021). Set once the column's end is
   * exactly one lane's tip; from then on the column follows the lane, never
   * the newest leaf, and its sends name it, because a conversation forked at
   * the lane's tip is newer and is another thread.
   */
  readonly lane?: LaneName
  /** A Start Agent column: a message with no mention asks the agent. */
  readonly asksAgent?: true
  /**
   * A fresh column: nothing of its own yet. Once its first message is sent,
   * `sendId` is that send's id, and `sync` anchors the column at the entry it
   * wrote (`TreeIndex.bySend`): exactly, whatever else appeared meanwhile.
   * `pending` is a first message to send on opening ("branch here" after a
   * conflict), sent by the column's own composer so its outcome shows there.
   * `prefill` is what its composer starts with.
   */
  readonly fresh?: {
    readonly sendId?: string
    readonly pending?: Pending
    readonly prefill?: Prefill
  }
}

export type ColumnAction =
  /** Open a path next to the column it forks from. `key` comes from the shell. */
  | {
      readonly kind: "open"
      readonly key: string
      readonly after: number
      readonly anchor: string
    }
  /** Open a fresh column after column `after`: a branch at `at`. */
  | {
      readonly kind: "openFresh"
      readonly key: string
      readonly at: string
      readonly after: number
      /** A first message the column sends as soon as it opens. */
      readonly pending?: Pending
      /** What its composer starts with, unsent. */
      readonly prefill?: Prefill
    }
  /** A fresh column sent its first message, as send `sendId`. */
  | { readonly kind: "sent"; readonly key: string; readonly sendId: string }
  | { readonly kind: "close"; readonly index: number }
  /** Move column `from` to index `to` (`reorder.ts`); the rest keep their order. */
  | { readonly kind: "move"; readonly from: number; readonly to: number }
  | {
      readonly kind: "sync"
      readonly index: TreeIndex
      readonly lanes: readonly LaneView[]
    }
  /** Drop restored columns whose anchor the settled document does not have. */
  | { readonly kind: "prune"; readonly index: TreeIndex }

/** Whether a column's path ends at its anchor (`ColumnSpec.pinned`). */
export const isPinned = (c: Column): boolean =>
  c.fresh !== undefined || c.lane !== undefined

/** Insert `column` after position `after`, clamped to the list. */
const placeAfter = (
  state: readonly Column[],
  after: number,
  column: Column,
): readonly Column[] => {
  const at = Math.min(Math.max(after + 1, 0), state.length)
  return [...state.slice(0, at), column, ...state.slice(at)]
}

/**
 * One root's columns. `close` and `prune` may leave none: the layout then
 * gives the root its first column again (`columnsOf`).
 */
export function columnsReducer(
  state: readonly Column[],
  action: ColumnAction,
): readonly Column[] {
  switch (action.kind) {
    case "open":
      return placeAfter(state, action.after, {
        key: action.key,
        anchor: action.anchor,
      })
    case "openFresh":
      return placeAfter(state, action.after, {
        key: action.key,
        anchor: action.at,
        fresh: {
          ...(action.pending === undefined ? {} : { pending: action.pending }),
          ...(action.prefill === undefined ? {} : { prefill: action.prefill }),
        },
      })
    case "sent":
      return state.map(c =>
        c.key === action.key && c.fresh !== undefined
          ? { ...c, fresh: { sendId: action.sendId } }
          : c,
      )
    case "close":
      return state.filter((_, i) => i !== action.index)
    case "move": {
      const column = state[action.from]
      const to = Math.min(Math.max(action.to, 0), state.length - 1)
      if (column === undefined || to === action.from) return state
      const rest = state.filter((_, i) => i !== action.from)
      return [...rest.slice(0, to), column, ...rest.slice(to)]
    }
    case "sync":
      return syncColumns(state, action.index, action.lanes)
    case "prune": {
      const known = state.filter(
        c => c.anchor === null || action.index.entries[c.anchor] !== undefined,
      )
      return known.length === state.length ? state : known
    }
  }
}

/**
 * Settle columns against the tree, once per change.
 *
 * - A fresh column waits for the entry its send wrote, then anchors there.
 * - A bound column follows its lane: its anchor is the lane's tip.
 * - Any other column follows its own path: its anchor ADVANCES to its tip
 *   (`followTip`), so a reply below its last message moves it on, and a branch
 *   off an earlier message never does. When the tip is exactly one lane's,
 *   the column binds.
 *
 * Returns `state` itself when nothing changes, so React skips the render.
 */
function syncColumns(
  state: readonly Column[],
  index: TreeIndex,
  lanes: readonly LaneView[],
): readonly Column[] {
  let changed = false
  const next = state.map(column => {
    const settled = settle(column, index, lanes)
    if (settled !== column) changed = true
    return settled
  })
  return changed ? next : state
}

function settle(
  column: Column,
  index: TreeIndex,
  lanes: readonly LaneView[],
): Column {
  const { fresh, lane, ...rest } = column
  if (fresh !== undefined) {
    const own =
      fresh.sendId === undefined ? undefined : index.bySend.get(fresh.sendId)
    // Anchored at its own message, it follows like any column from here.
    return own === undefined
      ? column
      : settle({ ...rest, anchor: own }, index, lanes)
  }
  if (lane !== undefined) {
    const tip = lanes.find(l => l.name === lane)?.tip ?? null
    return tip === null || tip === column.anchor
      ? column
      : { ...column, anchor: tip }
  }
  // Only a fresh column has no anchor, and it was settled above.
  if (column.anchor === null) return column
  const tip = followTip(index, column.anchor)
  const ending = lanes.filter(l => l.tip === tip)
  const bound = ending.length === 1 ? ending[0]?.name : undefined
  if (tip === column.anchor && bound === undefined) return column
  return {
    ...rest,
    anchor: tip,
    ...(bound === undefined ? {} : { lane: bound }),
  }
}
