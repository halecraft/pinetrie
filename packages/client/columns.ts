// client/columns — which paths of one root are open, and in what order.
//
// A view choice, never written to the document: which paths a person reads is
// theirs. `layout.ts` holds a list of these per root and stores them
// (ADR-0027, ADR-0029). Pure: a reducer over values, tested without a DOM.

import {
  type CardId,
  type EntryId,
  followTip,
  type LaneName,
  type LaneView,
  type RootId,
  type TreeIndex,
  type WorkSetting,
} from "@pineta/core"
import type { Density } from "./ask-words.ts"

/**
 * Text a fresh column's composer starts with, unsent. A blank one means
 * nothing sent alone (a branch's `@agent `); anything else is content, which
 * sent unchanged is still a message (an edit's text: a retry).
 */
export interface Prefill {
  readonly text: string
  readonly blank: boolean
  /**
   * Where a lane its send creates works, chosen for you: "resolve with the
   * agent" works in your files (ADR-0061). Absent, the default (`workFor`).
   */
  readonly work?: WorkSetting
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
  readonly anchor: EntryId | null
  /**
   * The lane this column's thread is (ADR-0021). Set once its reserved lane
   * has a tip, or else once the column's end is exactly one lane's tip; from
   * then on the column follows the lane, never the newest leaf, and its sends
   * name it, because a conversation forked at the lane's tip is newer and is
   * another thread.
   */
  readonly lane?: LaneName
  /**
   * The id of the lane this column's next send would create, made before the
   * lane exists so its thread is named at once (ADR-0057). Dropped as the
   * column binds.
   */
  readonly reserved?: LaneName
  /** A Start Agent column: a message with no mention asks the agent. */
  readonly asksAgent?: true
  /**
   * How much of each ask is drawn (ADR-0056); absent is story. The reader's
   * choice, never the document's.
   */
  readonly density?: Density
  /**
   * A fresh column: nothing of its own yet. Once its first message is sent,
   * `sendId` is that send's id, and `sync` anchors the column at the entry it
   * wrote (`TreeIndex.bySend`): exactly, whatever else appeared meanwhile.
   * `pending` is a first message to send on opening ("branch here" after a
   * conflict), sent by the column's own composer so its outcome shows there.
   * `prefill` is what its composer starts with. `root` is a new tab's
   * root, minted as it opens (ADR-0066): its cards and its first send name
   * it. A branch's root is its tab's.
   */
  readonly fresh?: {
    readonly sendId?: string
    readonly pending?: Pending
    readonly prefill?: Prefill
    readonly root?: RootId
  }
}

export type ColumnAction =
  /** Open a path next to the column it forks from. `key` comes from the shell. */
  | {
      readonly kind: "open"
      readonly key: string
      readonly after: number
      readonly anchor: EntryId
    }
  /** Open a fresh column after column `after`: a branch at `at`. */
  | {
      readonly kind: "openFresh"
      readonly key: string
      readonly at: EntryId
      readonly after: number
      /** A first message the column sends as soon as it opens. */
      readonly pending?: Pending
      /** What its composer starts with, unsent. */
      readonly prefill?: Prefill
    }
  /** A fresh column sent its first message, as send `sendId`. */
  | { readonly kind: "sent"; readonly key: string; readonly sendId: string }
  /** Column `key` keeps `lane` as the id its next send creates a lane under. */
  | { readonly kind: "reserve"; readonly key: string; readonly lane: LaneName }
  | { readonly kind: "close"; readonly index: number }
  /** Move column `from` to index `to` (`reorder.ts`); the rest keep their order. */
  | { readonly kind: "move"; readonly from: number; readonly to: number }
  /** Read column `index` at `density` (ADR-0056). */
  | {
      readonly kind: "density"
      readonly index: number
      readonly density: Density
    }
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
    case "reserve": {
      // The same state when no column takes it: a root with no stored columns
      // would otherwise store its first one.
      const at = state.findIndex(
        c => c.key === action.key && c.lane === undefined,
      )
      const column = state[at]
      if (column === undefined || column.reserved === action.lane) return state
      return state.with(at, { ...column, reserved: action.lane })
    }
    case "close":
      return state.filter((_, i) => i !== action.index)
    case "move": {
      const column = state[action.from]
      const to = Math.min(Math.max(action.to, 0), state.length - 1)
      if (column === undefined || to === action.from) return state
      const rest = state.filter((_, i) => i !== action.from)
      return [...rest.slice(0, to), column, ...rest.slice(to)]
    }
    case "density":
      return state.map((c, i) =>
        i === action.index ? { ...c, density: action.density } : c,
      )
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
 * - A column whose reserved lane has a tip binds to it, by id (ADR-0057).
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
  const { fresh, lane, reserved, ...rest } = column
  if (reserved !== undefined) {
    // Its own lane, known by id: no waiting for its tip to be one lane's.
    const tip = lanes.find(l => l.name === reserved)?.tip ?? null
    if (tip !== null) return { ...rest, anchor: tip, lane: reserved }
  }
  // Kept until the column binds: a conversation may yet ask the agent.
  const kept = reserved === undefined ? {} : { reserved }
  if (fresh !== undefined) {
    const own =
      fresh.sendId === undefined ? undefined : index.bySend.get(fresh.sendId)
    // Anchored at its own message, it follows like any column from here.
    return own === undefined
      ? column
      : settle({ ...rest, ...kept, anchor: own }, index, lanes)
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
  return bound === undefined
    ? { ...rest, ...kept, anchor: tip }
    : { ...rest, anchor: tip, lane: bound }
}
