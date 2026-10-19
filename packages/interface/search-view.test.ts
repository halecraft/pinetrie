import {
  type AgentMessageLike,
  type EntryId,
  entryId,
  indexAsks,
  projectRail,
  projectSpine,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { entry, indexEntries, personMessage } from "./fixtures.ts"
import { parseQuery, searchCorpus, searchTexts } from "./search.ts"
import {
  columnMatches,
  gapWords,
  itemMatches,
  matchCountWords,
  NO_MATCHES_HERE,
  searchLine,
} from "./search-view.ts"

const ada = writerId("ada@x.io")
const HOUR = 3_600_000
const said = (text: string): AgentMessageLike => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
// 1 Ada asks; 2–3 the agent works; 4 Ada again; 5 a branch off 1.
const index = indexEntries([
  entry(
    "1",
    null,
    personMessage("Fix the rail", { writer: ada, author: "Ada" }),
    { timestamp: 0 },
  ),
  entry("2", "1", said("looking at the rail"), { timestamp: HOUR }),
  entry("3", "2", said("done"), { timestamp: 2 * HOUR }),
  entry(
    "4",
    "3",
    personMessage("thanks, rail fixed", { writer: ada, author: "Ada" }),
  ),
  entry(
    "5",
    "1",
    personMessage("and the rail colours?", { writer: ada, author: "Ada" }),
  ),
])
const asks = indexAsks(index)
const nameOf = new Map([[ada, "Ada"]])
const result = (raw: string) => {
  const q = parseQuery(raw)
  if (q === null) throw new Error("no query")
  return searchTexts(searchCorpus(index, projectRail(index, entryId("1"))), q)
}
const nodes = (tip: string) => projectSpine(index, entryId(tip)).spine
const facts = { index, asks, nameOf, since: 3 * HOUR }

test("a column's matches are only the nodes it draws, in path order, with gaps counted between and around", () => {
  // The branch's column draws only 5: 1 is its parent column's.
  const branch = nodes("5").slice(1)
  expect(
    columnMatches(branch, result("rail"), facts).rows.map(r =>
      r.kind === "match" ? r.id : r.words,
    ),
  ).toEqual(["5"])
  const trunk = columnMatches(nodes("4"), result("rail"), facts)
  expect(trunk.rows.map(r => (r.kind === "match" ? r.id : r.words))).toEqual([
    "1",
    "2",
    gapWords(1),
    "4",
  ])
  expect(trunk.count).toBe(matchCountWords(3))
  const fixed = columnMatches(nodes("4"), result("fixed"), facts)
  expect(fixed.rows.map(r => (r.kind === "match" ? r.id : r.words))).toEqual([
    gapWords(3),
    "4",
  ])
  const looking = columnMatches(nodes("4"), result("looking"), facts)
  expect(looking.rows.map(r => (r.kind === "match" ? r.id : r.words))).toEqual([
    gapWords(1),
    "2",
    gapWords(2),
  ])
})

test("a column with no match says so", () => {
  expect(columnMatches(nodes("4"), result("nowhere"), facts)).toEqual({
    count: matchCountWords(0),
    rows: [],
    none: NO_MATCHES_HERE,
  })
})

test("a match says who wrote it, when, and the ask it is in; a prompt names none", () => {
  const [prompt, work] = columnMatches(nodes("4"), result("rail"), facts).rows
  expect(prompt).toMatchObject({
    who: "Ada",
    when: "3 h ago",
    at: 0,
    ask: null,
  })
  expect(work).toMatchObject({
    who: "agent",
    when: "2 h ago",
    ask: 'in Ada: "Fix the rail"',
  })
  const last = columnMatches(nodes("4"), result("fixed"), facts).rows.at(-1)
  expect(last).toMatchObject({ when: null, at: null })
})

test("the bar counts matches in no open column", () => {
  const shown = (...ids: string[]): ReadonlySet<EntryId> =>
    new Set(ids.map(entryId))
  expect(searchLine(result("rail"), shown("1", "2", "3", "4", "5"))).toBe(
    matchCountWords(4),
  )
  expect(searchLine(result("rail"), shown("1", "2", "3", "4"))).toBe(
    `${matchCountWords(4)} · 1 on a branch not open`,
  )
  expect(searchLine(result("rail"), shown("1"))).toBe(
    `${matchCountWords(4)} · 3 on branches not open`,
  )
  expect(searchLine(result("nowhere"), shown())).toBe("no matches")
  expect(searchLine(null, shown())).toBe("")
})

test("itemMatches: every match in a capsule counts; none is 0 while searching, null while not", () => {
  const ids = ["1", "2", "3"].map(entryId)
  expect(itemMatches(ids, result("rail"))).toBe(2)
  expect(itemMatches(ids, result("nowhere"))).toBe(0)
  expect(itemMatches(ids, null)).toBeNull()
})

describe("words", () => {
  test.each([
    [0, "no matches"],
    [1, "1 match"],
    [2, "2 matches"],
  ])("matchCountWords(%d)", (n, words) => {
    expect(matchCountWords(n)).toBe(words)
  })
  test.each([
    [1, "⋯ 1 message"],
    [12, "⋯ 12 messages"],
  ])("gapWords(%d)", (n, words) => {
    expect(gapWords(n)).toBe(words)
  })
})
