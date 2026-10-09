// interface/held-roots — which roots this tab asks its session to hold
// (ADR-0063, ADR-0116). Pure.
//
// A tab loads only what it shows: the roots of every thread in the tasks of
// the sidebar and the task you are on, archived or not, and of each thread
// in your inventory, whose slot and preview read it (ADR-0124). Every other root is
// read from the directory alone, the board's included. What holding them
// opens and lets go is `planHold` (`root-hold.ts`).

import type {
  CardRecord,
  EntryId,
  RootId,
  RootRecord,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { Layout } from "./layout.ts"
import type { Tasks } from "./tasks.ts"

/** Each root's root entry, by its id, from the directory; a root with no message has none. */
export const rootEntriesOf = (
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
  readonly tasks: Tasks
  /** The threads your inventory holds. */
  readonly inventory: readonly ThreadId[]
}): ReadonlySet<RootId> {
  const { active } = input.layout
  const shown = [
    ...input.layout.open,
    ...(active?.kind === "task" ? [active.task] : []),
  ]
  return new Set([
    ...shown.flatMap(task => input.tasks.byId.get(task)?.roots ?? []),
    ...input.inventory.flatMap(
      thread => input.tasks.index.rootOfThread.get(thread) ?? [],
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
