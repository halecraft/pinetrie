// interface/column-paths — the open columns' paths side by side, each shown
// past what the columns to its left show, and the colour each takes from the
// rail.

import {
  type EntryId,
  projectSpine,
  type RailRow,
  type SpineNode,
  type ThreadId,
  type TreeIndex,
} from "@pinetrie/core"

export interface ColumnSpec {
  /**
   * Where the column's path ends: its thread's end, or an unstarted
   * thread's fork; null only for a new canvas's thread, at the root.
   */
  readonly anchor: EntryId | null
  /**
   * Its own thread, when its parent thread is on no column of the canvas:
   * its path above that thread's first message folds, behind
   * its fork row, unless a column to its left shows some of it.
   */
  readonly foldAbove?: ThreadId
  /**
   * A thread someone else holds, whose entries a branch not yet sent from it
   * leaves out, its column saying who has it in their place.
   */
  readonly hide?: ThreadId
}

export interface ColumnView {
  /** Where this column's path ends: its anchor. */
  readonly tipId: EntryId | null
  /**
   * The deepest message this path shares with ANY column to its left, or null
   * when it shares none: the first column.
   * Against any column, not only the adjacent one: with the trunk, then a
   * branch off T1, then a branch off T2, the third column shares only T1 with
   * its neighbour but T2 with the trunk, and must start after T2.
   */
  readonly forkFrom: EntryId | null
  /** The path after `forkFrom` (all of it when `forkFrom` is null), less what `above` folds. */
  readonly nodes: readonly SpineNode[]
  /** The path above its thread's first message, folded (`ColumnSpec.foldAbove`); empty for none. */
  readonly above: readonly SpineNode[]
}

/**
 * The open columns' paths, each shown only past what the columns to its left
 * already show. A fresh branch, whose path is wholly shared, has no nodes and
 * forks from its anchor.
 */
export function projectColumns(
  index: TreeIndex,
  columns: readonly ColumnSpec[],
): ColumnView[] {
  const shown = new Set<EntryId>()
  return columns.map(column => {
    const tipId = column.anchor
    const { spine } = projectSpine(index, tipId)
    let cut = -1
    for (const [i, node] of spine.entries()) if (shown.has(node.id)) cut = i
    for (const node of spine) shown.add(node.id)
    const { hide, foldAbove } = column
    const own = spine.slice(cut + 1).filter(n => n.thread !== hide)
    // Shown from its root, with no column to its left sharing any of it:
    // the path above its own thread folds. By thread, not by its first
    // entry's id: that is often a context entry, which is no node.
    const first =
      cut < 0 && foldAbove !== undefined
        ? own.findIndex(n => n.thread === foldAbove)
        : -1
    return {
      tipId,
      forkFrom: cut < 0 ? null : (spine[cut]?.id ?? null),
      nodes: first > 0 ? own.slice(first) : own,
      above: first > 0 ? own.slice(0, first) : [],
    }
  })
}

/** A column with no messages of its own yet: a fresh branch. */
export const PENDING_TRACK = -1

interface BranchColors {
  /** Per column: the rail track of its last message, or PENDING_TRACK. */
  readonly track: readonly number[]
  /** Fork dots: at each `forkFrom` message, the tracks of the columns forking there. */
  readonly forks: ReadonlyMap<EntryId, readonly number[]>
}

/** Each rail entry's track, built once per rail: what `threadTrack` and `branchColors` read. */
type TrackIndex = ReadonlyMap<EntryId, number>

export const trackIndex = (rail: readonly RailRow[]): TrackIndex =>
  new Map(rail.map(r => [r.id, r.track]))

/**
 * The track of a path ending at `end`: the colour of a column or a folded
 * strip ending there, so the two never disagree.
 */
export const threadTrack = (tracks: TrackIndex, end: EntryId | null): number =>
  end === null ? PENDING_TRACK : (tracks.get(end) ?? PENDING_TRACK)

/**
 * Each column's colour, and the dots it puts where it forks. Colour, not drawn
 * lines, links a branch to its parent, so sibling branches never cross. A
 * column takes the track of its last message, which is where its path ends in
 * the rail; the client maps a track to a colour by the track and its root,
 * so the rail, the column's header and its fork dot agree.
 */
export function branchColors(
  tracks: TrackIndex,
  columns: readonly ColumnView[],
): BranchColors {
  const track = columns.map(c =>
    threadTrack(tracks, c.nodes.at(-1)?.id ?? null),
  )
  const forks = new Map<EntryId, number[]>()
  for (const [i, c] of columns.entries()) {
    if (c.forkFrom === null) continue
    const t = track[i] ?? PENDING_TRACK
    const at = forks.get(c.forkFrom)
    if (at === undefined) forks.set(c.forkFrom, [t])
    else at.push(t)
  }
  return { track, forks }
}

/** The toggle that unfolds a column's path above its own thread (`ColumnView.above`). */
export const earlierWords = (count: number): string =>
  `↑ ${count} earlier message${count === 1 ? "" : "s"}`
