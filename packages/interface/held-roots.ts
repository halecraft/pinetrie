// interface/held-roots — which roots this tab asks its session to hold
// (ADR-0063, ADR-0116). Pure.
//
// A tab loads only what it shows: the roots of every thread in the tasks of
// the sidebar and the task you are on, archived or not. Every other root is
// read from the directory alone, the board's included. What holding them
// opens and lets go is `planHold` (`root-hold.ts`).

import type { EntryId, RootId, RootRecord } from "@pinetrie/core"
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

/** The roots to hold, for `layout`. */
export function planHeldRoots(input: {
  readonly layout: Pick<Layout, "open" | "active">
  readonly tasks: Tasks
}): ReadonlySet<RootId> {
  const { active } = input.layout
  const shown = [
    ...input.layout.open,
    ...(active?.kind === "task" ? [active.task] : []),
  ]
  return new Set(shown.flatMap(task => input.tasks.byId.get(task)?.roots ?? []))
}
