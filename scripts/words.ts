// scripts/words — where a retired word may not come back: inside the code's
// names, and in what people and the agent read. Pure, apart from
// `readTexts`; it reads the code through `scripts/sources.ts`.
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
import { type Node, OLD_SHAPES, type Source, walk } from "./sources.ts"

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
  // A thread in someone's inventory is never "held": that word is a paused
  // queue's or lane's.
  "heldwords",
  "heldbyothers",
  "cardholding",
]

/**
 * Identifiers that hold a retired name and keep it whole: a setting's key in
 * a person's `pinetrie.json`, which renaming would stop their file reading.
 */
export const KEPT_NAMES: readonly string[] = ["catchUp"]

const IDENTIFIERS = new Set([
  "Identifier",
  "JSXIdentifier",
  "PrivateIdentifier",
])

/** Every identifier `text` names, each once, in order: bindings, references and property keys. */
export function identifierNames(file: string, text: string): readonly string[] {
  const names = new Set<string>()
  walk(parseSync(file, text).program as unknown as Node, n => {
    if (IDENTIFIERS.has(n.type) && typeof n.name === "string") names.add(n.name)
  })
  return [...names]
}

/**
 * Each identifier of `source` that holds a word of `retired`, as `file: name`;
 * none in a file of a migration's old shapes (`OLD_SHAPES`).
 */
export function retiredNames(
  source: Source,
  retired: readonly string[],
  oldShapes: readonly string[] = OLD_SHAPES,
): readonly string[] {
  if (oldShapes.includes(source.file)) return []
  const lower = retired.map(w => w.toLowerCase())
  return identifierNames(source.file, source.text)
    .filter(name => !KEPT_NAMES.includes(name))
    .filter(name => lower.some(w => name.toLowerCase().includes(w)))
    .map(name => `${source.file}: ${name}`)
}

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

const NOT_TEXT = ["**/node_modules/**", "**/dist/**"]

/** The page, the host, the e2e suites, and every skill and lane note (`packages/pi`). */
const TEXTS = [
  "packages/**/*.{ts,tsx,mjs,md,json,html,css}",
  "apps/pinetrie/host/**/*.{ts,tsx,mjs,md,json}",
  "apps/pinetrie/e2e/**/*.{ts,tsx,mjs,md,json}",
]

/** What the text rule reads under `root`: what people and the agent read. */
export const readTexts = (root: string): readonly Source[] =>
  globSync(TEXTS, { cwd: root, exclude: NOT_TEXT })
    .toSorted()
    .map(file => ({
      file,
      text: readFileSync(path.join(root, file), "utf8"),
    }))
