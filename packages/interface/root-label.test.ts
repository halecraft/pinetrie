import {
  canvasIdFor,
  entryId,
  type LaneRecord,
  type RootRecord,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { landedThreadCard } from "@pinetrie/rules/fixtures"
import { describe, expect, test } from "vitest"
import { canvasesWith } from "./fixtures.ts"
import {
  CHAT_LABEL,
  labelInitials,
  messageCount,
  messageCountTitle,
  planTitle,
  renameKey,
  taskLabels,
  taskSummaries,
} from "./root-label.ts"

const record = (
  n: string,
  firstLine: string,
  _title: string | null,
): RootRecord => ({
  root: rootIdFor(n),
  entry: entryId(`e-${n}`),
  first: entryId(`e-${n}`),
  firstLine,
  messages: 2,
  newest: entryId(`f-${n}`),
  writers: [writerId("p-ada")],
  threads: {},
  mentions: [],
  blobs: [],
})
const directory = new Map(
  [
    record("1", "I'd like to start talking about a change", "Tab names"),
    record("2", "Plan the release", null),
    { ...record("3", "", null), entry: null, first: null, messages: 0 },
  ].map(r => [r.root, r] as const),
)

/** Each root's canvas, one a root, its thread `t-<n>`; canvas 1 titled. */
const K = (n: string) => canvasIdFor(n)
const thread = (n: string) => threadIdFor(`thread-${n}`)
const threads = new Map(
  ["1", "2", "3"].map(n => [
    thread(n),
    {
      thread: thread(n),
      root: rootIdFor(n),
      by: writerId("p-ada"),
      createdAt: 0,
      origin: { kind: "root" as const },
    },
  ]),
)
const canvases = canvasesWith({
  known: ["1", "2", "3"].map(K),
  cards: ["1", "2", "3"].map(n =>
    landedThreadCard({
      thread: thread(n),
      canvas: K(n),
      by: writerId("p-ada"),
      cards: [],
    }),
  ),
  threads,
})
const marks = new Map([
  [
    K("1"),
    { canvas: K("1"), title: "Tab names", by: writerId("p-ada"), at: 1 },
  ],
])

describe("labels and summaries, from the directory", () => {
  const laneIn = (n: string): [LaneRecord["lane"], LaneRecord] => {
    const lane = threadIdFor(n)
    return [
      lane,
      {
        lane,
        root: rootIdFor(n),
        history: null,
        by: writerId("p-ada"),
        createdAt: 0,
      },
    ]
  }
  const worked = new Map([laneIn("1"), laneIn("2")])

  test("a titled canvas is called by its title, another by its first root's first line; a canvas whose root has no message yet by neither", () => {
    const labels = taskLabels({ canvases, marks, directory, lanes: worked })
    expect(labels.get(K("1"))).toBe("Tab names")
    expect(labels.get(K("2"))).toBe("Plan the release")
    expect(labels.get(K("3"))).toBe(CHAT_LABEL)
  })

  test("an untitled canvas no lane works in is a chat; a title still names it", () => {
    const labels = taskLabels({
      canvases,
      marks,
      directory,
      lanes: new Map([laneIn("3")]),
    })
    expect(labels.get(K("1"))).toBe("Tab names")
    expect(labels.get(K("2"))).toBe(CHAT_LABEL)
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

  test("summaries: each canvas whose first root has a message, its first line, writers and newest message", () => {
    expect(taskSummaries(canvases, directory)).toEqual(
      new Map([
        [
          K("1"),
          {
            line: "I'd like to start talking about a change",
            writers: [writerId("p-ada")],
            newest: entryId("f-1"),
          },
        ],
        [
          K("2"),
          {
            line: "Plan the release",
            writers: [writerId("p-ada")],
            newest: entryId("f-2"),
          },
        ],
      ]),
    )
  })

  test("summaries: a canvas over two roots reads its first root's line, every root's writers and the newest message", () => {
    const two = canvasesWith({
      known: [K("1")],
      cards: ["1", "2"].map((n, i) =>
        landedThreadCard({
          thread: thread(n),
          canvas: K("1"),
          by: writerId("p-ada"),
          cards:
            i === 0
              ? []
              : [
                  landedThreadCard({
                    thread: thread("1"),
                    canvas: K("1"),
                    by: writerId("p-ada"),
                    cards: [],
                  }),
                ],
        }),
      ),
      threads,
    })
    const both = new Map([
      ...directory,
      [
        rootIdFor("2"),
        {
          ...(directory.get(rootIdFor("2")) as RootRecord),
          writers: [writerId("p-bea")],
        },
      ],
    ])
    expect(taskSummaries(two, both).get(K("1"))).toEqual({
      line: "I'd like to start talking about a change",
      writers: [writerId("p-ada"), writerId("p-bea")],
      newest: entryId("f-2"),
    })
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

describe("labelInitials", () => {
  test.each<[string, string]>([
    ["Kanban outside click", "KO"],
    ["Sidebar", "SI"],
    ["RFC-0048 next steps", "R0"],
    ["  project menu: jj state", "PM"],
    ["été à Paris", "ÉÀ"],
    ["(no text)", "NT"],
    ["…", ""],
  ])("%s → %s", (label, letters) => {
    expect(labelInitials(label)).toBe(letters)
  })
})
