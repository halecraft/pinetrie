import {
  entryId,
  type LaneRecord,
  type RootRecord,
  rootIdFor,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { threadCardOf } from "@pinetrie/rules/fixtures"
import { describe, expect, test } from "vitest"
import {
  CHAT_LABEL,
  initialsOf,
  labelsOf,
  messageCount,
  messageCountTitle,
  planTitle,
  renameKey,
  summariesOf,
} from "./root-label.ts"
import { tasksOf } from "./tasks.ts"

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
  images: [],
})
const directory = new Map(
  [
    record("1", "I'd like to start talking about a change", "Tab names"),
    record("2", "Plan the release", null),
    { ...record("3", "", null), entry: null, first: null, messages: 0 },
  ].map(r => [r.root, r] as const),
)

/** Each root's task, one a root, its thread `t-<n>` (ADR-0116); task 1 titled. */
const K = (n: string) => taskIdFor(n)
const thread = (n: string) => threadIdFor(`thread-${n}`)
const threads = new Map(
  ["1", "2", "3"].map(n => [
    thread(n),
    {
      thread: thread(n),
      root: rootIdFor(n),
      by: writerId("p-ada"),
      createdAt: 0,
      origin: { kind: "started" as const },
    },
  ]),
)
const tasks = tasksOf({
  known: ["1", "2", "3"].map(K),
  cards: ["1", "2", "3"].map(n =>
    threadCardOf({
      thread: thread(n),
      task: K(n),
      by: writerId("p-ada"),
      cards: [],
    }),
  ),
  threads,
})
const marks = new Map([
  [K("1"), { task: K("1"), title: "Tab names", by: writerId("p-ada"), at: 1 }],
])

describe("labels and summaries, from the directory (ADR-0063)", () => {
  const laneIn = (n: string): [LaneRecord["lane"], LaneRecord] => {
    const lane = threadIdFor(n)
    return [
      lane,
      {
        lane,
        root: rootIdFor(n),
        ownCopy: false,
        by: writerId("p-ada"),
        createdAt: 0,
      },
    ]
  }
  const worked = new Map([laneIn("1"), laneIn("2")])

  test("a titled task is called by its title, another by its first root's first line; a task whose root has no message yet by neither", () => {
    const labels = labelsOf({ tasks, marks, directory, lanes: worked })
    expect(labels.get(K("1"))).toBe("Tab names")
    expect(labels.get(K("2"))).toBe("Plan the release")
    expect(labels.get(K("3"))).toBe(CHAT_LABEL)
  })

  test("an untitled task no lane works in is a chat; a title still names it", () => {
    const labels = labelsOf({
      tasks,
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

  test("summaries: each task whose first root has a message, its first line, writers and newest message (ADR-0116)", () => {
    expect(summariesOf(tasks, directory)).toEqual(
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

  test("summaries: a task over two roots reads its first root's line, every root's writers and the newest message", () => {
    const two = tasksOf({
      known: [K("1")],
      cards: ["1", "2"].map((n, i) =>
        threadCardOf({
          thread: thread(n),
          task: K("1"),
          by: writerId("p-ada"),
          cards:
            i === 0
              ? []
              : [
                  threadCardOf({
                    thread: thread("1"),
                    task: K("1"),
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
    expect(summariesOf(two, both).get(K("1"))).toEqual({
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
