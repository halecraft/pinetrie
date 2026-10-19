// scripts/import-cycles — no module is in a cycle of the modules it loads
// (`AGENTS.md`, House rules). Pure, apart from `readImportCycles`.
//
// What a file loads is `imports.ts`'s reading. Only relative specifiers are
// followed, since a package is imported by its name and never by a path into
// it.

import path from "node:path"
import { loadedSpecifiers, reachable } from "./imports.ts"
import { readSources } from "./sources.ts"

/**
 * The cycles of `graph` (a module -> the modules it loads): the modules
 * that reach each other, a module that loads itself among them. Each cycle
 * is its modules sorted, and the cycles are sorted by their first module.
 */
export function importCycles(
  graph: ReadonlyMap<string, readonly string[]>,
): readonly (readonly string[])[] {
  const reached = new Map<string, ReadonlySet<string>>()
  /** What `start` loads, and what that loads: `start` itself only through a cycle. */
  const reach = (start: string): ReadonlySet<string> => {
    const known = reached.get(start)
    if (known !== undefined) return known
    const seen = reachable(graph, graph.get(start) ?? [])
    reached.set(start, seen)
    return seen
  }
  const cycles = new Map<string, readonly string[]>()
  for (const module of graph.keys()) {
    if (!reach(module).has(module)) continue
    const cycle = [...reach(module)]
      .filter(m => reach(m).has(module))
      .toSorted()
    cycles.set(cycle.join(" "), cycle)
  }
  return [...cycles.values()].toSorted((a, b) =>
    (a[0] ?? "").localeCompare(b[0] ?? ""),
  )
}

/**
 * The cycles the source may hold, each its modules sorted: only a cycle
 * the design needs, with its reason. A cycle gone must leave this list too,
 * so it only shrinks.
 */
export const ALLOWED_CYCLES: readonly (readonly string[])[] = [
  // A merge of several bases first merges them into a virtual base, by this
  // same merge, as git's recursive strategy does.
  [
    "apps/pinetrie/host/folder/merge.ts",
    "apps/pinetrie/host/folder/virtual-base.ts",
  ],
]

/** The import cycles of the source under `root`, tests left out; each module repository-relative. */
export function readImportCycles(root: string): readonly (readonly string[])[] {
  const sources = readSources(root, { tests: false })
  const files = new Set(sources.map(s => s.file))
  const graph = new Map(
    sources.map(({ file, text }) => [
      file,
      loadedSpecifiers(file, text)
        .map(s => path.normalize(path.join(path.dirname(file), s)))
        .filter(target => files.has(target)),
    ]),
  )
  return importCycles(graph)
}
