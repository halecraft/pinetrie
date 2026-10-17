// interface/rail-view — the view's part of the rail's stretches (`compactRail`).

import type { AgentRun, DigestBody, EntryId, RailRow } from "@pinetrie/core"
import { digestText } from "@pinetrie/rules"
import { railLandmarks } from "./rail.ts"
import type { SearchResult } from "./search.ts"
import { itemMatches } from "./search-view.ts"
import type { WorkStats } from "./work-stats.ts"

/**
 * The messages this view draws on their own, never inside a stretch: thread
 * ends someone else is reading, running lanes' tips, each open
 * column's end, and each thread end holding a card of yours, whose dot
 * carries its mark. A column's end is kept because an anchored column can end
 * mid-stretch: inside one, half of it would be on the column's path and half
 * not, and where the column ends would not show. The columns fold around the
 * same messages (`railLandmarks`), without the rings: a thread end on a
 * column's path is the column's own end.
 */
export function railKeep(input: {
  /** Thread ends others are reading: the rings' keys. */
  readonly rings: ReadonlyMap<EntryId, unknown>
  readonly activity: readonly AgentRun[]
  /** Each open column's end (`ColumnView.tipId`). */
  readonly ends: Iterable<EntryId | null>
  /** Thread ends holding a card of yours (`UnsentSignals.ends`). */
  readonly cards: ReadonlySet<EntryId>
}): ReadonlySet<EntryId> {
  const keep = new Set([...input.rings.keys(), ...input.cards])
  for (const run of input.activity) keep.add(run.tip)
  for (const end of input.ends) if (end !== null) keep.add(end)
  return keep
}

const NO_RINGS: ReadonlyMap<EntryId, unknown> = new Map()

/**
 * What a root's columns draw apart from any fold: the rail's landmarks, kept as
 * `railKeep` keeps them but for the rings. A ring is a thread end, and a thread
 * end on a column's path is the column's own end, kept already; leaving
 * presence out keeps a presence write from redrawing every column. Sorted, so a
 * list of the same is equal by value.
 */
export function columnLandmarks(
  rows: readonly RailRow[],
  keep: Omit<Parameters<typeof railKeep>[0], "rings">,
): readonly EntryId[] {
  return [...railLandmarks(rows, railKeep({ ...keep, rings: NO_RINGS }))].sort()
}

/**
 * A capsule's tooltip: its ask, when it is one long ask's work, then what it
 * holds (`workWords`), then its digest as the model wrote it (`digestText`),
 * when it has a headline.
 */
export const stretchWords = (
  ask: string | null,
  work: string,
  digest: DigestBody | null,
): string =>
  [
    ask === null ? work : `${ask} · ${work}`,
    digest === null || digest.headline === null ? null : digestText(digest),
  ]
    .filter(t => t !== null)
    .join("\n")

/** Who wrote a stretch's messages: the agent alone, people alone, or both. */
export type StretchFill = "agent" | "people" | "mixed"

/**
 * A stretch's fill: hollow for the agent's work alone, solid for people alone,
 * half strength for both. Three states rather than a share: a small share
 * filled only the capsule's rounded end, which read as a drawing fault.
 */
export function stretchFill(stats: WorkStats): StretchFill {
  if (stats.people === 0) return "agent"
  return stats.agent === 0 ? "people" : "mixed"
}

/**
 * The message a click `fraction` of the way down a capsule picks: the one
 * that far through its stretch. A capsule is drawn far shorter than its
 * messages, so this is approximate, one message per `1 / ids.length` of its
 * height. Null, a click with no point, picks the first.
 */
export function pickAt(
  ids: readonly [EntryId, ...EntryId[]],
  fraction: number | null,
): EntryId {
  if (fraction === null) return ids[0]
  const i = Math.floor(fraction * ids.length)
  return ids[Math.min(ids.length - 1, Math.max(0, i))] ?? ids[0]
}

/** What a rail item marks besides its place: decided here, drawn by `Rail`. */
export interface RailMarks {
  /** On an open column's path: `data-open`. A stretch's first message speaks for it. */
  readonly open: boolean
  /** Your colour when an unsent card of yours waits here, else null. */
  readonly yours: string | null
  /**
   * How many of its messages a search finds (`itemMatches`): 0 to dim it, null
   * while not searching.
   */
  readonly matches: number | null
}

/** Each item's marks, read from its first message; its matches from all of them. */
export function railItems<
  I extends { readonly ids: readonly [EntryId, ...EntryId[]] },
>(
  items: readonly I[],
  facts: {
    readonly open: ReadonlySet<EntryId>
    readonly yours: {
      readonly ends: ReadonlySet<EntryId>
      readonly color: string
    }
    readonly matches: SearchResult | null
  },
): readonly (readonly [item: I, marks: RailMarks])[] {
  return items.map(item => {
    const id = item.ids[0]
    return [
      item,
      {
        open: facts.open.has(id),
        yours: facts.yours.ends.has(id) ? facts.yours.color : null,
        matches: itemMatches(item.ids, facts.matches),
      },
    ] as const
  })
}

/** What `railView` reads of a rail item: where it is drawn, and its messages. */
export interface ViewItem {
  readonly slot: number
  readonly span: number
  /** Its branch, which colours it; `across` is where it is drawn. */
  readonly track: number
  readonly across: number
  readonly ids: readonly string[]
}

/**
 * Whole rail items of one branch a column's view touches, in slots: a dot's
 * centre is its slot.
 */
interface Band {
  readonly track: number
  readonly across: number
  readonly top: number
  readonly bottom: number
}

/**
 * A line across a capsule where an edge of a column's view falls in it: the
 * capsule, and how far down it (0 to 1). `from` and `to` are equal, unless
 * both edges fall within `EDGE_MERGE` of each other in one capsule, when one
 * line spans them.
 */
export interface Tick {
  readonly track: number
  readonly across: number
  readonly slot: number
  readonly span: number
  readonly from: number
  readonly to: number
}

interface RailView {
  readonly bands: readonly Band[]
  readonly ticks: readonly Tick[]
  /**
   * Where the view's edges are, in slots, a capsule's messages each an equal
   * slice of it: what the rail keeps in view. Null when the rail draws none
   * of its messages.
   */
  readonly extent: { readonly top: number; readonly bottom: number } | null
}

/**
 * Where a column's view lies on the rail: `ids`, the messages from the view's
 * top edge to its bottom edge, `first` and `last` how far into the first and
 * the last the edges are.
 *
 * The bands are whole items, so an outline only ever wraps a dot or a capsule
 * entire, and keeps their shape: messages in a row on one branch make one
 * band, whatever other branches draw beside them.
 *
 * Where the view's top or bottom falls inside a capsule, a tick crosses it
 * there, each of its messages an equal slice of it, as `pickAt` reads it.
 * Only the first and last items can be cut, so a view has at most two: a
 * tick marks an edge, never the part in view, which drawn filled would read
 * as a capsule's own fill (people wrote it). Messages the rail does not draw
 * are left out.
 */
/** How close, in slots, two edges in one capsule are drawn as one line. */
export const EDGE_MERGE = 0.25

export function railView(
  itemOf: ReadonlyMap<string, ViewItem>,
  ids: readonly string[],
  first: number,
  last: number,
): RailView {
  const bands: Band[] = []
  const parts = new Map<ViewItem, { from: number; to: number }>()
  const tops: number[] = []
  const bottoms: number[] = []
  for (const [n, id] of ids.entries()) {
    const item = itemOf.get(id)
    if (item === undefined) continue
    const top = item.slot - 0.5
    const bottom = top + item.span
    const at = bands.at(-1)
    if (at !== undefined && at.track === item.track)
      bands[bands.length - 1] = {
        track: at.track,
        across: at.across,
        top: Math.min(at.top, top),
        bottom: Math.max(at.bottom, bottom),
      }
    else bands.push({ track: item.track, across: item.across, top, bottom })
    const k = item.ids.indexOf(id)
    const from = (k + (n === 0 ? first : 0)) / item.ids.length
    const to = (k + (n === ids.length - 1 ? last : 1)) / item.ids.length
    // A dot is whole; a capsule is cut where the edges are.
    const exact =
      item.ids.length > 1
        ? { top: top + from * item.span, bottom: top + to * item.span }
        : { top, bottom }
    tops.push(exact.top)
    bottoms.push(exact.bottom)
    const was = parts.get(item)
    parts.set(item, {
      from: Math.min(was?.from ?? from, from),
      to: Math.max(was?.to ?? to, to),
    })
  }
  const ticks: Tick[] = []
  const items = [...parts]
  const [head] = items
  const tail = items.at(-1)
  const line = (item: ViewItem, from: number, to: number): Tick => ({
    track: item.track,
    across: item.across,
    slot: item.slot,
    span: item.span,
    from,
    to,
  })
  const top =
    head !== undefined && head[0].ids.length > 1 && head[1].from > 0
      ? head
      : null
  const bottom =
    tail !== undefined && tail[0].ids.length > 1 && tail[1].to < 1 ? tail : null
  if (
    top !== null &&
    bottom !== null &&
    top[0] === bottom[0] &&
    (bottom[1].to - top[1].from) * top[0].span < EDGE_MERGE
  )
    ticks.push(line(top[0], top[1].from, bottom[1].to))
  else {
    if (top !== null) ticks.push(line(top[0], top[1].from, top[1].from))
    if (bottom !== null) ticks.push(line(bottom[0], bottom[1].to, bottom[1].to))
  }
  const extent =
    tops.length === 0
      ? null
      : { top: Math.min(...tops), bottom: Math.max(...bottoms) }
  return { bands, ticks, extent }
}
