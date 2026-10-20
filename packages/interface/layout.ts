// interface/layout — which canvas you are on, the sidebar, and your view of
// each canvas.
//
// The canvas you are on shows its rail and its columns: one per card on its
// canvas, in the canvas's order (`canvasColumns`), which is everyone's. The
// sidebar is the canvases you have open, in your order: it is your own document,
// the same on every device (`openThreads`, `@pinetrie/session`), and comes in
// here as a fact, so the layout draws it but never stores it. The layout keeps
// your view of each canvas you have opened (`YourCanvasView`: which columns are
// unfolded, how each is read, what a thread you opened starts with). A branch
// or a new canvas's thread is a thread card on its canvas from the moment it opens,
// so it is a column like any other, and a new canvas is its own. Which canvas
// you are on, the views and whether the board is open are this browser tab's
// view state, never written to the document; they are stored per browser tab in
// the form at the end of this file.

import {
  type CanvasId,
  type CardId,
  type EntryId,
  entryThread,
  isCanvasId,
  type LaneView,
  parseCardId,
  pathIds,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import type { CanvasIndex, CardOnCanvas, ThreadOpening } from "@pinetrie/rules"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import type { Density } from "./ask-words.ts"
import {
  buildTaskStrip,
  type CardView,
  canvasColumns,
  defaultView,
  firstUnticked,
  keptTaskView,
  openColumns,
  type Strip,
  type YourCanvasView,
} from "./canvas-columns.ts"
import { projectColumns } from "./column-paths.ts"
import type { Pending, Prefill } from "./columns.ts"

/** What the stage shows: a canvas of the sidebar, or nothing. */
export type Here =
  | { readonly kind: "nothing" }
  | { readonly kind: "canvas"; readonly canvas: CanvasId }

export const NOTHING: Here = { kind: "nothing" }

export interface Layout {
  /**
   * Null until it is chosen: a browser tab with nothing stored, before the
   * document settles. `prune` chooses; no action sets it back to null.
   */
  readonly active: Here | null
  /**
   * The sidebar as drawn: your open canvases in your order (`LayoutFacts.list`),
   * less the archived ones but the canvas you are on, and the canvas you are on
   * wherever the list lacks it. Derived by `resolveLayout`, never stored.
   */
  readonly open: readonly CanvasId[]
  /**
   * Your view of each canvas you have changed one of (`YourCanvasView`), kept when
   * it leaves the sidebar so opening it again brings it back. A canvas with
   * none is drawn as `defaultView` says.
   */
  readonly canvases: ReadonlyMap<CanvasId, YourCanvasView>
  /** Whether the board is open over the columns. */
  readonly board: boolean
}

/** A change to your view of one canvas (`YourCanvasView`). */
export type ViewChange =
  /** Unfold a column, or fold it to a strip with its title. */
  | { readonly kind: "fold"; readonly card: CardId; readonly unfolded: boolean }
  /** Unfold the canvas column, or fold it. */
  | { readonly kind: "fold-canvas"; readonly unfolded: boolean }
  /** How much of each ask a column draws. */
  | {
      readonly kind: "density"
      readonly card: CardId
      readonly density: Density
    }
  /** Whether a thread's details are open under its header. */
  | { readonly kind: "details"; readonly card: CardId; readonly open: boolean }
  /**
   * A thread you opened: its column unfolded, with what it starts with, until
   * its first send.
   */
  | {
      readonly kind: "opened"
      readonly card: ThreadId
      /** A first message the column sends as soon as it opens. */
      readonly pending?: Pending
      /** What its composer starts with, unsent. */
      readonly prefill?: Prefill
    }
  /** A thread you opened sent its first message: what it started with is spent. */
  | { readonly kind: "sent"; readonly card: ThreadId }

export type LayoutAction =
  | { readonly kind: "show"; readonly here: Here }
  /**
   * A canvas leaves the sidebar (its document is written apart): if you are on
   * it, show its neighbour. Your view of it is kept.
   */
  | { readonly kind: "close-canvas"; readonly canvas: CanvasId }
  /**
   * A change to your view of `canvas`. `first` is its canvas's first card,
   * which a view made by this change starts with unfolded (`defaultView`).
   */
  | {
      readonly kind: "view"
      readonly canvas: CanvasId
      readonly first: CardId | null
      readonly change: ViewChange
    }
  /** Open or close the board. */
  | { readonly kind: "board"; readonly open: boolean }
  /** Store what `resolveLayout` draws for these facts. */
  | ({ readonly kind: "resolve" } & LayoutFacts)
  /** Once, after the documents settle: the canvases the session lacks go, and `active` is chosen. */
  | ({
      readonly kind: "prune"
      /** Every canvas the session holds. */
      readonly known: ReadonlySet<CanvasId>
    } & LayoutFacts)

/** What a canvas's columns are drawn from: its canvas and the tree, one moment's. */
export interface CanvasFacts {
  /** Each canvas, in order (`CanvasIndex.cardsOn`). */
  readonly cardsOn: ReadonlyMap<CanvasId, readonly CardOnCanvas[]>
  /** Each thread opened and not yet started (`unstartedThreads`). */
  readonly unstarted: ReadonlyMap<ThreadId, ThreadOpening>
  /** Each thread someone else holds, by its holder (`heldByOthers`). */
  readonly holders: ReadonlyMap<ThreadId, WriterId>
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
}

/** The document facts a layout follows: one moment's, read together. */
export interface LayoutFacts extends CanvasFacts {
  /** The canvases in the archive. */
  readonly archived: ReadonlySet<CanvasId>
  /** The sidebar (`openThreads`). */
  readonly list: readonly CanvasId[]
}

export const initialLayout = (): Layout => ({
  active: null,
  open: [],
  canvases: new Map(),
  board: false,
})

export const sameHere = (a: Here | null, b: Here): boolean =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "canvas" || b.kind !== "canvas" || a.canvas === b.canvas)

/** `views` with `canvas`'s view as `view`. */
const withView = (
  views: ReadonlyMap<CanvasId, YourCanvasView>,
  canvas: CanvasId,
  view: YourCanvasView,
): ReadonlyMap<CanvasId, YourCanvasView> => new Map(views).set(canvas, view)

/** `view` with the card `card`'s view changed by `change`. */
const withCard = (
  view: YourCanvasView,
  card: CardId,
  change: (seen: CardView) => CardView,
): YourCanvasView => {
  const was = view.cards.get(card) ?? {}
  const next = change(was)
  if (sameCardView(was, next)) return view
  const cards = new Map(view.cards)
  if (Object.keys(next).length === 0) cards.delete(card)
  else cards.set(card, next)
  return { ...view, cards }
}

const sameCardView = (a: CardView, b: CardView): boolean =>
  a.unfolded === b.unfolded &&
  a.density === b.density &&
  a.details === b.details &&
  a.pending === b.pending &&
  a.prefill === b.prefill

/** `seen` with `key` set to `value`, or left out for undefined. */
const set = <K extends keyof CardView>(
  seen: CardView,
  key: K,
  value: CardView[K] | undefined,
): CardView => {
  const { [key]: _, ...rest } = seen
  return value === undefined ? rest : { ...rest, [key]: value }
}

/** `view` changed by `change`; the same view when nothing changes. */
function changeView(view: YourCanvasView, change: ViewChange): YourCanvasView {
  switch (change.kind) {
    case "fold":
      return withCard(view, change.card, c =>
        set(c, "unfolded", change.unfolded ? true : undefined),
      )
    case "fold-canvas":
      return view.canvas.unfolded === change.unfolded
        ? view
        : { ...view, canvas: { unfolded: change.unfolded } }
    case "density":
      return withCard(view, change.card, c => set(c, "density", change.density))
    case "details":
      return withCard(view, change.card, c =>
        set(c, "details", change.open ? true : undefined),
      )
    case "opened":
      return withCard(view, change.card, c => ({
        ...set(set(c, "pending", change.pending), "prefill", change.prefill),
        unfolded: true,
      }))
    case "sent":
      return withCard(view, change.card, c =>
        set(set(c, "pending", undefined), "prefill", undefined),
      )
  }
}

/**
 * The sidebar as drawn: the archived canvases leave it, but the canvas you are on,
 * which stays where it is, or comes at the end where the list lacks it:
 * another device's repair may have taken it out (`planOpenRepair`).
 */
function drawnList(
  list: readonly CanvasId[],
  archived: ReadonlySet<CanvasId>,
  active: Here | null,
): readonly CanvasId[] {
  const here = active?.kind === "canvas" ? active.canvas : null
  const kept = list.filter(t => !archived.has(t) || t === here)
  return here === null || kept.includes(here) ? kept : [...kept, here]
}

const sameList = (a: readonly CanvasId[], b: readonly CanvasId[]): boolean =>
  a.length === b.length && a.every((t, i) => b[i] === t)

/**
 * What to show once `closed` is closed: its neighbour below in the sidebar,
 * else above, else nothing. `layout` is before the close.
 */
export function afterClosing(layout: Layout, closed: Here): Here {
  const items = sidebarList(layout)
  const at = items.findIndex(t => sameHere(t, closed))
  const next = items[at + 1] ?? items[at - 1]
  return at < 0 || next === undefined ? NOTHING : next
}

/**
 * Whether `action` shows something in the stage: a canvas or the board. A
 * page over the stage is left for it.
 */
export function showsStage(action: LayoutAction): boolean {
  switch (action.kind) {
    case "show":
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
    case "close-canvas": {
      const here: Here = { kind: "canvas", canvas: action.canvas }
      if (!sameHere(state.active, here)) return state
      return { ...state, active: afterClosing(state, here) }
    }
    case "view": {
      const before =
        state.canvases.get(action.canvas) ?? defaultView(action.first)
      const after = changeView(before, action.change)
      return after === before && state.canvases.has(action.canvas)
        ? state
        : { ...state, canvases: withView(state.canvases, action.canvas, after) }
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
 * entries with an old anchor. The sidebar is the facts' (`drawnList`).
 * Returns `stored` itself when nothing changes.
 */
export function resolveLayout(stored: Layout, facts: LayoutFacts): Layout {
  const open = drawnList(facts.list, facts.archived, stored.active)
  const listed = sameList(open, stored.open) ? stored : { ...stored, open }
  return keptOnceDrawn(listed, facts.cardsOn)
}

/**
 * The canvas you are on with its default view kept (`defaultView`), once
 * its cards are drawn: a tick someone makes later unfolds or folds nothing
 * under you. A canvas whose cards have not arrived keeps none yet, or it
 * would keep a view with nothing unfolded.
 */
function keptOnceDrawn(
  layout: Layout,
  cardsOn: ReadonlyMap<CanvasId, readonly CardOnCanvas[]>,
): Layout {
  const { active } = layout
  if (active?.kind !== "canvas" || layout.canvases.has(active.canvas))
    return layout
  const cards = cardsOn.get(active.canvas) ?? []
  return cards.length === 0
    ? layout
    : {
        ...layout,
        canvases: withView(
          layout.canvases,
          active.canvas,
          defaultView(firstUnticked(cards)),
        ),
      }
}

/**
 * Once the documents have settled: canvases the session lacks go (`known`), and
 * what to show is chosen. The view of a card no longer on the canvas goes
 * as the layout is stored (`storedLayout`). A canvas you were on that is
 * gone or archived gives way to the last canvas of the sidebar, else nothing,
 * and with nothing the board opens: nothing opens a canvas by itself.
 */
function pruneLayout(
  state: Layout,
  facts: LayoutFacts,
  known: ReadonlySet<CanvasId>,
): Layout {
  let canvases = state.canvases
  for (const canvas of state.canvases.keys()) {
    if (known.has(canvas)) continue
    const next = new Map(canvases)
    next.delete(canvas)
    canvases = next
  }
  const list = facts.list.filter(t => known.has(t) && !facts.archived.has(t))
  const active = state.active
  // An archived canvas you were on is left at a reload.
  const stays =
    active !== null &&
    (active.kind === "nothing" ||
      (active.kind === "canvas" &&
        known.has(active.canvas) &&
        !facts.archived.has(active.canvas)))
  if (canvases === state.canvases && stays) return state
  const last = list.at(-1)
  const fallback: Here =
    last === undefined ? NOTHING : { kind: "canvas", canvas: last }
  const shown = stays ? active : fallback
  return {
    ...state,
    canvases,
    active: shown,
    board: state.board || shown.kind === "nothing",
  }
}

/**
 * `layout` as it is stored: without the view of a card not on its canvas's
 * canvas. Only a canvas whose canvas holds a card is read: an empty one may not
 * have arrived. The same layout when nothing goes.
 */
export function storedLayout(
  layout: Layout,
  cardsOn: ReadonlyMap<CanvasId, readonly CardOnCanvas[]>,
): Layout {
  let canvases = layout.canvases
  for (const [canvas, view] of layout.canvases) {
    const here = cardsOn.get(canvas) ?? []
    if (here.length === 0) continue
    const cards = new Map(
      [...view.cards].filter(([card]) => here.some(c => c.id === card)),
    )
    if (cards.size !== view.cards.size)
      canvases = withView(canvases, canvas, { ...view, cards })
  }
  return canvases === layout.canvases ? layout : { ...layout, canvases }
}

/**
 * The sidebar as drawn: what the sidebar shows. An archived canvas you are on
 * is still in `open` (`resolveLayout` keeps it), so it keeps its place.
 */
export function sidebarList(
  layout: Layout,
): readonly Extract<Here, { kind: "canvas" }>[] {
  return layout.open.map(canvas => ({ kind: "canvas", canvas }) as const)
}

/**
 * The canvases among `canvases` not in the sidebar and not archived: what ▦ marks for
 * them. An archived canvas's work is done, so it marks only its own row on the
 * board.
 */
export const unlisted = (
  layout: Pick<Layout, "open">,
  archived: ReadonlySet<CanvasId>,
  canvases: Iterable<CanvasId>,
): readonly CanvasId[] =>
  [...canvases].filter(t => !layout.open.includes(t) && !archived.has(t))

/**
 * A canvas's columns as drawn (`canvasColumns`), from your view of it, or the
 * default one (`defaultView`).
 */
export const drawnColumns = (
  layout: Pick<Layout, "canvases">,
  canvas: CanvasId,
  facts: CanvasFacts,
) => {
  const here = facts.cardsOn.get(canvas) ?? []
  return canvasColumns({
    onCanvas: here,
    view: keptTaskView(layout.canvases, canvas, here),
    index: facts.index,
    lanes: facts.lanes,
    unstarted: facts.unstarted,
    holders: facts.holders,
  })
}

/** A canvas's strip as drawn: its canvas column, then its columns (`drawnColumns`). */
export const canvasStrip = (
  layout: Pick<Layout, "canvases">,
  canvas: CanvasId,
  facts: CanvasFacts,
): Strip =>
  buildTaskStrip(
    canvas,
    keptTaskView(layout.canvases, canvas, facts.cardsOn.get(canvas) ?? []),
    drawnColumns(layout, canvas, facts),
  )

/** What showing an entry means, for the shell to carry out. */
export type OpenPlan =
  /** Column `key` of `canvas` already shows it: show the canvas and scroll there. */
  | { readonly kind: "scroll"; readonly canvas: CanvasId; readonly key: string }
  /** Show `canvas`, unfold its thread's card `card`, and scroll there. */
  | {
      readonly kind: "unfold"
      readonly canvas: CanvasId
      readonly card: ThreadId
    }

/**
 * Show entry `id`, wherever it is, in the canvas its thread is in
 * (`entryThread`, then `canvasOfThread`): an archived canvas opens as any other,
 * read only (`appView`). A message on a shared stretch of paths is drawn
 * once, in the leftmost unfolded column showing it, so every such column's
 * path is searched; with none, its thread's own column is unfolded. Null
 * for an entry the index lacks, or one in no canvas.
 */
export function planOpen(
  layout: Layout,
  index: TreeIndex,
  id: EntryId,
  canvases: Pick<CanvasIndex, "canvasOfThread" | "cardsOn">,
  lanes: readonly LaneView[],
  holders: ReadonlyMap<ThreadId, WriterId>,
): OpenPlan | null {
  const thread = entryThread(index, id)
  if (thread === null || index.entries[id] === undefined) return null
  const canvas = canvases.canvasOfThread.get(thread)
  if (canvas === undefined) return null
  const columns = openColumns(
    drawnColumns(layout, canvas, {
      cardsOn: canvases.cardsOn,
      // An entry shown is in a started thread.
      unstarted: new Map(),
      holders,
      index,
      lanes,
    }),
  )
  const views = projectColumns(
    index,
    columns.map(c => ({ anchor: c.anchor })),
  )
  const showing = views.findIndex(
    v => v.tipId !== null && pathIds(index, v.tipId).has(id),
  )
  const key = columns[showing]?.key
  if (key !== undefined) return { kind: "scroll", canvas, key }
  return { kind: "unfold", canvas, card: thread }
}

// ── stored form ────────────────────────────────────────────────
//
// Kept per browser tab through `tab-state.ts`. Built field by field both ways,
// so a field the schema does not name is never stored or restored. A thread
// you opened keeps its `prefill`; its `pending` is not
// kept: restoring it would send its message again. The reader's settings,
// `density` and `details`, are kept so a reload shows the column as it was
// left.

const StoredDensity = Type.Union([
  Type.Literal("outline"),
  Type.Literal("story"),
  Type.Literal("raw"),
])

const StoredPrefill = Type.Object({
  text: Type.String(),
  blank: Type.Boolean(),
})

const StoredCardView = Type.Object({
  unfolded: Type.Optional(Type.Literal(true)),
  density: Type.Optional(StoredDensity),
  details: Type.Optional(Type.Literal(true)),
  prefill: Type.Optional(StoredPrefill),
})

/** A canvas's view as stored: records by id, so no order can be kept. */
const StoredYourCanvasView = Type.Object({
  cards: Type.Record(Type.String(), StoredCardView),
  canvas: Type.Object({ unfolded: Type.Boolean() }),
})

const StoredHere = Type.Union([
  Type.Object({ kind: Type.Literal("nothing") }),
  Type.Object({ kind: Type.Literal("canvas"), canvas: Type.String() }),
])

/**
 * `v` changes when the shape does; an older layout is dropped, not migrated.
 * `v: 9`: a thread you opened is a card, so no canvas view keeps branches of its
 * own, and no new canvas's thread is kept apart from it. `v: 10`: the board's
 * card is a canvas, so views are kept by canvas.
 */
const StoredLayout = Type.Object({
  v: Type.Literal(10),
  active: Type.Union([StoredHere, Type.Null()]),
  canvases: Type.Record(Type.String(), StoredYourCanvasView),
  board: Type.Boolean(),
})

const storedPrefill = (p: Prefill) => ({ text: p.text, blank: p.blank })

const toStoredView = (
  view: YourCanvasView,
): Static<typeof StoredYourCanvasView> => ({
  cards: Object.fromEntries(
    [...view.cards].map(([card, v]) => [
      card,
      {
        ...(v.unfolded ? { unfolded: true } : {}),
        ...(v.density === undefined ? {} : { density: v.density }),
        ...(v.details ? { details: true } : {}),
        ...(v.prefill === undefined
          ? {}
          : { prefill: storedPrefill(v.prefill) }),
      },
    ]),
  ),
  canvas: { unfolded: view.canvas.unfolded },
})

/** A stored canvas view, or undefined when a key is no card's. */
const fromStoredView = (
  s: Static<typeof StoredYourCanvasView>,
): YourCanvasView | undefined => {
  const cards = new Map<CardId, CardView>()
  for (const [key, v] of Object.entries(s.cards)) {
    const card = parseCardId(key)
    if (card === undefined) return undefined
    cards.set(card, {
      ...(v.unfolded ? { unfolded: true } : {}),
      ...(v.density === undefined ? {} : { density: v.density }),
      ...(v.details ? { details: true } : {}),
      ...(v.prefill === undefined ? {} : { prefill: storedPrefill(v.prefill) }),
    })
  }
  return { cards, canvas: { unfolded: s.canvas.unfolded } }
}

export const encodeLayout = (layout: Layout): Static<typeof StoredLayout> => ({
  v: 10,
  active: layout.active,
  canvases: Object.fromEntries(
    [...layout.canvases].map(([canvas, view]) => [canvas, toStoredView(view)]),
  ),
  board: layout.board,
})

/**
 * A stored layout, whole or not at all: only this build writes it, so a
 * half-valid one is not worth keeping. Total.
 */
export function decodeLayout(raw: unknown): Layout | undefined {
  if (!Value.Check(StoredLayout, raw)) return undefined
  const canvases = new Map<CanvasId, YourCanvasView>()
  for (const [canvas, stored] of Object.entries(raw.canvases)) {
    const view = fromStoredView(stored)
    if (view === undefined || !isCanvasId(canvas)) return undefined
    canvases.set(canvas, view)
  }
  const { active } = raw
  if (active?.kind === "canvas" && !isCanvasId(active.canvas)) return undefined
  return {
    active:
      active?.kind === "canvas"
        ? { kind: "canvas", canvas: active.canvas as CanvasId }
        : active,
    open: [],
    canvases,
    board: raw.board,
  }
}
