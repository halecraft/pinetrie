// scripts/sources — the TypeScript source a check reads, its syntax tree
// walked, and the files that hold a migration's old shapes on purpose. `function-names`, `import-cycles`,
// `tag-spelling` and `words` read through it; `prose-names` reads docs and
// every kind of file, so it keeps its own.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"

/** A syntax tree node, read loosely: a check looks at a handful of kinds. */
export interface Node {
  readonly type: string
  readonly start: number
  readonly [key: string]: unknown
}

export const isNode = (v: unknown): v is Node =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { readonly type?: unknown }).type === "string"

/** Each node under `node`, itself first, with its ancestors from the root down. */
export function walk(
  node: Node,
  visit: (n: Node, ancestors: readonly Node[]) => void,
  ancestors: readonly Node[] = [],
): void {
  visit(node, ancestors)
  const below = [...ancestors, node]
  for (const value of Object.values(node))
    if (Array.isArray(value)) {
      for (const v of value) if (isNode(v)) walk(v, visit, below)
    } else if (isNode(value)) walk(value, visit, below)
}

/** A source file, as a check reads it. */
export interface Source {
  /** Repository-relative. */
  readonly file: string
  readonly text: string
}

/**
 * Files that hold a migration's old shapes on purpose: its own words and
 * spellings for the shape it reads, and its fixtures in that shape. The words
 * check lets their identifiers hold a retired name, and the tag check lets
 * their tags keep an old spelling.
 */
export const OLD_SHAPES: readonly string[] = [
  "apps/pinetrie/host/migrations/0005-accepted-working-copy.ts",
  "apps/pinetrie/host/migrations/0005-accepted-working-copy.test.ts",
  "apps/pinetrie/host/migrations/0006-proposed-working-copy-edits.ts",
  "apps/pinetrie/host/migrations/0006-proposed-working-copy-edits.test.ts",
  "apps/pinetrie/host/migrations/0007-land-merged.ts",
  "apps/pinetrie/host/migrations/0007-land-merged.test.ts",
  "apps/pinetrie/host/migrations/rewrite.test.ts",
  "apps/pinetrie/host/migrations/0012-base-get-latest.ts",
  "apps/pinetrie/host/migrations/0013-accepted-get-latest.ts",
  "apps/pinetrie/host/migrations/0013-accepted-get-latest.test.ts",
  "apps/pinetrie/host/migrations/0017-accepted-unfinished.ts",
  "apps/pinetrie/host/migrations/0025-run-end-report.ts",
  "apps/pinetrie/host/migrations/0025-run-end-report.test.ts",
  "apps/pinetrie/host/migrations/0030-fact-in-inventory.ts",
  "apps/pinetrie/host/migrations/0030-fact-in-inventory.test.ts",
]

const FILES = ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "scripts/*.ts"]
const NOT_SOURCE = ["**/node_modules/**", "**/dist/**", "**/*.d.ts"]
const TESTS = "**/*.test.{ts,tsx}"

/** The repository-relative paths `readSources` reads, sorted. */
export const sourcePaths = (
  root: string,
  options: { readonly tests: boolean },
): readonly string[] =>
  globSync(FILES, {
    cwd: root,
    exclude: options.tests ? NOT_SOURCE : [...NOT_SOURCE, TESTS],
  }).toSorted()

/**
 * The TypeScript under `packages/`, `apps/` and `scripts/*.ts`, sorted;
 * `.d.ts`, `node_modules` and `dist` left out, and tests too unless asked.
 */
export const readSources = (
  root: string,
  options: { readonly tests: boolean },
): readonly Source[] =>
  sourcePaths(root, options).map(file => ({
    file,
    text: readFileSync(path.join(root, file), "utf8"),
  }))
