// client/layout — which tab you are on, your tabs, and each root's columns
// (ADR-0029, ADR-0030).
//
// A root tab shows one root: its rail and its columns. Your tabs are the roots
// you have open, in the order you opened them; a root someone else starts
// opens none. The layout also keeps a column list per root you have opened,
// and new tabs, each one fresh column at the root that becomes your tab once
// its first message is written. It is this browser tab's view state, never
// written to the document; it is stored per browser tab (ADR-0027) in the form
// at the end of this file. Pure.

import {
  type ArchiveRecord,
  ancestry,
  type EntryId,
  entryId,
  isLaneName,
  type LaneView,
  parseNewLane,
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
  type Prefill,
} from "./columns.ts"

export type ActiveTab =
  | { readonly kind: "archive" }
  | { readonly kind: "root"; readonly root: EntryId }
  | { readonly kind: "new"; readonly key: string }

export interface Layout {
  /**
   * Null until a tab is chosen: a browser tab with nothing stored, before the
   * document settles. `prune` chooses; no action sets it back to null.
   */
  readonly active: ActiveTab | null
  /** Your open roots, in the order you opened them: the bar's root tabs. */
  readonly open: readonly EntryId[]
  /**
   * Each opened root's columns, in order, kept when its tab is closed so
   * opening it again brings them back. A root with none is absent.
   */
  readonly roots: ReadonlyMap<EntryId, readonly Column[]>
  /** New tabs: each one fresh column at the root, local until its first send. */
  readonly newTabs: readonly Column[]
}

export type LayoutAction =
  | { readonly kind: "show"; readonly tab: ActiveTab }
  | {
      readonly kind: "newTab"
      readonly key: string
      readonly asksAgent: boolean
      /** What its composer starts with. */
      readonly prefill?: Prefill
    }
  /** Close an unsent new tab; nothing was written. */
  | { readonly kind: "closeNewTab"; readonly key: string }
  /** Close a root's tab for you: nothing is written, and its columns are kept. */
  | { readonly kind: "closeRoot"; readonly root: EntryId }
  /** A column action on one root's columns; `sync` and `prune` are the layout's. */
  | {
      readonly kind: "columns"
      readonly root: EntryId
      readonly action: Exclude<ColumnAction, { kind: "sync" | "prune" }>
    }
  /**
   * A column action on new tab `key`'s one column: its first send, or the
   * lane id it reserves (ADR-0057).
   */
  | {
      readonly kind: "newTabColumn"
      readonly key: string
      readonly action: Extract<ColumnAction, { kind: "sent" | "reserve" }>
    }
  /** Store what `resolveLayout` draws for these facts. */
  | ({ readonly kind: "resolve" } & LayoutFacts)
  /** Once, after the document settles: the roots it lacks go, and `active` is chosen. */
  | {
      readonly kind: "prune"
      readonly index: TreeIndex
      readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
    }

/** The document facts a layout follows: one moment's, read together. */
export interface LayoutFacts {
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
}

export const initialLayout = (): Layout => ({
  active: null,
  open: [],
  roots: new Map(),
  newTabs: [],
})

/**
 * A root's columns as stored, or its first column, anchored at the root. Its
 * key holds no `:`, as no column key may (`readingKey`).
 */
export function columnsOf(layout: Layout, root: EntryId): readonly Column[] {
  return layout.roots.get(root) ?? [{ key: `first-${root}`, anchor: root }]
}

/**
 * The tab a column is in, by its key: a new tab's, or a root's, whether or not
 * that root's tab is open. Undefined for a key this layout does not hold.
 */
export function tabOfColumn(
  layout: Layout,
  key: string,
): ActiveTab | undefined {
  if (layout.newTabs.some(c => c.key === key)) return { kind: "new", key }
  for (const [root, columns] of layout.roots)
    if (columns.some(c => c.key === key)) return { kind: "root", root }
  return undefined
}

export const sameTab = (a: ActiveTab | null, b: ActiveTab): boolean =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "root" || b.kind !== "root" || a.root === b.root) &&
  (a.kind !== "new" || b.kind !== "new" || a.key === b.key)

/** Store a root's columns; an empty list gives the root its first column again. */
const withRoot = (
  roots: ReadonlyMap<EntryId, readonly Column[]>,
  root: EntryId,
  columns: readonly Column[],
): ReadonlyMap<EntryId, readonly Column[]> => {
  const next = new Map(roots)
  if (columns.length === 0) next.delete(root)
  else next.set(root, columns)
  return next
}

/** `open` with `root` at its end, unless it is there already. */
const opened = (open: readonly EntryId[], root: EntryId): readonly EntryId[] =>
  open.includes(root) ? open : [...open, root]

/** Your open roots, less the archived ones other than the root you are on. */
function withoutArchived(
  open: readonly EntryId[],
  archive: ReadonlyMap<EntryId, ArchiveRecord>,
  active: ActiveTab | null,
): readonly EntryId[] {
  const kept = open.filter(
    root =>
      archive.get(root)?.state !== "archived" ||
      (active?.kind === "root" && active.root === root),
  )
  return kept.length === open.length ? open : kept
}

/**
 * The tab to show once `closed` is closed: its right neighbour in the bar,
 * else its left, else Archive. `layout` is before the close. Pure.
 */
export function afterClosing(layout: Layout, closed: ActiveTab): ActiveTab {
  const bar = tabBar(layout)
  const at = bar.findIndex(t => sameTab(t, closed))
  const next = bar[at + 1] ?? bar[at - 1]
  return at < 0 || next === undefined ? { kind: "archive" } : next
}

export function layoutReducer(state: Layout, action: LayoutAction): Layout {
  switch (action.kind) {
    case "show": {
      // Showing a root is opening it.
      const open =
        action.tab.kind === "root"
          ? opened(state.open, action.tab.root)
          : state.open
      return sameTab(state.active, action.tab) && open === state.open
        ? state
        : { ...state, active: action.tab, open }
    }
    case "newTab":
      return {
        ...state,
        active: { kind: "new", key: action.key },
        newTabs: [
          ...state.newTabs,
          {
            key: action.key,
            anchor: null,
            fresh:
              action.prefill === undefined ? {} : { prefill: action.prefill },
            ...(action.asksAgent ? { asksAgent: true } : {}),
          },
        ],
      }
    case "closeNewTab": {
      const tab: ActiveTab = { kind: "new", key: action.key }
      return {
        ...state,
        newTabs: state.newTabs.filter(c => c.key !== action.key),
        active: sameTab(state.active, tab)
          ? afterClosing(state, tab)
          : state.active,
      }
    }
    case "closeRoot": {
      if (!state.open.includes(action.root)) return state
      const tab: ActiveTab = { kind: "root", root: action.root }
      return {
        ...state,
        open: state.open.filter(r => r !== action.root),
        active: sameTab(state.active, tab)
          ? afterClosing(state, tab)
          : state.active,
      }
    }
    case "columns": {
      const before = columnsOf(state, action.root)
      const after = columnsReducer(before, action.action)
      return after === before
        ? state
        : { ...state, roots: withRoot(state.roots, action.root, after) }
    }
    case "newTabColumn":
      return {
        ...state,
        newTabs: state.newTabs.map(c =>
          c.key === action.key
            ? (columnsReducer([c], action.action)[0] ?? c)
            : c,
        ),
      }
    case "resolve":
      return resolveLayout(state, action)
    case "prune":
      return pruneLayout(state, action.index, action.archive)
  }
}

/**
 * The layout to draw: `stored` brought up to `facts`. `App` draws this in the
 * render that reads the facts, and stores it after, so no render pairs new
 * entries with an old anchor (S35). Archived roots leave your tabs, except
 * the one you are on (ADR-0030). Returns `stored` itself when nothing changes.
 */
export function resolveLayout(stored: Layout, facts: LayoutFacts): Layout {
  const synced = syncLayout(stored, facts.index, facts.lanes)
  const open = withoutArchived(synced.open, facts.archive, synced.active)
  return open === synced.open ? synced : { ...synced, open }
}

/**
 * Every root's columns follow the tree, not only the active root's: a stored
 * anchor left behind can later follow a newer branch below it (ADR-0027). A
 * new tab whose first message is written becomes that root's tab, and joins
 * your open roots at the end.
 */
function syncLayout(
  state: Layout,
  index: TreeIndex,
  lanes: readonly LaneView[],
): Layout {
  let changed = false
  const roots = new Map<EntryId, readonly Column[]>()
  for (const [root, columns] of state.roots) {
    const next = columnsReducer(columns, { kind: "sync", index, lanes })
    if (next !== columns) changed = true
    roots.set(root, next)
  }
  let active = state.active
  let open = state.open
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
    open = opened(open, root)
    if (sameTab(active, { kind: "new", key: tab.key }))
      active = { kind: "root", root }
  }
  return changed ? { active, open, roots, newTabs } : state
}

/**
 * Once the document has settled: roots it lacks go, archived roots leave your
 * tabs, and the tab to show is chosen. A tab you were on that is gone or
 * archived gives way to your last open tab, else Archive; with nothing stored,
 * that is Archive, since nothing opens a tab by itself (ADR-0030).
 */
function pruneLayout(
  state: Layout,
  index: TreeIndex,
  archive: ReadonlyMap<EntryId, ArchiveRecord>,
): Layout {
  let roots = state.roots
  for (const [root, columns] of state.roots) {
    const next =
      index.entries[root] === undefined
        ? []
        : columnsReducer(columns, { kind: "prune", index })
    if (next !== columns) roots = withRoot(roots, root, next)
  }
  const known = state.open.filter(r => index.entries[r] !== undefined)
  // An archived root you are on stays only until you leave it, and a reload
  // leaves it (ADR-0029).
  const open = withoutArchived(known, archive, null)
  const active = state.active
  const stays =
    active !== null &&
    (active.kind === "archive" ||
      (active.kind === "root" && open.includes(active.root)) ||
      (active.kind === "new" && state.newTabs.some(c => c.key === active.key)))
  if (roots === state.roots && open === state.open && stays) return state
  const last = open.at(-1)
  const fallback: ActiveTab =
    last === undefined ? { kind: "archive" } : { kind: "root", root: last }
  return { ...state, roots, open, active: stays ? active : fallback }
}

/**
 * Archive, your open roots in the order you opened them, then new tabs. An
 * archived root you are on is still in `open` (`resolveLayout` keeps it), so
 * it keeps its place.
 */
export function tabBar(layout: Layout): readonly ActiveTab[] {
  return [
    { kind: "archive" },
    ...layout.open.map(root => ({ kind: "root", root }) as const),
    ...layout.newTabs.map(c => ({ kind: "new", key: c.key }) as const),
  ]
}

/**
 * The column a new path should open beside: the one sharing the deepest
 * ancestor with `id`, so its colour link is short to follow.
 */
export function openBeside(
  index: TreeIndex,
  paths: readonly ReadonlySet<EntryId>[],
  id: EntryId,
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
  | { readonly kind: "scroll"; readonly root: EntryId }
  /** Show `root` and open a column anchored at the entry, after column `after`. */
  | { readonly kind: "open"; readonly root: EntryId; readonly after: number }
  /** Its root is archived and not the tab you are on: preview it in the Archive tab. */
  | { readonly kind: "preview"; readonly root: EntryId }

/**
 * Show entry `id`, wherever it is. A message on a shared stretch of paths is
 * drawn once, in the leftmost column showing it, so every column's path is
 * searched. Null for an entry the index lacks.
 */
export function planOpen(
  layout: Layout,
  index: TreeIndex,
  archive: ReadonlyMap<EntryId, ArchiveRecord>,
  id: EntryId,
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
    v.tipId === null ? new Set<EntryId>() : pathIds(index, v.tipId),
  )
  if (paths.some(p => p.has(id))) return { kind: "scroll", root }
  return { kind: "open", root, after: openBeside(index, paths, id) }
}

// ── stored form (ADR-0027) ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored.
// `fresh.pending` is one: restoring it would send its message again.
// `fresh.prefill` is stored: only `pending` is sent on opening. `reserved` is
// stored, so a reload keeps the thread's name (ADR-0057). It is optional, so
// a v4 layout stored without it still decodes.

const StoredColumn = Type.Object({
  key: Type.String(),
  anchor: Type.Union([Type.String(), Type.Null()]),
  lane: Type.Optional(Type.String()),
  reserved: Type.Optional(Type.String()),
  asksAgent: Type.Optional(Type.Literal(true)),
  // Optional, with no new `v`: absent is story, so a layout stored before
  // densities decodes, and no one's tabs are dropped for it (ADR-0056).
  density: Type.Optional(
    Type.Union([
      Type.Literal("outline"),
      Type.Literal("story"),
      Type.Literal("raw"),
    ]),
  ),
  fresh: Type.Optional(
    Type.Object({
      sendId: Type.Optional(Type.String()),
      prefill: Type.Optional(
        Type.Object({ text: Type.String(), blank: Type.Boolean() }),
      ),
    }),
  ),
})

const StoredTab = Type.Union([
  Type.Object({ kind: Type.Literal("archive") }),
  Type.Object({ kind: Type.Literal("root"), root: Type.String() }),
  Type.Object({ kind: Type.Literal("new"), key: Type.String() }),
])

/** `v` changes when the shape does; an older layout is dropped, not migrated. */
const StoredLayout = Type.Object({
  v: Type.Literal(4),
  active: Type.Union([StoredTab, Type.Null()]),
  open: Type.Array(Type.String()),
  roots: Type.Record(Type.String(), Type.Array(StoredColumn, { minItems: 1 })),
  newTabs: Type.Array(StoredColumn),
})

type Stored = Static<typeof StoredColumn>

const toStored = (c: Column): Stored => ({
  key: c.key,
  anchor: c.anchor,
  ...(c.lane === undefined ? {} : { lane: c.lane }),
  ...(c.reserved === undefined ? {} : { reserved: c.reserved }),
  ...(c.asksAgent ? { asksAgent: true } : {}),
  ...(c.density === undefined ? {} : { density: c.density }),
  ...(c.fresh === undefined
    ? {}
    : {
        fresh: {
          ...(c.fresh.sendId === undefined ? {} : { sendId: c.fresh.sendId }),
          ...(c.fresh.prefill === undefined
            ? {}
            : {
                prefill: {
                  text: c.fresh.prefill.text,
                  blank: c.fresh.prefill.blank,
                },
              }),
        },
      }),
})

const fromStored = (s: Stored): Column => ({
  key: s.key,
  anchor: s.anchor === null ? null : entryId(s.anchor),
  // Unrecognised, it is left off: `sync` binds the column again once its tip
  // is exactly one lane's.
  ...(s.lane !== undefined && isLaneName(s.lane) ? { lane: s.lane } : {}),
  ...reservedFromStored(s.reserved),
  ...(s.asksAgent ? { asksAgent: true } : {}),
  ...(s.density === undefined ? {} : { density: s.density }),
  ...(s.fresh === undefined
    ? {}
    : {
        fresh: {
          ...(s.fresh.sendId === undefined ? {} : { sendId: s.fresh.sendId }),
          ...(s.fresh.prefill === undefined
            ? {}
            : {
                prefill: {
                  text: s.fresh.prefill.text,
                  blank: s.fresh.prefill.blank,
                },
              }),
        },
      }),
})

/** A stored reservation, kept only in the shape the host accepts. */
const reservedFromStored = (stored: string | undefined) => {
  const reserved = stored === undefined ? undefined : parseNewLane(stored)
  return reserved === undefined ? {} : { reserved }
}

export const encodeLayout = (layout: Layout): Static<typeof StoredLayout> => ({
  v: 4,
  active: layout.active,
  open: [...layout.open],
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
        active:
          raw.active?.kind === "root"
            ? { kind: "root", root: entryId(raw.active.root) }
            : raw.active,
        open: raw.open.map(entryId),
        roots: new Map(
          Object.entries(raw.roots).map(([root, columns]) => [
            entryId(root),
            columns.map(fromStored),
          ]),
        ),
        newTabs: raw.newTabs.map(fromStored),
      }
    : undefined
