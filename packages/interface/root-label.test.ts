import {
  entryId,
  type LaneRecord,
  laneNameForThread,
  type RootRecord,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  CHAT_LABEL,
  firstLinesOf,
  initialsOf,
  labelsOf,
  messageCount,
  messageCountTitle,
  planTitle,
  renameKey,
  summariesOf,
} from "./root-label.ts"

const record = (
  n: string,
  firstLine: string,
  title: string | null,
): RootRecord => ({
  root: rootIdFor(n),
  entry: entryId(`e-${n}`),
  first: entryId(`e-${n}`),
  firstLine,
  title,
  messages: 2,
  newest: entryId(`f-${n}`),
  writers: [writerId("p-ada")],
  threads: {},
  mentions: [],
  images: [],
})
const directory = new Map(
  [
    record("1", "I'd like to start talking about a change", "Tab names"),
    record("2", "Plan the release", null),
    { ...record("3", "", null), entry: null, first: null, messages: 0 },
  ].map(r => [r.root, r] as const),
)

describe("labels and summaries, from the directory (ADR-0063)", () => {
  const laneIn = (n: string): [LaneRecord["lane"], LaneRecord] => {
    const lane = laneNameForThread(n)
    return [
      lane,
      {
        lane,
        root: rootIdFor(n),
        work: null,
        by: writerId("p-ada"),
        createdAt: 0,
      },
    ]
  }
  const worked = new Map([laneIn("1"), laneIn("2")])

  test("a titled root is called by its title, another by its first line; a root with no message by neither", () => {
    const labels = labelsOf(directory, worked)
    expect(labels.get(entryId("e-1"))).toBe("Tab names")
    expect(labels.get(entryId("e-2"))).toBe("Plan the release")
    expect(labels.size).toBe(2)
    expect(firstLinesOf(directory).get(entryId("e-1"))).toBe(
      "I'd like to start talking about a change",
    )
  })

  test("an untitled root no lane works in is a chat; a title still names it", () => {
    const labels = labelsOf(directory, new Map([laneIn("3")]))
    expect(labels.get(entryId("e-1"))).toBe("Tab names")
    expect(labels.get(entryId("e-2"))).toBe(CHAT_LABEL)
  })

  test("the header's count: the held roots' messages, of every root's", () => {
    expect(messageCount(directory, new Set())).toEqual({ held: 0, total: 4 })
    expect(messageCount(directory, new Set([rootIdFor("2")]))).toEqual({
      held: 2,
      total: 4,
    })
  })

  test.each([
    [
      { held: 2, total: 4 },
      "2 in the threads this tab has loaded, of 4 in the session",
    ],
  ])("messageCountTitle(%o)", (count, words) => {
    expect(messageCountTitle(count)).toBe(words)
  })

  test("summaries: each root with a message, by its root entry", () => {
    expect(summariesOf(directory)).toEqual(
      ["1", "2"].map(n => ({
        root: entryId(`e-${n}`),
        first: entryId(`e-${n}`),
        messages: 2,
        newest: entryId(`f-${n}`),
        writers: [writerId("p-ada")],
      })),
    )
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

describe("initialsOf", () => {
  test.each<[string, string]>([
    ["Kanban outside click", "KO"],
    ["Sidebar", "SI"],
    ["ADR-0048 next steps", "A0"],
    ["  project menu: jj state", "PM"],
    ["été à Paris", "ÉÀ"],
    ["(no text)", "NT"],
    ["…", ""],
  ])("%s → %s", (label, letters) => {
    expect(initialsOf(label)).toBe(letters)
  })
})
