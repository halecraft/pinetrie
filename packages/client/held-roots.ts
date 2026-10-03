// client/held-roots — which roots' documents this tab holds (ADR-0063). Pure.
//
// A tab loads only what it shows: the roots of your open tabs, the one you
// are on, and the root the Archive tab previews. Every other root is read
// from the directory alone, and its document is let go.

import type { EntryId, RootId, RootRecord } from "@pineta/core"
import type { Layout } from "./layout.ts"

/** Each root's id, by its root entry, from the directory. */
export const rootIdsByEntry = (
  directory: ReadonlyMap<RootId, RootRecord>,
): ReadonlyMap<EntryId, RootId> =>
  new Map(
    [...directory.values()].flatMap(r =>
      r.entry === null ? [] : [[r.entry, r.root] as const],
    ),
  )

/** The roots to hold, for `layout` and the Archive tab's `preview`. */
export function planHeldRoots(input: {
  readonly layout: Pick<Layout, "open" | "active">
  readonly preview: EntryId | null
  readonly directory: ReadonlyMap<RootId, RootRecord>
}): ReadonlySet<RootId> {
  const ids = rootIdsByEntry(input.directory)
  const { active } = input.layout
  const entries = [
    ...input.layout.open,
    ...(active?.kind === "root" ? [active.root] : []),
    ...(active?.kind === "archive" && input.preview !== null
      ? [input.preview]
      : []),
  ]
  return new Set(
    entries.flatMap(entry => {
      const root = ids.get(entry)
      return root === undefined ? [] : [root]
    }),
  )
}
