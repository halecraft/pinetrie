// scripts/words — where a retired word may not come back: inside the code's
// names, and in what people and the agent read. Pure, apart from
// `readSources` and `readTexts`.
//
// The glossary (`docs/glossary.md`) moves a concept to a new word; these rules
// keep the code and the page from slipping back to the old one. A word is
// retired for its concept, not as English ("yours" names no field, yet "queue
// after yours" is a right page word), so the two rules read different lists:
// the identifier rule reads names alone, never strings or comments, and the
// text rule reads only the glossary's list of phrases nothing says.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseSync } from "oxc-parser"

/** A source file, as the rules read it. */
export interface Source {
  /** Repository-relative. */
  readonly file: string
  readonly text: string
}

/** Names no identifier may contain, matched without regard to case. */
export const RETIRED_IN_NAMES: readonly string[] = [
  "yours",
  "catchup",
  "wips",
  "wipnow",
  "wipahead",
  "wipbase",
  "wipstate",
  "wipmerge",
  "wipfacts",
  "wipdescription",
  "iswipline",
  "planwipcopy",
  "onwip",
  "wip_base",
  "discard",
]

/**
 * Identifiers that hold a retired name and keep it whole: a setting's key in
 * a person's `pinetrie.json`, which renaming would stop their file reading.
 */
export const KEPT_NAMES: readonly string[] = ["catchUp"]

/**
 * Files whose identifiers may hold a retired name: a migration's own words
 * for the shape it reads, and its fixtures in that shape.
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
]

/** Every identifier `text` names, each once, in order: bindings, references and property keys. */
export function identifierNames(file: string, text: string): readonly string[] {
  const names = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n)
      return
    }
    if (node === null || typeof node !== "object") return
    const n = node as { readonly type?: unknown; readonly name?: unknown }
    if (
      (n.type === "Identifier" ||
        n.type === "JSXIdentifier" ||
        n.type === "PrivateIdentifier") &&
      typeof n.name === "string"
    )
      names.add(n.name)
    for (const v of Object.values(node)) if (typeof v === "object") walk(v)
  }
  walk(parseSync(file, text).program)
  return [...names]
}

/** Each identifier of `source` that holds a word of `retired`, as `file: name`. */
export function retiredNames(
  source: Source,
  retired: readonly string[],
): readonly string[] {
  const lower = retired.map(w => w.toLowerCase())
  return identifierNames(source.file, source.text)
    .filter(name => !KEPT_NAMES.includes(name))
    .filter(name => lower.some(w => name.toLowerCase().includes(w)))
    .map(name => `${source.file}: ${name}`)
}

const CODE = ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"]
const NOT_CODE = ["**/node_modules/**", "**/dist/**"]

/** The code under `root` the identifier rule reads. */
export const readSources = (root: string): readonly Source[] =>
  globSync(CODE, { cwd: root, exclude: NOT_CODE })
    .toSorted()
    .map(file => ({
      file,
      text: readFileSync(path.join(root, file), "utf8"),
    }))

/** The heading of the glossary's list of phrases nothing says. */
export const NOTHING_SAYS = "## Phrases nothing says"

/**
 * The phrases `glossary` lists under `NOTHING_SAYS`: each bullet's quoted
 * phrase, up to the next heading.
 */
export function phrasesNothingSays(glossary: string): readonly string[] {
  const at = glossary.indexOf(`${NOTHING_SAYS}\n`)
  if (at === -1) return []
  const rest = glossary.slice(at + NOTHING_SAYS.length + 1)
  const end = rest.search(/^## /m)
  const section = end === -1 ? rest : rest.slice(0, end)
  return section
    .split("\n")
    .flatMap(line => /^- "([^"]+)"/.exec(line)?.[1] ?? [])
}

/** Each line of `source` that says one of `phrases`, any case, as `file:line: text`. */
export function retiredLines(
  source: Source,
  phrases: readonly string[],
): readonly string[] {
  const lower = phrases.map(p => p.toLowerCase())
  return source.text
    .split("\n")
    .flatMap((line, i) =>
      lower.some(p => line.toLowerCase().includes(p))
        ? [`${source.file}:${i + 1}: ${line.trim()}`]
        : [],
    )
}

/** The page, the host, the e2e suites, and every skill and lane note (`packages/pi`). */
const TEXTS = [
  "packages/**/*.{ts,tsx,mjs,md,json,html,css}",
  "apps/pinetrie/host/**/*.{ts,tsx,mjs,md,json}",
  "apps/pinetrie/e2e/**/*.{ts,tsx,mjs,md,json}",
]

/** What the text rule reads under `root`: what people and the agent read. */
export const readTexts = (root: string): readonly Source[] =>
  globSync(TEXTS, { cwd: root, exclude: NOT_CODE })
    .toSorted()
    .map(file => ({
      file,
      text: readFileSync(path.join(root, file), "utf8"),
    }))
