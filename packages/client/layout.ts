// client/layout — which tab you are on, and each root's columns (ADR-0029).
//
// A root tab shows one root: its rail and its columns. The layout keeps a
// column list per root, and new tabs, each one fresh column at the root that
// becomes a root tab once its first message is written. It is this browser
// tab's view state, never written to the document; it is stored per browser
// tab (ADR-0027) in the form at the end of this file. Pure.

import {
  type ArchiveRecord,
  ancestry,
  isLaneName,
  type LaneView,
  pathIds,
  projectColumns,
  rootOf,
  type TreeIndex,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import {
  type Column,
  type ColumnAction,
  columnsReducer,
  isPinned,
} from "./columns.ts"

export type ActiveTab =
  | { readonly kind: "archive" }
  | { readonly kind: "root"; readonly root: string }
  | { readonly kind: "new"; readonly key: string }

export interface Layout {
  /**
   * Null until a tab is chosen: a browser tab with nothing stored, before the
   * document settles. `prune` chooses; no action sets it back to null.
   */
  readonly active: ActiveTab | null
  /** Each visited root's columns, in order. A root with none is absent. */
  readonly roots: ReadonlyMap<string, readonly Column[]>
  /** New tabs: each one fresh column at the root, local until its first send. */
  readonly newTabs: readonly Column[]
}

export type LayoutAction =
  | { readonly kind: "show"; readonly tab: ActiveTab }
  | {
      readonly kind: "newTab"
      readonly key: string
      readonly asksAgent: boolean
    }
  /** Close an unsent new tab; `fallback` is the tab to show if it was active. */
  | {
      readonly kind: "closeNewTab"
      readonly key: string
      readonly fallback: ActiveTab
    }
  /** A column action on one root's columns; `sync` and `prune` are the layout's. */
  | {
      readonly kind: "columns"
      readonly root: string
      readonly action: Exclude<ColumnAction, { kind: "sync" | "prune" }>
    }
  /** A new tab's first send, as send `sendId`. */
  | { readonly kind: "sent"; readonly key: string; readonly sendId: string }
  | {
      readonly kind: "sync"
      readonly index: TreeIndex
      readonly lanes: readonly LaneView[]
    }
  /** Once, after the document settles: the roots it lacks go, and `active` is chosen. */
  | {
      readonly kind: "prune"
      readonly index: TreeIndex
      readonly open: readonly string[]
    }

export const initialLayout = (): Layout => ({
  active: null,
  roots: new Map(),
  newTabs: [],
})

/**
 * A root's columns as stored, or its first column, anchored at the root. Its
 * key holds no `:`, as no column key may (`readingKey`).
 */
export function columnsOf(layout: Layout, root: string): readonly Column[] {
  return layout.roots.get(root) ?? [{ key: `first-${root}`, anchor: root }]
}

const sameTab = (a: ActiveTab | null, b: ActiveTab): boolean =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "root" || b.kind !== "root" || a.root === b.root) &&
  (a.kind !== "new" || b.kind !== "new" || a.key === b.key)

/** Store a root's columns; an empty list gives the root its first column again. */
const withRoot = (
  roots: ReadonlyMap<string, readonly Column[]>,
  root: string,
  columns: readonly Column[],
): ReadonlyMap<string, readonly Column[]> => {
  const next = new Map(roots)
  if (columns.length === 0) next.delete(root)
  else next.set(root, columns)
  return next
}

/** The newest open root's tab, or Archive when there is none. */
const newestTab = (open: readonly string[]): ActiveTab => {
  const root = open.at(-1)
  return root === undefined ? { kind: "archive" } : { kind: "root", root }
}

export function layoutReducer(state: Layout, action: LayoutAction): Layout {
  switch (action.kind) {
    case "show":
      return sameTab(state.active, action.tab)
        ? state
        : { ...state, active: action.tab }
    case "newTab":
      return {
        ...state,
        active: { kind: "new", key: action.key },
        newTabs: [
          ...state.newTabs,
          {
            key: action.key,
            anchor: null,
            fresh: {},
            ...(action.asksAgent ? { asksAgent: true } : {}),
          },
        ],
      }
    case "closeNewTab": {
      const newTabs = state.newTabs.filter(c => c.key !== action.key)
      const wasActive = sameTab(state.active, { kind: "new", key: action.key })
      return {
        ...state,
        newTabs,
        active: wasActive ? action.fallback : state.active,
      }
    }
    case "columns": {
      const before = columnsOf(state, action.root)
      const after = columnsReducer(before, action.action)
      return after === before
        ? state
        : { ...state, roots: withRoot(state.roots, action.root, after) }
    }
    case "sent":
      return {
        ...state,
        newTabs: state.newTabs.map(c =>
          c.key === action.key ? (columnsReducer([c], action)[0] ?? c) : c,
        ),
      }
    case "sync":
      return syncLayout(state, action.index, action.lanes)
    case "prune":
      return pruneLayout(state, action.index, action.open)
  }
}

/**
 * Every root's columns follow the tree, not only the active root's: a stored
 * anchor left behind can later follow a newer branch below it (ADR-0027). A
 * new tab whose first message is written becomes that root's tab.
 */
function syncLayout(
  state: Layout,
  index: TreeIndex,
  lanes: readonly LaneView[],
): Layout {
  let changed = false
  const roots = new Map<string, readonly Column[]>()
  for (const [root, columns] of state.roots) {
    const next = columnsReducer(columns, { kind: "sync", index, lanes })
    if (next !== columns) changed = true
    roots.set(root, next)
  }
  let active = state.active
  const newTabs: Column[] = []
  for (const tab of state.newTabs) {
    const [column = tab] = columnsReducer([tab], { kind: "sync", index, lanes })
    const root =
      column.fresh === undefined && column.anchor !== null
        ? rootOf(index, column.anchor)
        : null
    if (root === null) {
      if (column !== tab) changed = true
      newTabs.push(column)
      continue
    }
    changed = true
    roots.set(root, [...(roots.get(root) ?? []), column])
    if (sameTab(active, { kind: "new", key: tab.key }))
      active = { kind: "root", root }
  }
  return changed ? { active, roots, newTabs } : state
}

function pruneLayout(
  state: Layout,
  index: TreeIndex,
  open: readonly string[],
): Layout {
  let roots = state.roots
  for (const [root, columns] of state.roots) {
    const next =
      index.entries[root] === undefined
        ? []
        : columnsReducer(columns, { kind: "prune", index })
    if (next !== columns) roots = withRoot(roots, root, next)
  }
  const active = state.active
  const stays =
    active !== null &&
    (active.kind === "archive" ||
      (active.kind === "root" && open.includes(active.root)) ||
      (active.kind === "new" && state.newTabs.some(c => c.key === active.key)))
  if (roots === state.roots && stays) return state
  return { ...state, roots, active: stays ? active : newestTab(open) }
}

/** Archive, the open roots with an archived active root in its place, then new tabs. */
export function tabBar(
  open: readonly string[],
  active: ActiveTab,
  newTabs: readonly Column[],
): readonly ActiveTab[] {
  const roots =
    active.kind === "root" && !open.includes(active.root)
      ? [...open, active.root].sort()
      : open
  return [
    { kind: "archive" },
    ...roots.map(root => ({ kind: "root", root }) as const),
    ...newTabs.map(c => ({ kind: "new", key: c.key }) as const),
  ]
}

/**
 * The column a new path should open beside: the one sharing the deepest
 * ancestor with `id`, so its colour link is short to follow.
 */
export function openBeside(
  index: TreeIndex,
  paths: readonly ReadonlySet<string>[],
  id: string,
): number {
  const up = ancestry(index, id).path
  let best = paths.length - 1
  let depth = Number.POSITIVE_INFINITY
  for (const [i, path] of paths.entries()) {
    const d = up.findIndex(a => path.has(a))
    if (d >= 0 && d < depth) {
      depth = d
      best = i
    }
  }
  return best
}

/** What showing an entry means, for the shell to carry out. */
export type OpenPlan =
  /** A column of `root` already shows it: show the root and scroll there. */
  | { readonly kind: "scroll"; readonly root: string }
  /** Show `root` and open a column anchored at the entry, after column `after`. */
  | { readonly kind: "open"; readonly root: string; readonly after: number }
  /** Its root is archived and not the tab you are on: preview it in the Archive tab. */
  | { readonly kind: "preview"; readonly root: string }

/**
 * Show entry `id`, wherever it is. A message on a shared stretch of paths is
 * drawn once, in the leftmost column showing it, so every column's path is
 * searched. Null for an entry the index lacks.
 */
export function planOpen(
  layout: Layout,
  index: TreeIndex,
  archive: ReadonlyMap<string, ArchiveRecord>,
  id: string,
): OpenPlan | null {
  const root = rootOf(index, id)
  if (root === null) return null
  const here = layout.active?.kind === "root" && layout.active.root === root
  if (archive.get(root)?.state === "archived" && !here)
    return { kind: "preview", root }
  const views = projectColumns(
    index,
    columnsOf(layout, root).map(c => ({
      anchor: c.anchor,
      pinned: isPinned(c),
    })),
  )
  const paths = views.map(v =>
    v.tipId === null ? new Set<string>() : pathIds(index, v.tipId),
  )
  if (paths.some(p => p.has(id))) return { kind: "scroll", root }
  return { kind: "open", root, after: openBeside(index, paths, id) }
}

// ── stored form (ADR-0027) ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored.
// `fresh.pending` is one: restoring it would send its message again.

const StoredColumn = Type.Object({
  key: Type.String(),
  anchor: Type.Union([Type.String(), Type.Null()]),
  lane: Type.Optional(Type.String()),
  asksAgent: Type.Optional(Type.Literal(true)),
  fresh: Type.Optional(Type.Object({ sendId: Type.Optional(Type.String()) })),
})

const StoredTab = Type.Union([
  Type.Object({ kind: Type.Literal("archive") }),
  Type.Object({ kind: Type.Literal("root"), root: Type.String() }),
  Type.Object({ kind: Type.Literal("new"), key: Type.String() }),
])

/** `v` changes when the shape does; an older layout is dropped, not migrated. */
const StoredLayout = Type.Object({
  v: Type.Literal(2),
  active: Type.Union([StoredTab, Type.Null()]),
  roots: Type.Record(Type.String(), Type.Array(StoredColumn, { minItems: 1 })),
  newTabs: Type.Array(StoredColumn),
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

export const encodeLayout = (layout: Layout): Static<typeof StoredLayout> => ({
  v: 2,
  active: layout.active,
  roots: Object.fromEntries(
    [...layout.roots].map(([root, columns]) => [root, columns.map(toStored)]),
  ),
  newTabs: layout.newTabs.map(toStored),
})

/**
 * A stored layout, whole or not at all: only this build writes it, so a
 * half-valid one is not worth keeping. Total.
 */
export const decodeLayout = (raw: unknown): Layout | undefined =>
  Value.Check(StoredLayout, raw)
    ? {
        active: raw.active,
        roots: new Map(
          Object.entries(raw.roots).map(([root, columns]) => [
            root,
            columns.map(fromStored),
          ]),
        ),
        newTabs: raw.newTabs.map(fromStored),
      }
    : undefined
