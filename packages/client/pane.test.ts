import { readFileSync } from "node:fs"
import {
  commitId,
  type EntryId,
  entryId,
  indexAsks,
  laneNameForThread,
  type RevisionRecord,
  type Sha256,
  type SpineNode,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { ReviewTarget } from "./column-view.ts"
import { entry, indexOf } from "./fixtures.ts"
import {
  ASK_REVIEW_LINE,
  askReviewTarget,
  imageTitle,
  NARROW_REM,
  type PaneFacts,
  type PaneSubject,
  paneCloseWords,
  paneView,
  type TableOpenState,
  tableOpenWords,
  tableTitle,
  togglePane,
} from "./pane.ts"

const SHA = "a".repeat(64) as Sha256
const lane = laneNameForThread("x")
const target: ReviewTarget = {
  lane,
  spans: [{ kind: "range", from: commitId("a0"), to: commitId("a1") }],
  conflicts: [],
  yourEdits: [],
}
const node = (id: string, text: string): SpineNode => ({
  id: entryId(id),
  role: "chat",
  text,
  branches: [],
})
const TABLES = "| State | When |\n|---|---|\n| x | y |\n\n| a |\n|---|\n| 1 |"
const facts = (over: Partial<PaneFacts> = {}): PaneFacts => ({
  offer: null,
  nodes: [node("m1", TABLES)],
  askTarget: () => null,
  ...over,
})

const table = (entry: string, nth: number): PaneSubject => ({
  kind: "table",
  entry: entryId(entry),
  nth,
})
const image = (from: string | null): PaneSubject => ({
  kind: "image",
  sha256: SHA,
  from: from === null ? null : entryId(from),
  alt: "",
})

describe("togglePane", () => {
  test("opening what is shown closes it", () => {
    expect(togglePane(table("m1", 0), table("m1", 0))).toBeNull()
    expect(togglePane({ kind: "offer" }, { kind: "offer" })).toBeNull()
  })
  test("anything else replaces it: another kind, table or message", () => {
    const next = table("m1", 1)
    expect(togglePane({ kind: "offer" }, next)).toBe(next)
    expect(togglePane(table("m1", 0), next)).toBe(next)
    expect(togglePane(table("m2", 1), next)).toBe(next)
    const there = image("m2")
    expect(togglePane(image("m1"), there)).toBe(there)
    expect(togglePane(null, there)).toBe(there)
  })
})

describe("paneView", () => {
  test("the offer draws the strip's review, and closes without one", () => {
    expect(paneView({ kind: "offer" }, facts())).toBeNull()
    expect(
      paneView({ kind: "offer" }, facts({ offer: { target, line: "ready" } })),
    ).toEqual({ kind: "review", target, line: "ready" })
  })
  test("an ask draws its review, and closes without one", () => {
    const ask: PaneSubject = { kind: "ask", ask: entryId("p") }
    expect(paneView(ask, facts())).toBeNull()
    expect(paneView(ask, facts({ askTarget: () => target }))).toEqual({
      kind: "review",
      target,
      line: ASK_REVIEW_LINE,
    })
  })
  test("a table is drawn from its message, titled by its header row", () => {
    const shown = (nth: number) => {
      const view = paneView(table("m1", nth), facts())
      return view?.kind === "table"
        ? [view.title, view.table.properties.dataTable]
        : null
    }
    expect(shown(0)).toEqual(["State · When", 0])
    expect(shown(1)).toEqual(["a", 1])
  })
  test("the same node gives the same table, so the pane draws it once", () => {
    const nodes = [node("m1", TABLES)]
    const once = paneView(table("m1", 0), facts({ nodes }))
    const again = paneView(table("m1", 0), facts({ nodes }))
    expect(once?.kind === "table" && again?.kind === "table").toBe(true)
    expect(once?.kind === "table" && once.table).toBe(
      again?.kind === "table" && again.table,
    )
  })
  test("a table closes when its message is not drawn, or has no such table", () => {
    expect(paneView(table("m2", 0), facts())).toBeNull()
    expect(paneView(table("m1", 2), facts())).toBeNull()
  })
  test("an image closes when its message is not drawn; a streaming one stays", () => {
    expect(paneView(image("m2"), facts())).toBeNull()
    expect(paneView(image("m1"), facts())).toMatchObject({
      kind: "image",
      src: `/blob/${SHA}`,
    })
    expect(paneView(image(null), facts({ nodes: [] }))?.kind).toBe("image")
  })
})

describe("askReviewTarget", () => {
  const index = indexOf([
    entry("p", null, { role: "chat", content: "do it" }),
    entry("a", "p", {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    }),
  ])
  const asks = indexAsks(index)
  const rev = (at: string, commit: string): [EntryId, RevisionRecord] => [
    entryId(at),
    {
      entry: entryId(at),
      lane,
      commit: commitId(commit),
      snapshot: null,
      paths: [],
      conflicts: [],
    },
  ]
  const revisions = new Map([rev("p", "a0"), rev("a", "a1")])
  test("the ask's range, titled with its line", () => {
    expect(
      askReviewTarget(index, asks, revisions, entryId("p"), "Ada: do it"),
    ).toEqual({ ...target, title: "Ada: do it" })
  })
  test("none when the ask changed nothing", () => {
    expect(
      askReviewTarget(index, asks, new Map(), entryId("p"), null),
    ).toBeNull()
  })
})

test("NARROW_REM is where .pane's width stops fitting beside the thread", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
  const width = /\.pane \{[^}]*clamp\((\d+)rem, 100vw - (\d+)rem/.exec(html)
  expect(width).not.toBeNull()
  expect(Number(width?.[1]) + Number(width?.[2])).toBe(NARROW_REM)
})

describe("words", () => {
  test.each<[TableOpenState, string, string]>([
    ["closed", "open the table beside the thread", "open beside the thread"],
    ["shown", "close the table", "close the table"],
    [
      "streaming",
      "open the table beside the thread",
      "the reply is still being written",
    ],
  ])("tableOpenWords(%s)", (state, label, title) => {
    expect(tableOpenWords(state)).toEqual({ label, title })
  })
  test.each([
    [true, "←", "back to the thread"],
    [false, "×", "close"],
  ])("paneCloseWords(%s)", (narrow, glyph, label) => {
    expect(paneCloseWords(narrow)).toEqual({ glyph, label })
  })
  test.each<[readonly string[], string]>([
    [["State", "When"], "State · When"],
    [["", "When"], "When"],
    [[], "table"],
  ])("tableTitle(%j)", (heads, title) => {
    expect(tableTitle(heads)).toBe(title)
  })
  test.each<[string, string | undefined, string]>([
    ["shot", "a note", "shot"],
    ["", "a note", "a note"],
    ["", undefined, "image"],
  ])("imageTitle(%j, %j)", (alt, title, words) => {
    expect(imageTitle(alt, title)).toBe(words)
  })
})
