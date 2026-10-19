// scripts/imports — what a source file loads, read from its syntax tree, and
// what a set of entries reaches. `import-cycles` and the package build
// (`package.ts`) read through it. Pure.
//
// An import loads its module unless the whole statement is `import type` or
// `export type`: with `verbatimModuleSyntax`, `import { type A }` is kept as
// `import {}`, which Node still loads.

import { parseSync } from "oxc-parser"
import { isNode, type Node, walk } from "./sources.ts"

/** A specifier a file loads, with where its string literal is, quotes included. */
export type LoadedImport =
  | {
      readonly kind: "literal"
      readonly specifier: string
      readonly start: number
      readonly end: number
      /** An `import()` call, not a statement. */
      readonly dynamic: boolean
    }
  /** An `import()` of anything but a string literal: no reader can tell what it loads. */
  | { readonly kind: "computed"; readonly start: number }

const literalOf = (n: unknown): Node | null =>
  isNode(n) && n.type === "Literal" && typeof n.value === "string" ? n : null

/** Every module `text` loads, in order of position, each statement once. */
export function loadedImports(
  file: string,
  text: string,
): readonly LoadedImport[] {
  const program = parseSync(file, text).program as unknown as Node
  const found: LoadedImport[] = []
  const literal = (n: Node, dynamic: boolean) => {
    const value = n.value as string
    found.push({
      kind: "literal",
      specifier: value,
      start: n.start,
      end: n.end as number,
      dynamic,
    })
  }
  walk(program, n => {
    if (
      n.type === "ImportDeclaration" ||
      n.type === "ExportNamedDeclaration" ||
      n.type === "ExportAllDeclaration"
    ) {
      const typeOnly = n.importKind === "type" || n.exportKind === "type"
      const source = literalOf(n.source)
      if (source !== null && !typeOnly) literal(source, false)
    } else if (n.type === "ImportExpression") {
      const source = literalOf(n.source)
      if (source !== null) literal(source, true)
      else found.push({ kind: "computed", start: n.start })
    }
  })
  return found.toSorted((a, b) => a.start - b.start)
}

/** The relative specifiers `text`'s statements load, in order, each once. */
export const loadedSpecifiers = (
  file: string,
  text: string,
): readonly string[] => [
  ...new Set(
    loadedImports(file, text).flatMap(i =>
      i.kind === "literal" && !i.dynamic && i.specifier.startsWith(".")
        ? [i.specifier]
        : [],
    ),
  ),
]

/** Every module `entries` reach in `graph` (a module -> the modules it loads), the entries among them. */
export function reachable(
  graph: ReadonlyMap<string, readonly string[]>,
  entries: readonly string[],
): ReadonlySet<string> {
  const seen = new Set<string>()
  const todo = [...entries]
  for (let next = todo.pop(); next !== undefined; next = todo.pop())
    if (!seen.has(next)) {
      seen.add(next)
      todo.push(...(graph.get(next) ?? []))
    }
  return seen
}
