// interface/held-roots — which roots this tab asks its session to hold.
//
// A tab loads only what it shows: the roots of every thread in the canvases of
// the sidebar and the canvas you are on, archived or not, and of each thread
// in your inventory, whose slot and preview read it. Every other root is
// read from the directory alone, the board's included.

import type { EntryId, RootId, ThreadId, WriterId } from "@pinetrie/core"
import type { RootRecord } from "@pinetrie/rules"
import type { CardRecord } from "@pinetrie/threads"
import type { Canvases } from "./canvases.ts"
import type { Layout } from "./layout.ts"

/** Each root's root entry, by its id, from the directory; a root with no message has none. */
export const directoryRootEntries = (
  directory: ReadonlyMap<RootId, RootRecord>,
): ReadonlyMap<RootId, EntryId> =>
  new Map(
    [...directory.values()].flatMap(r =>
      r.entry === null ? [] : [[r.root, r.entry] as const],
    ),
  )

/** The roots to hold, for `layout` and the threads in your inventory. */
export function planHeldRoots(input: {
  readonly layout: Pick<Layout, "open" | "active">
  readonly canvases: Canvases
  /** The threads your inventory holds. */
  readonly inventory: readonly ThreadId[]
}): ReadonlySet<RootId> {
  const { active } = input.layout
  const shown = [
    ...input.layout.open,
    ...(active?.kind === "canvas" ? [active.canvas] : []),
  ]
  return new Set([
    ...shown.flatMap(canvas => input.canvases.byId.get(canvas)?.roots ?? []),
    ...input.inventory.flatMap(
      thread => input.canvases.index.rootOfThread.get(thread) ?? [],
    ),
  ])
}

/** The threads `me` holds in your inventory, whose roots a tab holds. */
export const inventoryThreads = (
  cards: readonly CardRecord[],
  me: WriterId,
): readonly ThreadId[] =>
  cards.flatMap(c =>
    c.kind === "thread" && c.place.kind === "inventory" && c.place.holder === me
      ? [c.id]
      : [],
  )
