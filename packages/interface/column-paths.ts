// interface/column-paths — the open columns' paths side by side, each shown
// past what the columns to its left show, and the colour each takes from the
// rail. Pure.

import {
  type EntryId,
  projectSpine,
  type RailRow,
  type SpineNode,
  type TreeIndex,
} from "@pinetrie/core"

export interface ColumnSpec {
  /**
   * Where the column's path ends: its thread's end, or a fresh column's fork;
   * null only for a fresh column at the root.
   */
  readonly anchor: EntryId | null
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
  /** The path after `forkFrom` (all of it when `forkFrom` is null). */
  readonly nodes: readonly SpineNode[]
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
    return {
      tipId,
      forkFrom: cut < 0 ? null : (spine[cut]?.id ?? null),
      nodes: spine.slice(cut + 1),
    }
  })
}

/** A column with no messages of its own yet: a fresh branch. */
export const PENDING_TRACK = -1

export interface BranchColors {
  /** Per column: the rail track of its last message, or PENDING_TRACK. */
  readonly track: readonly number[]
  /** Fork dots: at each `forkFrom` message, the tracks of the columns forking there. */
  readonly forks: ReadonlyMap<EntryId, readonly number[]>
}

/**
 * Each column's colour, and the dots it puts where it forks. Colour, not drawn
 * lines, links a branch to its parent, so sibling branches never cross. A
 * column takes the track of its last message, which is where its path ends in
 * the rail; the client maps a track to a colour by the track and its root
 * (ADR-0089), so the rail, the column's header and its fork dot agree.
 */
export function branchColors(
  rail: readonly RailRow[],
  columns: readonly ColumnView[],
): BranchColors {
  const trackOf = new Map(rail.map(r => [r.id, r.track]))
  const track = columns.map(c => {
    const last = c.nodes.at(-1)?.id
    return last === undefined
      ? PENDING_TRACK
      : (trackOf.get(last) ?? PENDING_TRACK)
  })
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
