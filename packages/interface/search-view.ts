// interface/search-view — what a search shows: each column's own matches, as
// rows with the gaps between them; the bar's line; and the words of both.
//
// A match belongs to the column that draws its message (`ColumnView.nodes`),
// so no match is drawn twice. One match is one message, however often the
// phrase is in it.

import {
  type AskIndex,
  type EntryId,
  entryAsk,
  type SpineNode,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"
import { askLine } from "./ask-words.ts"
import { ago, count, plural } from "./counts.ts"
import { speakerWords } from "./names.ts"
import { type SearchResult, type SnippetPart, snippet } from "./search.ts"

/** How long a match's snippet is, in characters, before "…". */
const SNIPPET = 140

export type MatchRow =
  | {
      readonly kind: "match"
      readonly id: EntryId
      /** Who wrote it (`speakerWords`). */
      readonly who: string
      /** "3 h ago" from when the search opened; null with no timestamp. */
      readonly when: string | null
      /** When it was written, in ms, for the row's title; null with none. */
      readonly at: number | null
      /** The ask it is in, when it is in an ask's work: `in Ada: "Fix…"`. */
      readonly ask: string | null
      readonly snippet: readonly SnippetPart[]
    }
  | { readonly kind: "gap"; readonly words: string }

export interface ColumnMatches {
  /** The header's count: "4 matches". */
  readonly count: string
  readonly rows: readonly MatchRow[]
  /** Said in place of rows when there are none. */
  readonly none: string | null
}

/**
 * A column's matches: its nodes that hit, in path order (which is time
 * order), with a gap line for each run of messages between, before and after.
 */
export function columnMatches(
  nodes: readonly SpineNode[],
  result: SearchResult,
  facts: {
    readonly index: TreeIndex
    readonly asks: AskIndex
    readonly nameOf: ReadonlyMap<WriterId, string>
    readonly since: number
  },
): ColumnMatches {
  const rows: MatchRow[] = []
  let gap = 0
  let found = 0
  const closeGap = () => {
    if (gap > 0) rows.push({ kind: "gap", words: gapWords(gap) })
    gap = 0
  }
  for (const node of nodes) {
    const ranges = result.hits.get(node.id)
    if (ranges === undefined) {
      gap += 1
      continue
    }
    closeGap()
    found += 1
    const at = facts.index.entries[node.id]?.timestamp ?? null
    const ask = entryAsk(facts.asks, node.id) ?? null
    const line =
      ask === null || ask === node.id
        ? null
        : askLine(facts.index, ask, w => displayName(w, facts.nameOf.get(w)))
    rows.push({
      kind: "match",
      id: node.id,
      who: speakerWords(node, facts.nameOf),
      when: at === null ? null : ago(at, facts.since),
      at,
      ask: line === null ? null : matchAskWords(line),
      snippet: snippet(node.text, ranges, SNIPPET),
    })
  }
  if (found === 0)
    return { count: matchCountWords(0), rows: [], none: NO_MATCHES_HERE }
  closeGap()
  return { count: matchCountWords(found), rows, none: null }
}

/** How many of a rail item's messages hit: null while not searching. */
export const itemMatches = (
  ids: readonly EntryId[],
  result: SearchResult | null,
): number | null =>
  result === null ? null : ids.filter(id => result.hits.has(id)).length

/**
 * The bar's line: every match, and how many are in no column (`shown`, the
 * ids of every open column's path). Empty while nothing is searched.
 */
export function searchLine(
  result: SearchResult | null,
  shown: ReadonlySet<EntryId>,
): string {
  if (result === null) return ""
  const total = result.hits.size
  if (total === 0) return matchCountWords(0)
  const away = [...result.hits.keys()].filter(id => !shown.has(id)).length
  return away === 0
    ? matchCountWords(total)
    : `${matchCountWords(total)} · ${awayWords(away)}`
}

/** "no matches", "1 match", "4 matches". */
export const matchCountWords = (n: number): string =>
  n === 0 ? "no matches" : count(n, "match", "matches")

/** What a column leaves out between matches: "⋯ 12 messages". */
export const gapWords = (n: number): string => `⋯ ${plural(n, "message")}`

const awayWords = (n: number): string =>
  n === 1 ? "1 on a branch not open" : `${n} on branches not open`

const matchAskWords = (line: string): string => `in ${line}`

export const NO_MATCHES_HERE = "no matches in this thread"
export const SEARCH_FIELD_LABEL = "search this task"
export const SEARCH_OPEN_TITLE = "search this task · /"
export const SEARCH_CLOSE_TITLE = "close search · Esc"
export const SEARCH_CLEAR = "clear the search"
export const SEARCH_DONE = "done"
export const SEARCH_DONE_TITLE = "back to the threads · Esc"
