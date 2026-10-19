// interface/rail — what the rail draws of one root's tree: `projectRail`'s
// rows (core's, since a root's messages are counted by them), with each
// straight stretch of uneventful messages drawn as one capsule, each item
// placed in rows and across.

import type { EntryId, RevisionRecord } from "@pinetrie/core"
import {
  type AskIndex,
  entryAsk,
  isLongAsk,
  type RailRow,
  type TreeIndex,
} from "@pinetrie/threads"
import { type WorkStats, workStats } from "./work-stats.ts"

interface RailItemBase {
  /** Its first row: its parent item's `slot + span`, or 0 at a start (`placeRail`). */
  readonly slot: number
  /** Rows it takes. */
  readonly span: number
  /** Its messages, top to bottom: each the only child of the one above. */
  readonly ids: readonly [EntryId, ...EntryId[]]
  /** Its branch (`RailRow.track`): the colour, not the place. */
  readonly track: number
  /** Where it is drawn across the rail, 0 at the left (`placeRail`). */
  readonly across: number
  /** The first message's parent, the last message of the item above: the edge into it. */
  readonly parentId: EntryId | null
}

/** A message the rail draws on its own. */
interface RailDot extends RailItemBase {
  readonly kind: "dot"
  readonly span: 1
  readonly ids: readonly [EntryId]
}

/** A straight stretch of uneventful messages on one track, drawn as one capsule. */
export interface RailStretch extends RailItemBase {
  readonly kind: "stretch"
  readonly stats: WorkStats
  /**
   * The ask whose work it is, when it is all one long ask's work; null for
   * short exchanges merged together.
   */
  readonly ask: EntryId | null
}

export type RailItem = RailDot | RailStretch

/**
 * The page's span for a stretch: one row, and one more per digit of its size
 * (3–9 → 2, 10–99 → 3).
 */
export const stretchSpan = (size: number): number => 1 + String(size).length

/**
 * The rows drawn on their own whatever else holds: in `keep` (what the view
 * needs to see: rings, running tips, open columns' ends, your cards'
 * ends), the root's first message, a branch's first message, a fork, or a
 * thread end. The rail and the column both read it (`compactRail`,
 * `segmentPath`), so a fold never hides what the rail draws apart.
 */
export function railLandmarks(
  rows: readonly RailRow[],
  keep: ReadonlySet<EntryId>,
): ReadonlySet<EntryId> {
  const childRows = new Map<EntryId, number>()
  for (const r of rows)
    if (r.parentId !== null)
      childRows.set(r.parentId, (childRows.get(r.parentId) ?? 0) + 1)
  return new Set(
    rows
      .filter(
        r =>
          keep.has(r.id) ||
          // The root's first message, or a branch's.
          r.head ||
          childRows.get(r.id) !== 1,
      )
      .map(r => r.id),
  )
}

/** What the rail reads besides the rows: the asks, and the turns' revisions. */
interface RailAsks {
  readonly asks: AskIndex
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
}

/**
 * What the rail draws: `projectRail`'s rows, with each straight stretch of
 * uneventful messages drawn as one capsule.
 *
 * A row is uneventful when it is not one of `railLandmarks`, and not the prompt
 * of a long ask (`isLongAsk`). A stretch never crosses a long ask's edge, so a
 * long ask is a dot and a capsule of its own, while short exchanges still
 * merge. A message steered into a run is in its ask's capsule (`entryAsk`). So a
 * stretch holds no structure, and the compacted rail has every branch the full
 * one has. An uneventful row's only child is the next row in depth-first order,
 * so a stretch is a run of consecutive rows. The items come back placed
 * (`placeRail`), in the rows' order.
 *
 * `spanOf` is the rows a client draws a capsule of `size` messages in. A
 * stretch is a capsule only when that is fewer rows than its dots would
 * take, so the shortest capsule follows from the client's geometry: three
 * messages with `stretchSpan`, two with a one-row capsule.
 */
export function compactRail(
  index: TreeIndex,
  rows: readonly RailRow[],
  keep: ReadonlySet<EntryId>,
  { asks, revisions }: RailAsks,
  spanOf: (size: number) => number = stretchSpan,
): readonly RailItem[] {
  const landmarks = railLandmarks(rows, keep)
  const long = new Set<EntryId>(
    [...asks.work.keys()].filter(prompt => isLongAsk(asks, prompt)),
  )
  const uneventful = (r: RailRow): boolean =>
    !landmarks.has(r.id) && !long.has(r.id)
  /** The long ask a row works for, or null: a stretch keeps to one. */
  const longAsk = (id: EntryId | undefined): EntryId | null => {
    const prompt = id === undefined ? undefined : entryAsk(asks, id)
    return prompt !== undefined && long.has(prompt) ? prompt : null
  }

  const items: Unplaced[] = []
  const dot = (r: RailRow) => {
    items.push({ kind: "dot", span: 1, ids: [r.id], ...edge(r) })
  }
  /** Row `j` carries on the stretch that row `j - 1` is in. */
  const continues = (j: number): boolean => {
    const r = rows[j]
    const before = rows[j - 1]
    return (
      r !== undefined &&
      uneventful(r) &&
      r.parentId === before?.id &&
      longAsk(r.id) === longAsk(before.id)
    )
  }
  for (let i = 0; i < rows.length; ) {
    const start = rows[i]
    if (start === undefined) break
    if (!uneventful(start)) {
      dot(start)
      i += 1
      continue
    }
    let end = i + 1
    while (continues(end)) end += 1
    const stretch = rows.slice(i, end)
    const [first, ...more] = stretch
    const span = spanOf(stretch.length)
    if (first === undefined || span >= stretch.length) stretch.forEach(dot)
    else {
      const ids: readonly [EntryId, ...EntryId[]] = [
        first.id,
        ...more.map(r => r.id),
      ]
      items.push({
        kind: "stretch",
        span,
        ids,
        ...edge(first),
        // A message steered in is no message of the work, as in `askStats`.
        stats: workStats(
          index,
          ids.filter(id => !asks.steered.has(id)),
          rows[end]?.id,
          revisions,
        ),
        ask: longAsk(first.id),
      })
    }
    i = end
  }
  return placeRail(items)
}

const edge = (r: RailRow) => ({ track: r.track, parentId: r.parentId })

/** A rail item before `placeRail` says where it is drawn. */
type Unplaced =
  | Omit<RailDot, "slot" | "across">
  | Omit<RailStretch, "slot" | "across">

/**
 * Where each item is drawn: `items` in depth-first order, each after the item
 * holding its parent.
 *
 * Rows go by depth, not by order: an item's slot is its parent item's
 * `slot + span`, so a branch starts on the row under its fork, beside the
 * older subtree rather than below it.
 *
 * A branch (the items of one track) takes the rows from its fork's last row
 * to its own last row, and the lowest place across whose last branch ended
 * above them, branches taken by their first row. Like booking rooms, each
 * branch takes the leftmost one free for its whole stay, so the rail is no
 * wider than the most branches on any one row. The fork's row is in the
 * range, so a branch never shares its parent's place, and the bend into it
 * never lands on another branch's dot.
 */
function placeRail(items: readonly Unplaced[]): readonly RailItem[] {
  const slots: number[] = []
  const itemAt = new Map<EntryId, number>()
  const parentOf = (it: Unplaced): number | undefined =>
    it.parentId === null ? undefined : itemAt.get(it.parentId)
  /** The last row item `k` takes. */
  const lastRow = (k: number): number =>
    (slots[k] ?? 0) + (items[k]?.span ?? 1) - 1
  const branches = new Map<number, { from: number; to: number }>()
  for (const [k, it] of items.entries()) {
    const p = parentOf(it)
    const slot = p === undefined ? 0 : lastRow(p) + 1
    slots.push(slot)
    for (const id of it.ids) itemAt.set(id, k)
    const was = branches.get(it.track)
    branches.set(it.track, {
      from: was?.from ?? (p === undefined ? slot : lastRow(p)),
      to: Math.max(was?.to ?? 0, lastRow(k)),
    })
  }
  const ends: number[] = []
  const acrossOf = new Map<number, number>()
  const order = [...branches].sort(
    ([ta, a], [tb, b]) => a.from - b.from || ta - tb,
  )
  for (const [track, { from, to }] of order) {
    let across = 0
    while ((ends[across] ?? -1) >= from) across += 1
    ends[across] = to
    acrossOf.set(track, across)
  }
  return items.map((it, k) => ({
    ...it,
    slot: slots[k] ?? 0,
    across: acrossOf.get(it.track) ?? 0,
  }))
}
