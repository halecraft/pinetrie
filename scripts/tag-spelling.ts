// scripts/tag-spelling — every tag is kebab-case (`AGENTS.md`, House rules):
// a union's `kind`, a literal union's member, an error code, a stored
// schema's literal, a namespace after `pinetrie.`. Pure, apart from the read
// in `scripts/sources.ts`.
//
// A tag is what is typed as a choice, never any string: a string literal type
// that names no property; a value of a `const` table its module reads as a
// union (`(typeof T)[number]`, `(typeof T)[keyof typeof T]`); the argument of
// a stored schema's literal (`Type.Literal`, `Schema.string`); and any string
// that begins `pinetrie.`, since a namespace is typed `pinetrie.${string}`
// and no literal type holds it.

import { parseSync } from "oxc-parser"
import { isNode, type Node, OLD_SHAPES, type Source, walk } from "./sources.ts"

/** A tag as written, by the file and line that hold it. */
export interface TagLiteral {
  /** Repository-relative. */
  readonly file: string
  readonly line: number
  readonly value: string
  /** The table it is a value of, for a table's tag; null for any other. */
  readonly table: string | null
}

const child = (n: Node, key: string): Node | null => {
  const v = n[key]
  return isNode(v) ? v : null
}

const children = (n: Node, key: string): readonly Node[] => {
  const v = n[key]
  return Array.isArray(v) ? v.filter(isNode) : []
}

const nameOfIdentifier = (n: Node | null): string | null =>
  n?.type === "Identifier" && typeof n.name === "string" ? n.name : null

const stringLiteral = (n: Node | null): string | null =>
  n?.type === "Literal" && typeof n.value === "string" ? n.value : null

/** A parenthesised type, unwrapped. */
const unwrapped = (n: Node | null): Node | null =>
  n?.type === "TSParenthesizedType" ? unwrapped(child(n, "typeAnnotation")) : n

/** Generics whose arguments after the first are a type's property names. */
const KEY_PICKERS = new Set(["Pick", "Omit"])
/** Generics whose arguments, beside a `keyof` first, are property names. */
const KEY_FILTERS = new Set(["Exclude", "Extract"])

/** A generic's name: a type reference's, or an `extends`/`implements` clause's. */
function genericName(n: Node): string | null {
  if (n.type === "TSTypeReference")
    return nameOfIdentifier(child(n, "typeName"))
  if (n.type === "TSInterfaceHeritage" || n.type === "TSClassImplements")
    return nameOfIdentifier(child(n, "expression"))
  return null
}

/**
 * Whether a literal's ancestors make it a property's name, not a tag: an
 * argument of `Pick` or `Omit` after the first (in an `extends` or
 * `implements` clause too), the index of an indexed access (`T["key"]`), or
 * anything beside a `keyof` in `Exclude` or `Extract`. `ancestors` run from
 * the root down to `node`'s parent.
 */
export function namesProperty(node: Node, ancestors: readonly Node[]): boolean {
  const path = [...ancestors, node]
  for (let i = path.length - 2; i >= 0; i--) {
    const p = path[i]
    const below = path[i + 1]
    if (p === undefined || below === undefined) continue
    if (p.type === "TSIndexedAccessType" && child(p, "indexType") === below)
      return true
    const name = genericName(p)
    if (name === null || below.type !== "TSTypeParameterInstantiation") continue
    const [first] = children(below, "params")
    const argument = path[i + 2]
    if (KEY_PICKERS.has(name) && argument !== first) return true
    const firstType = unwrapped(first ?? null)
    if (
      KEY_FILTERS.has(name) &&
      firstType?.type === "TSTypeOperator" &&
      firstType.operator === "keyof"
    )
      return true
  }
  return false
}

/** A stored schema's literal: `Type.Literal(…)` or `Schema.string(…)`. */
function isSchemaLiteral(call: Node): boolean {
  const callee = child(call, "callee")
  if (callee?.type !== "MemberExpression") return false
  const object = nameOfIdentifier(child(callee, "object"))
  const property = nameOfIdentifier(child(callee, "property"))
  return (
    (object === "Type" && property === "Literal") ||
    (object === "Schema" && property === "string")
  )
}

/** The `const` tables `program` reads as a union, by name. */
function unionTables(program: Node): ReadonlySet<string> {
  const tables = new Set<string>()
  walk(program, n => {
    if (n.type !== "TSIndexedAccessType") return
    const object = unwrapped(child(n, "objectType"))
    const name =
      object?.type === "TSTypeQuery"
        ? nameOfIdentifier(child(object, "exprName"))
        : null
    if (name !== null) tables.add(name)
  })
  return tables
}

/** A table's string values: an array's elements, an object's property values. */
function tableValues(init: Node | null): readonly Node[] {
  const value =
    init?.type === "TSAsExpression" || init?.type === "TSSatisfiesExpression"
      ? tableValues(child(init, "expression"))
      : null
  if (value !== null) return value
  if (init?.type === "ArrayExpression") return children(init, "elements")
  if (init?.type === "ObjectExpression")
    return children(init, "properties").flatMap(p => child(p, "value") ?? [])
  return []
}

/** Every tag `source` holds, in order. */
export function tagLiterals(source: Source): readonly TagLiteral[] {
  const { program } = parseSync(source.file, source.text)
  const root = program as unknown as Node
  const lineStarts = [0]
  for (let i = 0; i < source.text.length; i++)
    if (source.text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const lineAt = (offset: number): number => {
    let line = 0
    while ((lineStarts[line + 1] ?? Number.POSITIVE_INFINITY) <= offset)
      line += 1
    return line + 1
  }
  const tables = unionTables(root)
  const found: TagLiteral[] = []
  const add = (n: Node, value: string, table: string | null): void => {
    found.push({ file: source.file, line: lineAt(n.start), value, table })
  }
  walk(root, (n, ancestors) => {
    if (n.type === "TSLiteralType") {
      const value = stringLiteral(child(n, "literal"))
      if (value !== null && !namesProperty(n, ancestors)) add(n, value, null)
      return
    }
    if (n.type === "CallExpression" && isSchemaLiteral(n)) {
      for (const a of children(n, "arguments")) {
        const value = stringLiteral(a)
        if (value !== null) add(a, value, null)
      }
      return
    }
    if (n.type === "VariableDeclarator") {
      const table = nameOfIdentifier(child(n, "id"))
      if (table === null || !tables.has(table)) return
      for (const v of tableValues(child(n, "init"))) {
        const value = stringLiteral(v)
        if (value !== null) add(v, value, table)
      }
      return
    }
    const value = stringLiteral(n)
    if (value?.startsWith(NAMESPACE) && value !== NAMESPACE) {
      const parent = ancestors.at(-1)
      // Already read as a literal type, a schema's literal or a table's value.
      if (parent?.type === "TSLiteralType") return
      if (parent?.type === "CallExpression" && isSchemaLiteral(parent)) return
      if (
        ancestors.some(
          a =>
            a.type === "VariableDeclarator" &&
            tables.has(nameOfIdentifier(child(a, "id")) ?? ""),
        )
      )
        return
      add(n, value, null)
    }
  })
  return found
}

/** What a host record's namespace and a custom message's type begin with. */
const NAMESPACE = "pinetrie."

/** Kebab-case, or dot-separated kebab segments; "" (none) too. */
export const isTagSpelling = (value: string): boolean =>
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/.test(value)

/**
 * Spellings that are not ours, each with why. One no tag holds any more is
 * spent (`spentOutside`), and leaves.
 */
export const OUTSIDE_TAGS: Readonly<Record<string, string>> = {
  GET: "an HTTP method, as Docker's API reads it",
  POST: "an HTTP method, as Docker's API reads it",
  DELETE: "an HTTP method, as Docker's API reads it",
  A: "git's status letter",
  C: "git's status letter",
  D: "git's status letter",
  M: "git's status letter",
  R: "git's status letter",
  "1:1": "Gemini's aspect ratio",
  api_key: "pi's credential type",
  toolResult: "pi's role",
  toolCall: "pi's part type",
  branch_summary: "pi's entry type",
  PINETRIE_STORE: "an environment variable's name",
  Enter: "a DOM key name",
  Escape: "a DOM key name",
  "text/markdown": "a MIME type",
  "application/octet-stream": "a MIME type",
  Proposed: "an ADR's status, as its file says it",
  Accepted: "an ADR's status, as its file says it",
  Rejected: "an ADR's status, as its file says it",
  Superseded: "an ADR's status, as its file says it",
  Open: "a spike's status, as its file says it",
  Answered: "a spike's status, as its file says it",
  Moot: "a spike's status, as its file says it",
  "pinetrie.Containerfile": "a file's name",
}

/** Tables whose values are not ours, by name, each with why. */
export const OUTSIDE_TABLES: Readonly<Record<string, string>> = {
  ENV_METHODS: "pi's `ExecutionEnv` methods",
  STREAM_SOURCES: "pi's harness events",
  IMAGE_MIMES: "MIME types",
  DEEP_PACKAGES: "npm package names",
}

const isOutside = (tag: TagLiteral): boolean =>
  tag.value in OUTSIDE_TAGS ||
  (tag.table !== null && tag.table in OUTSIDE_TABLES)

/**
 * The tags spelled other than kebab-case, outside spellings and a migration's
 * old shapes aside.
 */
export const misspelledTags = (
  tags: readonly TagLiteral[],
): readonly TagLiteral[] =>
  tags.filter(
    t =>
      !isTagSpelling(t.value) && !isOutside(t) && !OLD_SHAPES.includes(t.file),
  )

/** Outside entries no tag needs any more: one renamed, or gone. */
export function spentOutside(tags: readonly TagLiteral[]): readonly string[] {
  const values = new Set(tags.map(t => t.value))
  const tables = new Set(tags.flatMap(t => t.table ?? []))
  return [
    ...Object.keys(OUTSIDE_TAGS).filter(v => !values.has(v)),
    ...Object.keys(OUTSIDE_TABLES).filter(t => !tables.has(t)),
  ]
}
