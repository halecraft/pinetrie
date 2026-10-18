// scripts/import-cycles — no module is in a cycle of the modules it loads
// (`AGENTS.md`, House rules). Pure, apart from `readImportCycles`.
//
// An import loads its module unless the whole statement is `import type` or
// `export type`: with `verbatimModuleSyntax`, `import { type A }` is kept as
// `import {}`, which Node still loads. Only relative specifiers are followed,
// since a package is imported by its name and never by a path into it.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseSync } from "oxc-parser"

/** The relative specifiers `text` loads, in order, each once. */
export function loadedSpecifiers(
  file: string,
  text: string,
): readonly string[] {
  const loaded: string[] = []
  for (const statement of parseSync(file, text).program.body) {
    const source =
      statement.type === "ImportDeclaration"
        ? statement.importKind === "type"
          ? null
          : statement.source
        : statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportAllDeclaration"
          ? statement.exportKind === "type"
            ? null
            : statement.source
          : null
    if (source?.value.startsWith(".")) loaded.push(source.value)
  }
  return [...new Set(loaded)]
}

/**
 * The cycles of `graph` (a module -> the modules it loads): the modules
 * that reach each other, a module that loads itself among them. Each cycle
 * is its modules sorted, and the cycles are sorted by their first module.
 */
export function importCycles(
  graph: ReadonlyMap<string, readonly string[]>,
): readonly (readonly string[])[] {
  const reached = new Map<string, ReadonlySet<string>>()
  const reach = (start: string): ReadonlySet<string> => {
    const known = reached.get(start)
    if (known !== undefined) return known
    const seen = new Set<string>()
    const todo = [...(graph.get(start) ?? [])]
    for (let next = todo.pop(); next !== undefined; next = todo.pop())
      if (!seen.has(next)) {
        seen.add(next)
        todo.push(...(graph.get(next) ?? []))
      }
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

const FILES = ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "scripts/*.ts"]
const NOT_SOURCE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/*.test.{ts,tsx}",
  "**/*.d.ts",
]

/** The import cycles of the source under `root`, tests left out; each module repository-relative. */
export function readImportCycles(root: string): readonly (readonly string[])[] {
  const files = new Set(globSync(FILES, { cwd: root, exclude: NOT_SOURCE }))
  const graph = new Map(
    [...files].toSorted().map(file => [
      file,
      loadedSpecifiers(file, readFileSync(path.join(root, file), "utf8"))
        .map(s => path.normalize(path.join(path.dirname(file), s)))
        .filter(target => files.has(target)),
    ]),
  )
  return importCycles(graph)
}
