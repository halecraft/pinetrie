// interface/search — finding a phrase in the canvas you are on: the query, the
// matcher, a match's snippet, and the search's own state.
//
// A match starts at a word's start, and every word but the last is whole;
// the last may be the start of a longer word, since it may be the one still
// being typed: "colum" finds "column". `\b` cannot say where a word starts:
// in JavaScript it knows only ASCII word characters, so it would find "rail"
// in "éraile". The edges here are Unicode classes instead.

import {
  type CanvasId,
  type EntryId,
  entryMessage,
  type RailRow,
  type TreeIndex,
} from "@pinetrie/core"
import type { Here } from "./layout.ts"

/** The search of the canvas you are on; null while the bar is closed. Never stored. */
export interface SearchState {
  readonly canvas: CanvasId
  readonly query: string
  /** When it opened: the match rows' "3 h ago" are from then. */
  readonly since: number
}

export type SearchAct =
  /** Starts empty; a search open on `canvas` already is kept as it is. */
  | { readonly kind: "open"; readonly canvas: CanvasId }
  | { readonly kind: "type"; readonly query: string }
  | { readonly kind: "clear" }
  | { readonly kind: "close" }

/** A search act as a reader asks it: `open` on whatever canvas they are on. */
export type SearchAsk =
  | { readonly kind: "open" }
  | Exclude<SearchAct, { readonly kind: "open" }>

/** The act `ask` is on `here`; opening needs a canvas, so on none it is none. */
export function searchActOn(
  ask: SearchAsk,
  here: Here | null,
): SearchAct | null {
  if (ask.kind !== "open") return ask
  return here?.kind === "canvas" ? { kind: "open", canvas: here.canvas } : null
}

/** `now` is the shell's, read as the act is performed; only `open` keeps it. */
export function searchReducer(
  s: SearchState | null,
  act: SearchAct,
  now: number,
): SearchState | null {
  switch (act.kind) {
    case "open":
      return s !== null && s.canvas === act.canvas
        ? s
        : { canvas: act.canvas, query: "", since: now }
    case "type":
      return s === null || s.query === act.query
        ? s
        : { ...s, query: act.query }
    case "clear":
      return s === null || s.query === "" ? s : { ...s, query: "" }
    case "close":
      return null
  }
}

/** The search that applies on `here`: none when it was opened on another canvas. */
export const searchOn = (
  s: SearchState | null,
  here: Here | null,
): SearchState | null =>
  s !== null && here?.kind === "canvas" && here.canvas === s.canvas ? s : null

/** A query's words, in order, matched as one phrase. */
export interface Query {
  readonly words: readonly [string, ...string[]]
}

/**
 * The words of a query; null when it has none, which is no search. Composed
 * (NFC), as `mentionHandle` composes a name; the text searched is left as stored,
 * since composing it would move the ranges a snippet cuts by.
 */
export function parseQuery(raw: string): Query | null {
  const [first, ...rest] = raw
    .normalize("NFC")
    .split(/\s+/u)
    .filter(w => w !== "")
  return first === undefined ? null : { words: [first, ...rest] }
}

/**
 * What a word is made of, for a match's edges. Not core's handle characters:
 * a handle counts `-` as its own, and prose does not, so `rail` finds
 * "rail-view".
 */
const WORD = "\\p{L}\\p{N}\\p{M}_"
const WORD_CHAR = new RegExp(`^[${WORD}]$`, "u")
const isWordChar = (c: string | undefined): boolean =>
  c !== undefined && WORD_CHAR.test(c)

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")

/**
 * The query's pattern: its words separated by any whitespace, so each word
 * but the last ends where a space does. A first word starting with a word
 * character starts no later than a word does (`@ada`'s start needs nothing).
 * A last word ending in one runs on to its word's end, so a match, and what
 * a snippet marks, is the whole word: "colum" matches "columns".
 */
function queryPattern(query: Query): RegExp {
  const first = query.words[0]
  const last = query.words[query.words.length - 1] ?? first
  const body = query.words.map(literal).join("\\s+")
  const before = isWordChar(first[0]) ? `(?<![${WORD}])` : ""
  const rest = isWordChar(last.at(-1)) ? `[${WORD}]*` : ""
  return new RegExp(`${before}${body}${rest}`, "giu")
}

/** A message's text, as searched. */
export interface SearchText {
  readonly id: EntryId
  readonly text: string
}

/**
 * Every message on a canvas's rail, with its text as a reader sees it (`entryMessage`):
 * people's, the agent's, the host's one-line messages. Tool calls and their
 * results are not searched.
 */
export const searchCorpus = (
  index: TreeIndex,
  rows: readonly RailRow[],
): readonly SearchText[] =>
  rows.flatMap(r => {
    const m = entryMessage(index, r.id)
    return m === null ? [] : [{ id: r.id, text: m.text }]
  })

/** A match's place in its message's text, in UTF-16 units. */
export interface Range {
  readonly from: number
  readonly to: number
}

export interface SearchResult {
  /** Each matching message, with every match in its text, in order. */
  readonly hits: ReadonlyMap<EntryId, readonly [Range, ...Range[]]>
}

export function searchTexts(
  corpus: readonly SearchText[],
  query: Query,
): SearchResult {
  const pattern = queryPattern(query)
  const hits = new Map<EntryId, readonly [Range, ...Range[]]>()
  for (const { id, text } of corpus) {
    const [first, ...rest] = [...text.matchAll(pattern)].map(m => ({
      from: m.index,
      to: m.index + m[0].length,
    }))
    if (first !== undefined) hits.set(id, [first, ...rest])
  }
  return { hits }
}

/** A run of a snippet's text, marked when it is a match. */
export interface SnippetPart {
  readonly text: string
  readonly match: boolean
}

/**
 * `text` cut to about `max` characters around its first match, at spaces
 * where it can, with "…" where it was cut. Every match inside the cut is
 * marked, and one the cut would split is taken whole. Line breaks read as
 * spaces, one for one, so the ranges still hold.
 */
export function snippet(
  text: string,
  ranges: readonly [Range, ...Range[]],
  max: number,
): readonly SnippetPart[] {
  const flat = text.replace(/[\r\n\t]/g, " ")
  const first = ranges[0]
  let start = 0
  let end = flat.length
  if (flat.length > max) {
    const room = Math.max(0, max - (first.to - first.from))
    start = Math.max(0, first.from - Math.floor(room / 2))
    end = Math.min(flat.length, Math.max(first.to, start + max))
    start = Math.max(0, Math.min(start, end - max, first.from))
    // At a space where there is one between the cut and the match.
    if (start > 0 && flat[start - 1] !== " ") {
      const space = flat.indexOf(" ", start)
      if (space !== -1 && space < first.from) start = space + 1
    }
    if (end < flat.length && flat[end] !== " ") {
      const space = flat.lastIndexOf(" ", end)
      if (space >= first.to) end = space
    }
    for (const r of ranges) {
      if (r.from < start && r.to > start) start = r.from
      if (r.from < end && r.to > end) end = r.to
    }
  }
  const parts: SnippetPart[] = []
  const add = (s: string, match: boolean) => {
    if (s !== "") parts.push({ text: s, match })
  }
  let at = start
  for (const r of ranges) {
    if (r.from < start || r.to > end) continue
    add(flat.slice(at, r.from), false)
    add(flat.slice(r.from, r.to), true)
    at = r.to
  }
  add(flat.slice(at, end), false)
  return [
    ...(start > 0 ? [{ text: "…", match: false }] : []),
    ...parts,
    ...(end < flat.length ? [{ text: "…", match: false }] : []),
  ]
}
