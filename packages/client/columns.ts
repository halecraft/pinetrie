// client/columns — which paths are open, and in what order.
//
// The only client-local state the interface keeps, besides text being typed.
// It is a view choice, never written to the document: which paths a person
// reads is theirs. The browser keeps it per tab (ADR-0027, the stored form at
// the end of this file). Pure: a reducer over values, tested without a DOM.

import {
  followTip,
  isLaneName,
  type LaneName,
  type LaneView,
  type TreeIndex,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

export interface Column {
  /** React key; stable when columns move. */
  readonly key: string
  /**
   * The entry the column follows from (`followTip`); a bound column's is its
   * lane's tip. Null before the session has a message, or for a fresh column
   * at the root.
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
   * `pending` is a first message to send on opening ("Branch here" after a
   * conflict), sent by the column's own composer so its outcome shows there.
   */
  readonly fresh?: { readonly sendId?: string; readonly pending?: string }
}

/** Where a new column goes. */
export type Place =
  | { readonly after: number }
  /** In place of a column: the empty session's first, when a start is chosen. */
  | { readonly replace: number }
  | { readonly end: true }

export type ColumnAction =
  /** Open a path next to the column it forks from. `key` comes from the shell. */
  | {
      readonly kind: "open"
      readonly key: string
      readonly after: number
      readonly anchor: string
    }
  /** Open a fresh column: a branch at `at`, or a new thread at the root (null). */
  | {
      readonly kind: "openFresh"
      readonly key: string
      readonly at: string | null
      readonly asksAgent: boolean
      readonly place: Place
      /** A first message the column sends as soon as it opens. */
      readonly text?: string
    }
  /** A fresh column sent its first message, as send `sendId`. */
  | { readonly kind: "sent"; readonly key: string; readonly sendId: string }
  | { readonly kind: "close"; readonly index: number }
  | { readonly kind: "makeMain"; readonly index: number }
  | {
      readonly kind: "sync"
      readonly index: TreeIndex
      readonly lanes: readonly LaneView[]
    }
  /** Drop restored columns whose anchor the settled document does not have. */
  | { readonly kind: "prune"; readonly index: TreeIndex }

/**
 * One column, following the newest thread until `sync` pins it: a new tab
 * with nothing stored, or what is left when every column is closed or pruned.
 */
export const initialColumns = (): readonly Column[] => [
  { key: "first", anchor: null },
]

/** Whether a column's path ends at its anchor (`ColumnSpec.pinned`). */
export const isPinned = (c: Column): boolean =>
  c.fresh !== undefined || c.lane !== undefined

const place = (
  state: readonly Column[],
  where: Place,
  column: Column,
): readonly Column[] => {
  if ("replace" in where)
    return state.map((c, i) => (i === where.replace ? column : c))
  const at =
    "end" in where
      ? state.length
      : Math.min(Math.max(where.after + 1, 0), state.length)
  return [...state.slice(0, at), column, ...state.slice(at)]
}

export function columnsReducer(
  state: readonly Column[],
  action: ColumnAction,
): readonly Column[] {
  switch (action.kind) {
    case "open":
      return place(
        state,
        { after: action.after },
        { key: action.key, anchor: action.anchor },
      )
    case "openFresh":
      return place(state, action.place, {
        key: action.key,
        anchor: action.at,
        fresh: action.text === undefined ? {} : { pending: action.text },
        ...(action.asksAgent ? { asksAgent: true } : {}),
      })
    case "sent":
      return state.map(c =>
        c.key === action.key && c.fresh !== undefined
          ? { ...c, fresh: { sendId: action.sendId } }
          : c,
      )
    case "close": {
      const rest = state.filter((_, i) => i !== action.index)
      return rest.length > 0 ? rest : initialColumns()
    }
    case "makeMain": {
      const column = state[action.index]
      if (column === undefined || action.index === 0) return state
      return [column, ...state.filter((_, i) => i !== action.index)]
    }
    case "sync":
      return syncColumns(state, action.index, action.lanes)
    case "prune": {
      const known = state.filter(
        c => c.anchor === null || action.index.entries[c.anchor] !== undefined,
      )
      if (known.length === state.length) return state
      return known.length > 0 ? known : initialColumns()
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
 *   off an earlier message never does. A null anchor pins to the newest leaf
 *   once there is one. When the tip is exactly one lane's, the column binds.
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
  const tip = followTip(index, column.anchor)
  if (tip === null) return column
  const ending = lanes.filter(l => l.tip === tip)
  const bound = ending.length === 1 ? ending[0]?.name : undefined
  if (tip === column.anchor && bound === undefined) return column
  return {
    ...rest,
    anchor: tip,
    ...(bound === undefined ? {} : { lane: bound }),
  }
}

// ── stored form (ADR-0027) ────────────────────────────────────────────────
//
// Kept per tab through `tab-state.ts`. Built field by field both ways, so a
// field the schema does not name is never stored or restored. `fresh.pending`
// is one: restoring it would send its message again.

const StoredColumn = Type.Object({
  key: Type.String(),
  anchor: Type.Union([Type.String(), Type.Null()]),
  lane: Type.Optional(Type.String()),
  asksAgent: Type.Optional(Type.Literal(true)),
  fresh: Type.Optional(Type.Object({ sendId: Type.Optional(Type.String()) })),
})

/** `v` changes when the shape does; an older layout is dropped, not migrated. */
const StoredColumns = Type.Object({
  v: Type.Literal(1),
  columns: Type.Array(StoredColumn, { minItems: 1 }),
})

type Stored = Static<typeof StoredColumn>

const toStored = (c: Column): Stored => ({
  key: c.key,
  anchor: c.anchor,
  ...(c.lane === undefined ? {} : { lane: c.lane }),
  ...(c.asksAgent ? { asksAgent: true } : {}),
  ...(c.fresh === undefined
    ? {}
    : {
        fresh: c.fresh.sendId === undefined ? {} : { sendId: c.fresh.sendId },
      }),
})

const fromStored = (s: Stored): Column => ({
  key: s.key,
  anchor: s.anchor,
  // Unrecognised, it is left off: `sync` binds the column again once its tip
  // is exactly one lane's.
  ...(s.lane !== undefined && isLaneName(s.lane) ? { lane: s.lane } : {}),
  ...(s.asksAgent ? { asksAgent: true } : {}),
  ...(s.fresh === undefined
    ? {}
    : {
        fresh: s.fresh.sendId === undefined ? {} : { sendId: s.fresh.sendId },
      }),
})

export const encodeColumns = (
  columns: readonly Column[],
): Static<typeof StoredColumns> => ({ v: 1, columns: columns.map(toStored) })

/**
 * A stored layout, whole or not at all: only this build writes it, so a
 * half-valid one is not worth keeping. Total.
 */
export const decodeColumns = (raw: unknown): readonly Column[] | undefined =>
  Value.Check(StoredColumns, raw) ? raw.columns.map(fromStored) : undefined
