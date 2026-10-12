// interface/viewport — what a column shows of its messages, and where a column
// left is placed when it comes back. `use-viewport.ts` measures, the rail
// draws, `App` places.
//
// One measurement serves both: the first message in view and how far into it
// the view's top is, and the last and how far into it its bottom is. The rail
// outlines the messages between; a column leaving keeps the first as its spot.

/** A drawn message's box, in px from the top of its column's view. */
export interface Box {
  readonly id: string
  readonly top: number
  readonly bottom: number
}

/** One end of a column's view: a message, and how far through it (0 to 1). */
export interface Edge {
  readonly id: string
  readonly at: number
}

/** The messages a column shows, from its view's top edge to its bottom edge. */
export interface Span {
  readonly first: Edge
  readonly last: Edge
  /**
   * How far, in px, the view's top is past the end of its first message,
   * in the space before the next (`first.at` is 1 there); 0 inside it. A
   * spot keeps it, so a column left between two messages comes back there.
   */
  readonly past: number
}

const through = (b: Box, y: number): number =>
  b.bottom <= b.top
    ? 0
    : Math.min(1, Math.max(0, (y - b.top) / (b.bottom - b.top)))

/**
 * The span of a view `height` tall over `boxes`, drawn in order down the
 * column. The top edge is in the last message that starts at or above the
 * view's top: past its end (1) when what is there is no message, such as a
 * fold's line. The bottom edge is in the first message that ends at or below
 * the view's bottom, else the last message. Null when nothing is drawn.
 * `boxes` are sorted by `top`, so each edge is a binary search.
 */
export function visibleSpan(
  boxes: readonly Box[],
  height: number,
): Span | null {
  const lastBox = boxes.at(-1)
  const firstBox = boxes[0]
  if (lastBox === undefined || firstBox === undefined) return null
  // The last box whose top is at or above 0; the first box when none is.
  let lo = 0
  let hi = boxes.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if ((boxes[mid]?.top ?? 0) <= 0) lo = mid
    else hi = mid - 1
  }
  const top = boxes[lo] ?? firstBox
  // The first box whose bottom is at or below the view's bottom.
  let from = lo
  let to = boxes.length - 1
  while (from < to) {
    const mid = Math.floor((from + to) / 2)
    if ((boxes[mid]?.bottom ?? 0) >= height) to = mid
    else from = mid + 1
  }
  const bottom = boxes[from] ?? lastBox
  return {
    first: { id: top.id, at: through(top, 0) },
    last: { id: bottom.id, at: through(bottom, height) },
    past: Math.max(0, -top.bottom),
  }
}

/** Whether two spans are the same, so a scroll that moves nothing draws nothing. */
export const sameSpan = (a: Span | null, b: Span | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.first.id === b.first.id &&
    a.last.id === b.last.id &&
    Math.abs(a.first.at - b.first.at) < 0.01 &&
    Math.abs(a.last.at - b.last.at) < 0.01)

/**
 * Where a column was left: its view's top edge, or its end, which is its last
 * message then. Keyed by message, so it fits whichever column shows that
 * message when its tab is shown again.
 */
export type Spot =
  | {
      readonly kind: "at"
      readonly id: string
      readonly at: number
      /** Px past the message's end, between it and the next (`Span.past`). */
      readonly past: number
    }
  | { readonly kind: "end"; readonly id: string }

/** The spot a column leaves: its end while it followed it, else its view's top. */
export function spotOf(
  span: Span | null,
  following: boolean,
  lastId: string | undefined,
): Spot | null {
  if (following)
    return lastId === undefined ? null : { kind: "end", id: lastId }
  return span === null
    ? null
    : { kind: "at", id: span.first.id, at: span.first.at, past: span.past }
}

/** Every spot kept, by the message it is at. */
export type Spots = ReadonlyMap<string, Spot>

/**
 * `spots` with `spot` as the one for the messages `shown`: a column's spot
 * replaces any other at a message it shows, so a column has one. With no
 * spot, the column's are dropped.
 */
export function keepSpot(
  spots: Spots,
  shown: readonly string[],
  spot: Spot | null,
): Spots {
  const next = new Map(spots)
  for (const id of shown) next.delete(id)
  if (spot !== null && shown.includes(spot.id)) next.set(spot.id, spot)
  return next
}

/** The spot at one of the messages `shown`, if any. */
export function spotFor(
  spots: Spots,
  shown: readonly string[],
): Spot | undefined {
  for (const id of shown) {
    const spot = spots.get(id)
    if (spot !== undefined) return spot
  }
  return undefined
}

/**
 * Where a column's view goes for `spot`, as a `scrollTop`, given the spot's
 * message's box in the column's content and the view: the view's top that far
 * into the message, or the message's bottom at the view's bottom. An end spot
 * at the column's last message is the column's end. Null when its content
 * fits the view: then only alignment, with its spacer, can place it.
 */
export function placeAt(
  spot: Spot,
  m: {
    /** The message's top and bottom, in px from the top of the content. */
    readonly top: number
    readonly bottom: number
    readonly scrollHeight: number
    readonly clientHeight: number
    /** The column's last message now. */
    readonly lastId: string | undefined
  },
): number | null {
  if (m.scrollHeight <= m.clientHeight) return null
  const end = m.scrollHeight - m.clientHeight
  const top =
    spot.kind === "at"
      ? m.top + spot.at * (m.bottom - m.top) + spot.past
      : spot.id === m.lastId
        ? end
        : m.bottom - m.clientHeight
  return Math.min(end, Math.max(0, Math.round(top)))
}

/** How long the rail holds still after the reader scrolls it themselves. */
export const RAIL_HOLD_MS = 1500

/** Room the rail keeps between a band it follows and its view's edge. */
export const RAIL_MARGIN = 16

/**
 * The rail's `scrollTop` that brings `band` (px in the rail's content) into
 * view, or null to stay: it is in view, or the reader scrolled the rail in the
 * last `RAIL_HOLD_MS`. A band taller than the view shows its top.
 */
export function railScroll(
  band: { readonly top: number; readonly bottom: number },
  view: {
    readonly scrollTop: number
    readonly clientHeight: number
    readonly scrollHeight: number
  },
  sinceReader: number,
): number | null {
  if (sinceReader < RAIL_HOLD_MS) return null
  const top = band.top - RAIL_MARGIN
  const bottom = band.bottom + RAIL_MARGIN
  const viewBottom = view.scrollTop + view.clientHeight
  if (top >= view.scrollTop && bottom <= viewBottom) return null
  const want =
    top < view.scrollTop || bottom - top > view.clientHeight
      ? top
      : bottom - view.clientHeight
  const max = Math.max(0, view.scrollHeight - view.clientHeight)
  const next = Math.min(max, Math.max(0, Math.round(want)))
  return next === view.scrollTop ? null : next
}

/** What the rail reads of a mounted column's view. */
export interface ColumnViewport {
  /** The column's colour track: its outline's colour. */
  readonly track: number
  /** Its messages from the view's top edge to its bottom edge, folded ones included. */
  readonly ids: readonly string[]
  /** How far into the first and the last the edges are. */
  readonly first: number
  readonly last: number
}

export interface Viewports {
  /** Each mounted column's view, by its key. */
  readonly columns: ReadonlyMap<string, ColumnViewport>
  /** The column whose view changed last: the one the rail follows. */
  readonly moved: string | null
}

/**
 * Every mounted column's view, for the rail. Made once in `App`; columns write
 * it once a frame at most, and only the rail's outlines read it, so a scroll
 * redraws no column. Each write is a new snapshot, as `useSyncExternalStore`
 * needs.
 */
export interface ViewportStore {
  get(): Viewports
  set(key: string, view: ColumnViewport | null): void
  subscribe(listener: () => void): () => void
}

/** Whether a column's view is unchanged: the same messages, edges and colour. */
export const sameViewport = (
  a: ColumnViewport | undefined,
  b: ColumnViewport,
): boolean =>
  a !== undefined &&
  a.track === b.track &&
  a.ids.length === b.ids.length &&
  a.ids[0] === b.ids[0] &&
  a.ids.at(-1) === b.ids.at(-1) &&
  Math.abs(a.first - b.first) < 0.01 &&
  Math.abs(a.last - b.last) < 0.01

export function viewportStore(): ViewportStore {
  let now: Viewports = { columns: new Map(), moved: null }
  const listeners = new Set<() => void>()
  return {
    get: () => now,
    set: (key, view) => {
      // A column measured again, unmoved, is not the one moved last.
      if (view !== null && sameViewport(now.columns.get(key), view)) return
      const columns = new Map(now.columns)
      if (view === null) {
        if (!columns.delete(key)) return
        now = { columns, moved: now.moved === key ? null : now.moved }
      } else now = { columns: columns.set(key, view), moved: key }
      for (const l of listeners) l()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Where columns were left, kept for the page's life. A plain object made once
 * in `App`, as `screenMemory` is; its value is the same shape a store shared by
 * a person's devices would hold.
 */
export interface SpotStore {
  load(): Spots
  save(spots: Spots): void
}

export function spotStore(): SpotStore {
  let kept: Spots = new Map()
  return {
    load: () => kept,
    save: spots => {
      kept = spots
    },
  }
}
