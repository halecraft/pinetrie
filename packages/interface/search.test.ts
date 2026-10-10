import { entryId, projectRail, taskIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { entry, indexOf } from "./fixtures.ts"
import {
  parseQuery,
  type Query,
  type SearchText,
  searchCorpus,
  searchOn,
  searchReducer,
  searchTexts,
  snippet,
} from "./search.ts"

const query = (raw: string): Query => {
  const q = parseQuery(raw)
  if (q === null) throw new Error(`no query in ${JSON.stringify(raw)}`)
  return q
}
const corpus = (...texts: string[]): readonly SearchText[] =>
  texts.map((text, n) => ({ id: entryId(`m${n}`), text }))
/** The matched strings in each text, in order. */
const found = (raw: string, ...texts: string[]): string[][] => {
  const { hits } = searchTexts(corpus(...texts), query(raw))
  return texts.map((text, n) =>
    (hits.get(entryId(`m${n}`)) ?? []).map(r => text.slice(r.from, r.to)),
  )
}

describe("a match starts where a word starts", () => {
  test.each([
    ["the rail.", ["rail"]],
    ["(rail)", ["rail"]],
    ["rail-view", ["rail"]],
    ["trail", []],
    ["raïl", []],
    ["éraile", []],
    ["9rail", []],
    ["_rail", []],
  ])("%s", (text, expected) => {
    expect(found("rail", text)).toEqual([expected])
  })
})

describe("the last word may start a longer word, and the match takes the whole word", () => {
  test.each([
    ["colum", "the column.", ["column"]],
    ["colum", "two columns", ["columns"]],
    ["rail", "railé, rail_way", ["railé", "rail_way"]],
    ["rail", "rail\u0301", ["rail\u0301"]],
    ["fix the col", "fix the column now", ["fix the column"]],
  ])("%s in %s", (query, text, expected) => {
    expect(found(query, text)).toEqual([expected])
  })
})

test("a word before the last is whole", () => {
  expect(found("fi the", "fix the rail")).toEqual([[]])
  expect(found("rail fix", "rails fix it", "rail fixes")).toEqual([
    [],
    ["rail fixes"],
  ])
})

test("matching ignores case", () => {
  expect(found("Rail", "the RAIL and the rail")).toEqual([["RAIL", "rail"]])
})

test("a query's words match as one phrase across any whitespace, in order", () => {
  expect(
    found("fix  the rail", "fix the\n  rail", "the rail fix", "fix rail"),
  ).toEqual([["fix the\n  rail"], [], []])
})

test("a query edge that is no word character needs no boundary: @ada, c++, (x)", () => {
  expect(found("@ada", "ask @ada now", "mail@ada")).toEqual([
    ["@ada"],
    ["@ada"],
  ])
  expect(found("c++", "in c++17")).toEqual([["c++"]])
  expect(found("(x)", "f(x)y")).toEqual([["(x)"]])
})

test("a query of only spaces is no search", () => {
  expect(parseQuery("  \n ")).toBeNull()
  expect(parseQuery("")).toBeNull()
  expect(parseQuery(" a  b ")).toEqual({ words: ["a", "b"] })
})

test("a query of e plus a combining accent finds é typed as one character", () => {
  expect(found("cafe\u0301", "un café.")).toEqual([["café"]])
})

test("every match in a message is found, in order", () => {
  const { hits } = searchTexts(corpus("a rail, a rail, a rail"), query("rail"))
  expect(hits.get(entryId("m0"))).toEqual([
    { from: 2, to: 6 },
    { from: 10, to: 14 },
    { from: 18, to: 22 },
  ])
  expect(searchTexts(corpus("nothing"), query("rail")).hits.size).toBe(0)
})

test("searchCorpus: every message of the root, as a reader sees its text", () => {
  const index = indexOf([
    entry("1", null, { role: "chat", content: "Fix the rail" }),
    entry("2", "1", {
      role: "assistant",
      content: [
        { type: "text", text: "Looking" },
        {
          type: "toolCall",
          id: "c",
          name: "bash",
          arguments: { command: "rail" },
        },
      ],
    }),
    entry("3", "2", { role: "toolResult", toolCallId: "c", content: "rail" }),
    entry("4", "1", { role: "chat", content: "a branch" }),
  ])
  expect(searchCorpus(index, projectRail(index, entryId("1")))).toEqual([
    { id: "1", text: "Fix the rail" },
    { id: "2", text: "Looking" },
    { id: "4", text: "a branch" },
  ])
})

describe("snippet", () => {
  const cut = (text: string, raw: string, max: number) => {
    const ranges = searchTexts(corpus(text), query(raw)).hits.get(entryId("m0"))
    if (ranges === undefined) throw new Error("no match")
    return snippet(text, ranges, max)
  }
  const read = (parts: ReturnType<typeof snippet>) =>
    parts.map(p => (p.match ? `[${p.text}]` : p.text)).join("")

  test("a short text is whole, its line breaks read as spaces", () => {
    expect(read(cut("Fix\nthe rail", "rail", 40))).toBe("Fix the [rail]")
  })

  test("a long text is cut at spaces around its first match, with …", () => {
    const text =
      "one two three four five six seven eight rail nine ten eleven twelve thirteen"
    const s = read(cut(text, "rail", 24))
    expect(s).toMatch(/^….*\[rail\].*…$/)
    expect(s).not.toMatch(/…\S*[a-z]…/)
    // Each end is a whole word of the text.
    const words = s
      .replace(/…|\[|\]/g, "")
      .trim()
      .split(" ")
    expect(words.every(w => text.split(" ").includes(w))).toBe(true)
  })

  test("it marks every match it holds, and never splits one", () => {
    const text = `${"x ".repeat(20)}rail and rail and${" y".repeat(20)}`
    expect(read(cut(text, "rail", 30))).toContain("[rail] and [rail]")
    for (let max = 4; max < 40; max += 1) {
      const parts = cut(text, "rail", max)
      expect(parts.filter(p => p.match).every(p => p.text === "rail")).toBe(
        true,
      )
      // No "rail" is left in the text unmarked, whole or cut.
      const plain = parts.filter(p => !p.match).map(p => p.text)
      expect(plain.some(p => /r|ai|il/.test(p))).toBe(false)
    }
  })
})

test("opening starts empty, on the task it is opened on, and another task's search does not apply here", () => {
  const t1 = taskIdFor("t1")
  const open = searchReducer(null, { kind: "open", task: t1 }, 5)
  expect(open).toEqual({ task: t1, query: "", since: 5 })
  const typed = searchReducer(open, { kind: "type", query: "rail" }, 9)
  expect(typed).toEqual({ task: t1, query: "rail", since: 5 })
  expect(searchReducer(typed, { kind: "open", task: t1 }, 9)).toBe(typed)
  expect(searchReducer(typed, { kind: "clear" }, 9)).toEqual(open)
  expect(searchReducer(typed, { kind: "close" }, 9)).toBeNull()
  expect(searchReducer(null, { kind: "type", query: "x" }, 9)).toBeNull()
  expect(searchOn(typed, { kind: "task", task: t1 })).toBe(typed)
  expect(searchOn(typed, { kind: "task", task: taskIdFor("t2") })).toBeNull()
  expect(searchOn(typed, { kind: "new", key: "t" })).toBeNull()
  expect(searchOn(typed, null)).toBeNull()
})
