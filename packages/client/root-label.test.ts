import {
  type EntryLike,
  entryId,
  indexTree,
  type MarkRecord,
  summarizeRoots,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { firstLines, planTitle, renameKey, rootLabels } from "./root-label.ts"

const chat = (id: string, text: string): EntryLike => ({
  id,
  parentId: null,
  type: "message",
  message: {
    role: "chat",
    content: text,
    author: "Ada",
    writer: writerId("p-ada"),
  },
})
const index = indexTree(
  Object.fromEntries(
    [
      chat("r1", "I'd like to start talking about a change\nwith you"),
      chat("r2", "Plan the release"),
    ].map(e => [e.id, e]),
  ),
)
const mark: MarkRecord = {
  entry: entryId("r1"),
  title: "Tab names",
  by: writerId("p-ada"),
  at: 1,
}

describe("rootLabels", () => {
  test("a titled root is called by its title, another by its first line", () => {
    const lines = firstLines(summarizeRoots(index), index)
    const labels = rootLabels(lines, new Map([["r1", mark]]))
    expect(labels.get("r1")).toBe("Tab names")
    expect(labels.get("r2")).toBe("Plan the release")
    expect(lines.get("r1")).toBe("I'd like to start talking about a change")
  })
})

describe("planTitle", () => {
  test("an invalid title is refused", () => {
    expect(planTitle("x".repeat(81), null)).toEqual({ kind: "refuse" })
  })
  test("the stored title, and clearing no title, send nothing", () => {
    expect(planTitle(" Tab names ", "Tab names")).toEqual({
      kind: "unchanged",
    })
    expect(planTitle("  ", null)).toEqual({ kind: "unchanged" })
  })
  test("a new title is sent trimmed, and clearing a title sends null", () => {
    expect(planTitle(" Tabs ", "Tab names")).toEqual({
      kind: "send",
      title: "Tabs",
    })
    expect(planTitle("", "Tab names")).toEqual({ kind: "send", title: null })
  })
})

test("renameKey: Enter saves, Escape leaves the title as it was; both refocus", () => {
  expect(renameKey("Enter")).toEqual({ save: true, refocus: true })
  expect(renameKey("Escape")).toEqual({ save: false, refocus: true })
  expect(renameKey("a")).toBe(null)
})
