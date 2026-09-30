// client/archive-rows — the Archive tab's rows (ADR-0029). Pure.
//
// Only the Archive tab reads these, so they live here rather than in
// `@pineta/reads`, which keeps what the host decides from.

import {
  type ArchiveRecord,
  type LaneView,
  messageText,
  type NoteRecord,
  projectRail,
  type RootSummary,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { noteAt } from "@pineta/marginalia"

export type ArchiveFilter = "all" | "archived" | "open" | "mine"
export const ARCHIVE_FILTERS: readonly ArchiveFilter[] = [
  "all",
  "archived",
  "open",
  "mine",
]

export interface ArchiveRow {
  readonly summary: RootSummary
  readonly record: ArchiveRecord | null
  /** Notes whose place (`noteAt`) is in this root. */
  readonly notes: number
}

/**
 * The rows `filter` and `query` keep, newest activity first. "mine" is the
 * roots `me` wrote a chat in. The search is case-insensitive, over each
 * root's label (`rootLabels`, so a title is found) and each message's text as
 * the columns draw it.
 */
export function archiveIndex(input: {
  readonly roots: readonly RootSummary[]
  /** Each root's label, by root (`rootLabels`). */
  readonly labels: ReadonlyMap<string, string>
  readonly archive: ReadonlyMap<string, ArchiveRecord>
  readonly notes: readonly NoteRecord[]
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly filter: ArchiveFilter
  readonly query: string
  readonly me: WriterId
}): readonly ArchiveRow[] {
  const { index, archive } = input
  const noteCount = new Map<string, number>()
  for (const note of input.notes) {
    const at = noteAt(note, input.lanes, index)
    const root = at === null ? null : rootOf(index, at)
    if (root !== null) noteCount.set(root, (noteCount.get(root) ?? 0) + 1)
  }
  const needle = input.query.trim().toLowerCase()
  const matches = (root: string): boolean =>
    needle === "" ||
    (input.labels.get(root) ?? "").toLowerCase().includes(needle) ||
    projectRail(index, root).some(r =>
      messageText(index.entries[r.id]?.message).toLowerCase().includes(needle),
    )
  const keep = (s: RootSummary): boolean => {
    const archived = archive.get(s.root)?.state === "archived"
    switch (input.filter) {
      case "all":
        return true
      case "archived":
        return archived
      case "open":
        return !archived
      case "mine":
        return s.writers.includes(input.me)
    }
  }
  return input.roots
    .filter(s => keep(s) && matches(s.root))
    .toSorted((a, b) =>
      a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0,
    )
    .map(summary => ({
      summary,
      record: archive.get(summary.root) ?? null,
      notes: noteCount.get(summary.root) ?? 0,
    }))
}
