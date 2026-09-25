// client/columns — which paths are open, and in what order.
//
// The only client-local state the interface keeps, besides text being typed.
// It is a view choice, never written to the document: which paths a person
// reads is theirs. Pure: a reducer over values, tested without a DOM.

import { followTip, type TreeIndex } from "@pineta/core"

export interface Column {
  /** React key; stable when columns move. */
  readonly key: string
  /**
   * The entry the column follows from (`followTip`). Null only before the
   * session has a message: `sync` pins it to the first thread.
   */
  readonly anchor: string | null
  /**
   * A fresh branch's children of `anchor` that existed when it opened, sorted.
   * Present only until the branch's first message exists.
   */
  readonly exclude?: readonly string[]
}

export type ColumnAction =
  /** Open a path next to the column it forks from. `key` comes from the shell. */
  | {
      readonly kind: "open"
      readonly key: string
      readonly after: number
      readonly anchor: string
    }
  /** Open a fresh branch at a message, next to the column showing it. */
  | {
      readonly kind: "branch"
      readonly key: string
      readonly after: number
      readonly at: string
      readonly existing: readonly string[]
    }
  | { readonly kind: "close"; readonly index: number }
  | { readonly kind: "makeMain"; readonly index: number }
  | { readonly kind: "sync"; readonly index: TreeIndex }

/** One column, following the newest thread until `sync` pins it. */
export const initialColumns = (): readonly Column[] => [
  { key: "first", anchor: null },
]

const insertAfter = (
  state: readonly Column[],
  after: number,
  column: Column,
): readonly Column[] => {
  const at = Math.min(Math.max(after + 1, 0), state.length)
  return [...state.slice(0, at), column, ...state.slice(at)]
}

export function columnsReducer(
  state: readonly Column[],
  action: ColumnAction,
): readonly Column[] {
  switch (action.kind) {
    case "open":
      return insertAfter(state, action.after, {
        key: action.key,
        anchor: action.anchor,
      })
    case "branch":
      return insertAfter(state, action.after, {
        key: action.key,
        anchor: action.at,
        exclude: [...action.existing].sort(),
      })
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
      return syncColumns(state, action.index)
  }
}

/**
 * Settle columns against the tree, once per change.
 *
 * - A null anchor pins to the newest leaf as soon as there is one, so a new
 *   session's first column follows its first thread.
 * - Every other anchor ADVANCES to its column's tip: a column follows its own
 *   path, so a reply below its last message moves it on, and a branch off an
 *   earlier message, however new, never does. Following from a fixed anchor
 *   instead would jump to any newer branch below that anchor.
 * - A fresh branch whose first message now exists anchors at that message and
 *   drops `exclude`, so it follows its own branch from then on.
 *
 * Returns `state` itself when nothing changes, so React skips the render.
 */
function syncColumns(
  state: readonly Column[],
  index: TreeIndex,
): readonly Column[] {
  let changed = false
  const next = state.map(column => {
    if (column.anchor === null) {
      const pinned = followTip(index, null)
      if (pinned === null) return column
      changed = true
      return { key: column.key, anchor: pinned }
    }
    if (column.exclude !== undefined) {
      const excluded = new Set(column.exclude)
      const fresh = (index.childrenOf.get(column.anchor) ?? []).find(
        child => !excluded.has(child),
      )
      if (fresh === undefined) return column
      changed = true
      return { key: column.key, anchor: followTip(index, fresh) ?? fresh }
    }
    const tip = followTip(index, column.anchor)
    if (tip === null || tip === column.anchor) return column
    changed = true
    return { key: column.key, anchor: tip }
  })
  return changed ? next : state
}
