// scripts/imports — what a source file loads, read from its syntax tree, and
// what a set of entries reaches; and which names a file imports and exports.
// `import-cycles`, the package build (`package.ts`) and the indexes
// (`indexes.ts`) read through it. Pure.
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

/** A name a file takes from a specifier: whether only as a type. */
export interface NameTaken {
  readonly name: string
  readonly typeOnly: boolean
}

/**
 * What a file takes from one specifier in one statement: each name it imports
 * or re-exports, or the whole module (an `import * as`, an `export * from`, a
 * default import, or a dynamic import it does not destructure), which says no
 * names.
 */
export type Taken =
  | {
      readonly kind: "names"
      readonly specifier: string
      readonly names: readonly NameTaken[]
    }
  | { readonly kind: "whole"; readonly specifier: string }

const exportedName = (n: unknown): string | null =>
  isNode(n)
    ? n.type === "Identifier"
      ? (n.name as string)
      : typeof n.value === "string"
        ? n.value
        : null
    : null

/** Every name `text` imports or re-exports from another module, by statement, in the order the tree is walked. */
export function takenNames(file: string, text: string): readonly Taken[] {
  const program = parseSync(file, text).program as unknown as Node
  const found: Taken[] = []
  walk(program, (n, ancestors) => {
    const source = literalOf(n.source)
    if (n.type === "ImportDeclaration" && source !== null) {
      const statementType = n.importKind === "type"
      const names: NameTaken[] = []
      let whole = false
      for (const sp of (n.specifiers ?? []) as Node[])
        if (sp.type === "ImportSpecifier") {
          const name = exportedName(sp.imported)
          if (name !== null)
            names.push({
              name,
              typeOnly: statementType || sp.importKind === "type",
            })
        } else whole = true
      const specifier = source.value as string
      found.push(
        whole
          ? { kind: "whole", specifier }
          : { kind: "names", specifier, names },
      )
    } else if (n.type === "ExportNamedDeclaration" && source !== null) {
      const statementType = n.exportKind === "type"
      found.push({
        kind: "names",
        specifier: source.value as string,
        names: ((n.specifiers ?? []) as Node[]).flatMap(sp => {
          const name = exportedName(sp.local)
          return name === null
            ? []
            : [{ name, typeOnly: statementType || sp.exportKind === "type" }]
        }),
      })
    } else if (n.type === "ExportAllDeclaration" && source !== null)
      found.push({ kind: "whole", specifier: source.value as string })
    else if (n.type === "ImportExpression") {
      const s = literalOf(n.source)
      if (s === null) return
      // `const { a, b } = await import("x")` takes `a` and `b`; any other use takes the whole module.
      const [parent, grand] = [ancestors.at(-1), ancestors.at(-2)]
      const pattern =
        parent?.type === "AwaitExpression" &&
        grand?.type === "VariableDeclarator" &&
        isNode(grand.id) &&
        grand.id.type === "ObjectPattern"
          ? grand.id
          : null
      const props = (pattern?.properties ?? []) as Node[]
      found.push(
        pattern === null || props.some(p => p.type !== "Property")
          ? { kind: "whole", specifier: s.value as string }
          : {
              kind: "names",
              specifier: s.value as string,
              names: props.flatMap(p => {
                const name = exportedName(p.key)
                return name === null ? [] : [{ name, typeOnly: false }]
              }),
            },
      )
    }
  })
  return found
}

/** A name a module exports, and whether only as a type. */
export interface ExportedName {
  readonly name: string
  readonly typeOnly: boolean
}

/**
 * Every name `text` exports, declared or re-exported, in order; and each
 * specifier it re-exports whole (`export * from`), whose names it cannot say.
 */
export function exportedNames(
  file: string,
  text: string,
): {
  readonly names: readonly ExportedName[]
  readonly whole: readonly string[]
} {
  const program = parseSync(file, text).program as unknown as Node
  const names: ExportedName[] = []
  const whole: string[] = []
  for (const st of (program.body ?? []) as Node[]) {
    if (st.type === "ExportAllDeclaration") {
      const s = literalOf(st.source)
      if (s !== null) whole.push(s.value as string)
      continue
    }
    if (st.type !== "ExportNamedDeclaration") continue
    const statementType = st.exportKind === "type"
    const d = isNode(st.declaration) ? st.declaration : null
    if (d !== null) {
      const typeOnly =
        d.type === "TSInterfaceDeclaration" ||
        d.type === "TSTypeAliasDeclaration"
      if (d.type === "VariableDeclaration")
        for (const v of (d.declarations ?? []) as Node[]) {
          const name =
            isNode(v.id) && v.id.type === "Identifier" ? v.id.name : null
          if (typeof name === "string") names.push({ name, typeOnly: false })
        }
      else {
        const name = exportedName(d.id)
        if (name !== null) names.push({ name, typeOnly })
      }
    }
    for (const sp of (st.specifiers ?? []) as Node[]) {
      const name = exportedName(sp.exported)
      if (name !== null)
        names.push({
          name,
          typeOnly: statementType || sp.exportKind === "type",
        })
    }
  }
  return { names, whole }
}
