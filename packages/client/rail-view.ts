// client/rail-view — the view's part of the rail's stretches (`compactRail`).
// Pure.

import {
  type AgentRun,
  type RailRow,
  railLandmarks,
  type WorkStats,
} from "@pineta/core"

/**
 * The messages this view draws on their own, never inside a stretch: thread
 * ends someone else follows, running lanes' tips, each open
 * column's end, and each thread end holding a card of yours, whose dot
 * carries its mark. A column's end is kept because a pinned column can end
 * mid-stretch: inside one, half of it would be on the column's path and half
 * not, and where the column ends would not show. The columns fold around the
 * same messages (`railLandmarks`), without the rings: a thread end on a
 * column's path is the column's own end.
 */
export function railKeep(input: {
  /** Thread ends others follow: the rings' keys. */
  readonly rings: ReadonlyMap<string, unknown>
  readonly activity: readonly AgentRun[]
  /** Each open column's end (`ColumnView.tipId`). */
  readonly ends: Iterable<string | null>
  /** Thread ends holding a card of yours (`CardMarks.ends`). */
  readonly cards: ReadonlySet<string>
}): ReadonlySet<string> {
  const keep = new Set([...input.rings.keys(), ...input.cards])
  for (const run of input.activity) keep.add(run.tip)
  for (const end of input.ends) if (end !== null) keep.add(end)
  return keep
}

const NO_RINGS: ReadonlyMap<string, unknown> = new Map()

/**
 * What a root's columns draw apart from any fold (ADR-0056): the rail's
 * landmarks, kept as `railKeep` keeps them but for the rings. A ring is a
 * thread end, and a thread end on a column's path is the column's own end,
 * kept already; leaving presence out keeps a presence write from redrawing
 * every column (S59). Sorted, so a list of the same is equal by value.
 */
export function columnLandmarks(
  rows: readonly RailRow[],
  keep: Omit<Parameters<typeof railKeep>[0], "rings">,
): readonly string[] {
  return [...railLandmarks(rows, railKeep({ ...keep, rings: NO_RINGS }))].sort()
}

/**
 * A capsule's tooltip: its ask, when it is one long ask's work (ADR-0056),
 * then what it holds (`workWords`), then its digest on a line of its own.
 */
export const stretchWords = (
  ask: string | null,
  work: string,
  summary: string | null = null,
): string =>
  [ask === null ? work : `${ask} · ${work}`, summary]
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
  ids: readonly [string, ...string[]],
  fraction: number | null,
): string {
  if (fraction === null) return ids[0]
  const i = Math.floor(fraction * ids.length)
  return ids[Math.min(ids.length - 1, Math.max(0, i))] ?? ids[0]
}

/** What a rail item marks besides its place: decided here, drawn by `Rail`. */
export interface RailMarks {
  /** On an open column's path: `data-open`. A stretch's first message speaks for it. */
  readonly open: boolean
  /** Your colour when an unsent card of yours waits here (ADR-0048), else null. */
  readonly yours: string | null
}

/** Each item's marks, read from its first message. */
export function railItems<I extends { readonly ids: readonly string[] }>(
  items: readonly I[],
  facts: {
    readonly open: ReadonlySet<string>
    readonly yours: {
      readonly ends: ReadonlySet<string>
      readonly color: string
    }
  },
): readonly (readonly [item: I, marks: RailMarks])[] {
  return items.map(item => {
    const id = item.ids[0] ?? ""
    return [
      item,
      {
        open: facts.open.has(id),
        yours: facts.yours.ends.has(id) ? facts.yours.color : null,
      },
    ] as const
  })
}

/** What `railView` reads of a rail item: where it is drawn, and its messages. */
export interface ViewItem {
  readonly slot: number
  readonly span: number
  readonly track: number
  readonly ids: readonly string[]
}

/** Whole rail items a column's view touches, in slots: a dot's centre is its slot. */
export interface Band {
  readonly track: number
  readonly top: number
  readonly bottom: number
}

/**
 * Where in a capsule a column's view is, when it shows only part of it: the
 * capsule, and how far down it the view's top and bottom are (0 to 1).
 */
export interface Tick {
  readonly track: number
  readonly slot: number
  readonly span: number
  readonly from: number
  readonly to: number
}

export interface RailView {
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
 * Where a column's view lies on the rail (ADR-0058): `ids`, the messages from
 * the view's top edge to its bottom edge, `first` and `last` how far into the
 * first and the last the edges are.
 *
 * The bands are whole items, so an outline only ever wraps a dot or a capsule
 * entire, and keeps their shape: messages in a row on one track make one
 * band, whatever other tracks draw beside them. A capsule the view shows only
 * part of gets a tick at that part, each of its messages an equal slice of
 * it, as `pickAt` reads it: a fraction of a capsule can be less than a pixel,
 * and stretched into an outline it would match no shape on the rail.
 * Messages the rail does not draw are left out.
 */
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
        top: Math.min(at.top, top),
        bottom: Math.max(at.bottom, bottom),
      }
    else bands.push({ track: item.track, top, bottom })
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
  for (const [item, part] of parts)
    if (item.ids.length > 1 && (part.from > 0 || part.to < 1))
      ticks.push({
        track: item.track,
        slot: item.slot,
        span: item.span,
        ...part,
      })
  const extent =
    tops.length === 0
      ? null
      : { top: Math.min(...tops), bottom: Math.max(...bottoms) }
  return { bands, ticks, extent }
}
