// interface/layout — which root you are on, the sidebar, and each root's columns
// (ADR-0029, ADR-0030, ADR-0112).
//
// The root you are on shows one root: its rail and its columns. The sidebar is
// the roots you have open, in your order: it is your own document, the same
// on every device (`openThreads`, `@pinetrie/session`), and comes in here as a
// fact, so the layout draws it but never stores it. The layout keeps a
// column list per root you have opened, and new tabs: each one fresh column
// at the root that becomes a root of the sidebar once its first message is
// written. Which root you are on, the columns, the new tabs and whether the
// board is open are this browser tab's view state, never written to the
// document; they are stored per browser tab (ADR-0027) in the form at the end
// of this file. Pure.

import {
  ancestry,
  type EntryId,
  entryId,
  isLaneName,
  isWorkflowStateId,
  type LaneView,
  parseNewLane,
  parseNewRoot,
  pathIds,
  type RootId,
  rootOf,
  type TreeIndex,
  type WorkflowStateId,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { projectColumns } from "./column-paths.ts"
import {
  type Column,
  type ColumnAction,
  columnsReducer,
  isAnchored,
  type Prefill,
  type ReaderAction,
} from "./columns.ts"

/** What the workspace shows: a root of the sidebar, a new tab, or nothing. */
export type Here =
  | { readonly kind: "nothing" }
  | { readonly kind: "root"; readonly root: EntryId }
  | { readonly kind: "new"; readonly key: string }

export const NOTHING: Here = { kind: "nothing" }

export interface Layout {
  /**
   * Null until it is chosen: a browser tab with nothing stored, before the
   * document settles. `prune` chooses; no action sets it back to null.
   */
  readonly active: Here | null
  /**
   * The sidebar as drawn: your open roots in your order (`LayoutFacts.list`),
   * less the archived ones but the root you are on, and the root you are on
   * wherever the list lacks it. Derived by `resolveLayout`, never stored.
   */
  readonly open: readonly EntryId[]
  /**
   * Each opened root's columns, in order, kept when it leaves the sidebar so
   * opening it again brings them back. A root with none is absent.
   */
  readonly roots: ReadonlyMap<EntryId, readonly Column[]>
  /** New tabs: each one fresh column at the root, local until its first send. */
  readonly newTabs: readonly Column[]
  /** Whether the board is open over the columns (ADR-0112). */
  readonly board: boolean
}

export type LayoutAction =
  | { readonly kind: "show"; readonly here: Here }
  | {
      readonly kind: "newTab"
      readonly key: string
      /** Its root, minted with its key (ADR-0066). */
      readonly root: RootId
      readonly asksAgent: boolean
      /** What its composer starts with. */
      readonly prefill?: Prefill
      /** The workflow state its root lands in: the board column it was opened from. */
      readonly state?: WorkflowStateId
    }
  /** Close an unsent new tab; nothing was written. */
  | { readonly kind: "closeNewTab"; readonly key: string }
  /**
   * A root leaves the sidebar (its document is written apart): if you are on
   * it, show its neighbour. Its columns are kept.
   */
  | { readonly kind: "closeRoot"; readonly root: EntryId }
  /** A column action on one root's columns; `sync` and `prune` are the layout's. */
  | {
      readonly kind: "columns"
      readonly root: EntryId
      readonly action: Exclude<ColumnAction, { kind: "sync" | "prune" }>
    }
  /**
   * A column action on new tab `key`'s one column: its first send, the lane
   * id it reserves (ADR-0057), or a reader's setting (`ReaderAction`).
   */
  | {
      readonly kind: "newTabColumn"
      readonly key: string
      readonly action:
        | Extract<ColumnAction, { kind: "sent" | "reserve" }>
        | ReaderAction
    }
  /** Open or close the board. */
  | { readonly kind: "board"; readonly open: boolean }
  /** Store what `resolveLayout` draws for these facts. */
  | ({ readonly kind: "resolve" } & LayoutFacts)
  /** Once, after the documents settle: the roots the directory lacks go, and `active` is chosen. */
  | ({
      readonly kind: "prune"
      /** Every root the directory names, by its root entry (ADR-0063). */
      readonly known: ReadonlySet<EntryId>
    } & LayoutFacts)

/** The document facts a layout follows: one moment's, read together. */
export interface LayoutFacts {
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  /** The roots in the closed workflow state, by root entry (ADR-0112). */
  readonly archived: ReadonlySet<EntryId>
  /** The sidebar (`openThreads`), by root entry: a root the directory lacks is left out. */
  readonly list: readonly EntryId[]
}

export const initialLayout = (): Layout => ({
  active: null,
  open: [],
  roots: new Map(),
  newTabs: [],
  board: false,
})

/**
 * A root's columns as stored, or its first column, anchored at the root. Its
 * key holds no `:`, as no column key may (`readingKey`).
 */
export function columnsOf(layout: Layout, root: EntryId): readonly Column[] {
  return layout.roots.get(root) ?? [{ key: `first-${root}`, anchor: root }]
}

/**
 * Where a column is, by its key: a new tab's, or a root's, whether or not
 * that root is in the sidebar. Undefined for a key this layout does not hold.
 */
export function hereOfColumn(layout: Layout, key: string): Here | undefined {
  if (layout.newTabs.some(c => c.key === key)) return { kind: "new", key }
  for (const [root, columns] of layout.roots)
    if (columns.some(c => c.key === key)) return { kind: "root", root }
  return undefined
}

export const sameHere = (a: Here | null, b: Here): boolean =>
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

/**
 * The sidebar as drawn: the archived roots leave it, but the root you are on,
 * which stays where it is, or comes at the end where the list lacks it:
 * another device's repair may have taken it out (`planOpenRepair`).
 */
function drawnList(
  list: readonly EntryId[],
  archived: ReadonlySet<EntryId>,
  active: Here | null,
): readonly EntryId[] {
  const here = active?.kind === "root" ? active.root : null
  const kept = list.filter(r => !archived.has(r) || r === here)
  return here === null || kept.includes(here) ? kept : [...kept, here]
}

const sameList = (a: readonly EntryId[], b: readonly EntryId[]): boolean =>
  a.length === b.length && a.every((r, i) => b[i] === r)

/**
 * What to show once `closed` is closed: its neighbour below in the sidebar,
 * else above, else nothing. `layout` is before the close. Pure.
 */
export function afterClosing(layout: Layout, closed: Here): Here {
  const items = listOf(layout)
  const at = items.findIndex(t => sameHere(t, closed))
  const next = items[at + 1] ?? items[at - 1]
  return at < 0 || next === undefined ? NOTHING : next
}

/**
 * Whether `action` shows something in the workspace: a root, a new tab or
 * the board. A page over the workspace (ADR-0098) is left for it.
 */
export function showsWorkspace(action: LayoutAction): boolean {
  switch (action.kind) {
    case "show":
    case "newTab":
      return true
    case "board":
      return action.open
    default:
      return false
  }
}

export function layoutReducer(state: Layout, action: LayoutAction): Layout {
  switch (action.kind) {
    // Choosing what to work in closes the board, which lay over it.
    case "show": {
      const board = action.here.kind === "nothing" && state.board
      return sameHere(state.active, action.here) && board === state.board
        ? state
        : { ...state, active: action.here, board }
    }
    case "newTab":
      return {
        ...state,
        board: false,
        active: { kind: "new", key: action.key },
        newTabs: [
          ...state.newTabs,
          {
            key: action.key,
            anchor: null,
            fresh: {
              root: action.root,
              ...(action.prefill === undefined
                ? {}
                : { prefill: action.prefill }),
              ...(action.state === undefined ? {} : { state: action.state }),
            },
            ...(action.asksAgent ? { asksAgent: true } : {}),
          },
        ],
      }
    case "closeNewTab": {
      const here: Here = { kind: "new", key: action.key }
      return {
        ...state,
        newTabs: state.newTabs.filter(c => c.key !== action.key),
        active: sameHere(state.active, here)
          ? afterClosing(state, here)
          : state.active,
      }
    }
    case "closeRoot": {
      const here: Here = { kind: "root", root: action.root }
      if (!sameHere(state.active, here)) return state
      return { ...state, active: afterClosing(state, here) }
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
    case "board":
      return state.board === action.open
        ? state
        : { ...state, board: action.open }
    case "resolve":
      return resolveLayout(state, action)
    case "prune":
      return pruneLayout(state, action, action.known)
  }
}

/**
 * The layout to draw: `stored` brought up to `facts`. `App` draws this in the
 * render that reads the facts, and stores it after, so no render pairs new
 * entries with an old anchor (S35). The sidebar is the facts' (`drawnList`).
 * Returns `stored` itself when nothing changes.
 */
export function resolveLayout(stored: Layout, facts: LayoutFacts): Layout {
  const synced = syncLayout(stored, facts.index, facts.lanes)
  const open = drawnList(facts.list, facts.archived, synced.active)
  return sameList(open, synced.open) ? synced : { ...synced, open }
}

/**
 * Every root's columns follow the tree, not only the active root's: a stored
 * anchor left behind can later follow a newer branch below it (ADR-0027). A
 * new tab whose first message is written becomes its root's columns, and the
 * root you are on; the session puts that root in the sidebar as its send is
 * answered.
 */
function syncLayout(
  state: Layout,
  index: TreeIndex,
  lanes: readonly LaneView[],
): Layout {
  let changed = false
  const roots = new Map<EntryId, readonly Column[]>()
  for (const [root, columns] of state.roots) {
    // A root this tab does not hold is in no index (ADR-0063): its columns
    // wait, as stored, until it is held.
    const next =
      index.entries[root] === undefined
        ? columns
        : columnsReducer(columns, { kind: "sync", index, lanes })
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
    if (sameHere(active, { kind: "new", key: tab.key }))
      active = { kind: "root", root }
  }
  return changed ? { ...state, active, roots, newTabs } : state
}

/**
 * Once the documents have settled: roots the directory lacks go (`known`),
 * anchors a held root lacks go, and what to show is chosen. A root's columns
 * are pruned only where this tab holds it: another's anchors are in no index.
 * A root you were on that is gone or archived gives way to the last root of
 * the sidebar, else nothing, and with nothing the board opens: nothing opens a
 * root by itself (ADR-0030).
 */
function pruneLayout(
  state: Layout,
  facts: LayoutFacts,
  knownRoots: ReadonlySet<EntryId>,
): Layout {
  let roots = state.roots
  for (const [root, columns] of state.roots) {
    const next = !knownRoots.has(root)
      ? []
      : facts.index.entries[root] === undefined
        ? columns
        : columnsReducer(columns, { kind: "prune", index: facts.index })
    if (next !== columns) roots = withRoot(roots, root, next)
  }
  const list = facts.list.filter(
    r => knownRoots.has(r) && !facts.archived.has(r),
  )
  const active = state.active
  // An archived root you were on is left at a reload (ADR-0029).
  const stays =
    active !== null &&
    (active.kind === "nothing" ||
      (active.kind === "root" &&
        knownRoots.has(active.root) &&
        !facts.archived.has(active.root)) ||
      (active.kind === "new" && state.newTabs.some(c => c.key === active.key)))
  if (roots === state.roots && stays) return state
  const last = list.at(-1)
  const fallback: Here =
    last === undefined ? NOTHING : { kind: "root", root: last }
  const shown = stays ? active : fallback
  return {
    ...state,
    roots,
    active: shown,
    board: state.board || shown.kind === "nothing",
  }
}

/**
 * The sidebar as drawn, then new tabs: what the sidebar shows. An archived
 * root you are on is still in `open` (`resolveLayout` keeps it), so it keeps
 * its place.
 */
export function listOf(layout: Layout): readonly Here[] {
  return [
    ...layout.open.map(root => ({ kind: "root", root }) as const),
    ...layout.newTabs.map(c => ({ kind: "new", key: c.key }) as const),
  ]
}

/**
 * The roots among `roots` not in the sidebar and not archived: what ▦ marks
 * for them (ADR-0077, ADR-0112). An archived root's work is done, so it marks
 * only its own row on the board.
 */
export const unlisted = (
  layout: Pick<Layout, "open">,
  archived: ReadonlySet<EntryId>,
  roots: Iterable<EntryId>,
): readonly EntryId[] =>
  [...roots].filter(r => !layout.open.includes(r) && !archived.has(r))

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
  /** Column `key` of `root` already shows it: show the root and scroll there. */
  | { readonly kind: "scroll"; readonly root: EntryId; readonly key: string }
  /** Show `root` and open a column anchored at the entry, after column `after`. */
  | { readonly kind: "open"; readonly root: EntryId; readonly after: number }

/**
 * Show entry `id`, wherever it is: an archived root opens as any other, read
 * only (`appView`). A message on a shared stretch of paths is drawn once, in
 * the leftmost column showing it, so every column's path is searched. Null
 * for an entry the index lacks.
 */
export function planOpen(
  layout: Layout,
  index: TreeIndex,
  id: EntryId,
): OpenPlan | null {
  const root = rootOf(index, id)
  if (root === null) return null
  const columns = columnsOf(layout, root)
  const views = projectColumns(
    index,
    columns.map(c => ({ anchor: c.anchor, anchored: isAnchored(c) })),
  )
  const paths = views.map(v =>
    v.tipId === null ? new Set<EntryId>() : pathIds(index, v.tipId),
  )
  const showing = columns[paths.findIndex(p => p.has(id))]
  if (showing !== undefined) return { kind: "scroll", root, key: showing.key }
  return { kind: "open", root, after: openBeside(index, paths, id) }
}

// ── stored form (ADR-0027) ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored.
// `fresh.pending` is one: restoring it would send its message again.
// `fresh.prefill` is stored: only `pending` is sent on opening. `reserved` is
// stored, so a reload keeps the thread's name (ADR-0057). It is optional, so
// a v4 layout stored without it still decodes. So are the reader's settings,
// `density` and `details`, kept so a reload shows the column as it was left.

const StoredColumn = Type.Object({
  key: Type.String(),
  anchor: Type.Union([Type.String(), Type.Null()]),
  lane: Type.Optional(Type.String()),
  reserved: Type.Optional(Type.String()),
  asksAgent: Type.Optional(Type.Literal(true)),
  // Optional, with no new `v`: absent is story, so a layout stored before
  // densities decodes, and no one's tabs are dropped for it (ADR-0106).
  density: Type.Optional(
    Type.Union([
      Type.Literal("outline"),
      Type.Literal("story"),
      Type.Literal("raw"),
    ]),
  ),
  // Optional too, and for the same reason: absent is closed (ADR-0073).
  details: Type.Optional(Type.Literal(true)),
  fresh: Type.Optional(
    Type.Object({
      sendId: Type.Optional(Type.String()),
      root: Type.Optional(Type.String()),
      state: Type.Optional(Type.String()),
      prefill: Type.Optional(
        Type.Object({
          text: Type.String(),
          blank: Type.Boolean(),
        }),
      ),
    }),
  ),
})

const StoredHere = Type.Union([
  Type.Object({ kind: Type.Literal("nothing") }),
  Type.Object({ kind: Type.Literal("root"), root: Type.String() }),
  Type.Object({ kind: Type.Literal("new"), key: Type.String() }),
])

/**
 * `v` changes when the shape does; an older layout is dropped, not migrated.
 * `v: 5` (ADR-0112): the sidebar left for your own document, and the board's
 * state came in.
 */
const StoredLayout = Type.Object({
  v: Type.Literal(5),
  active: Type.Union([StoredHere, Type.Null()]),
  roots: Type.Record(Type.String(), Type.Array(StoredColumn, { minItems: 1 })),
  newTabs: Type.Array(StoredColumn),
  board: Type.Boolean(),
})

type Stored = Static<typeof StoredColumn>

const toStored = (c: Column): Stored => ({
  key: c.key,
  anchor: c.anchor,
  ...(c.lane === undefined ? {} : { lane: c.lane }),
  ...(c.reserved === undefined ? {} : { reserved: c.reserved }),
  ...(c.asksAgent ? { asksAgent: true } : {}),
  ...(c.density === undefined ? {} : { density: c.density }),
  ...(c.details ? { details: true } : {}),
  ...(c.fresh === undefined
    ? {}
    : {
        fresh: {
          ...(c.fresh.sendId === undefined ? {} : { sendId: c.fresh.sendId }),
          ...(c.fresh.root === undefined ? {} : { root: c.fresh.root }),
          ...(c.fresh.state === undefined ? {} : { state: c.fresh.state }),
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

/**
 * A stored column. A new tab keeps its root (`newTab`); `mintRoot` gives
 * one to a new tab stored before it had one, and is null for a root's
 * columns, whose root is their tab's.
 */
const fromStored = (s: Stored, mintRoot: (() => RootId) | null): Column => ({
  key: s.key,
  anchor: s.anchor === null ? null : entryId(s.anchor),
  // Unrecognised, it is left off: `sync` binds the column again once its tip
  // is exactly one lane's.
  ...(s.lane !== undefined && isLaneName(s.lane) ? { lane: s.lane } : {}),
  ...reservedFromStored(s.reserved),
  ...(s.asksAgent ? { asksAgent: true } : {}),
  ...(s.density === undefined ? {} : { density: s.density }),
  ...(s.details ? { details: true } : {}),
  ...(s.fresh === undefined
    ? {}
    : {
        fresh: {
          ...(s.fresh.sendId === undefined ? {} : { sendId: s.fresh.sendId }),
          ...(mintRoot === null
            ? {}
            : {
                root:
                  (s.fresh.root === undefined
                    ? undefined
                    : parseNewRoot(s.fresh.root)) ?? mintRoot(),
              }),
          ...(s.fresh.state !== undefined && isWorkflowStateId(s.fresh.state)
            ? { state: s.fresh.state }
            : {}),
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
  v: 5,
  active: layout.active,
  roots: Object.fromEntries(
    [...layout.roots].map(([root, columns]) => [root, columns.map(toStored)]),
  ),
  newTabs: layout.newTabs.map(toStored),
  board: layout.board,
})

/**
 * A stored layout, whole or not at all: only this build writes it, so a
 * half-valid one is not worth keeping. Total. `mintRoot` mints a root for a
 * new tab stored without one.
 */
export const decodeLayout = (
  raw: unknown,
  mintRoot: () => RootId,
): Layout | undefined =>
  Value.Check(StoredLayout, raw)
    ? {
        active:
          raw.active?.kind === "root"
            ? { kind: "root", root: entryId(raw.active.root) }
            : raw.active,
        open: [],
        roots: new Map(
          Object.entries(raw.roots).map(([root, columns]) => [
            entryId(root),
            columns.map(c => fromStored(c, null)),
          ]),
        ),
        newTabs: raw.newTabs.map(c => fromStored(c, mintRoot)),
        board: raw.board,
      }
    : undefined
