import {
  type BannerRecord,
  blobUrl,
  type EntryId,
  entryId,
  type LaneName,
  type LaneView,
  laneNameForThread,
  type MarkRecord,
  rootIdFor,
  type Sha256,
  type ThreadName,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { Item, Status } from "./attention.ts"
import type { CardMarks } from "./card-marks.ts"
import { NEW_ROOT, tree } from "./fixtures.ts"
import {
  type Here,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import {
  dropsWords,
  listKey,
  type OpenListViewInput,
  offeredByRoot,
  openListView,
  pageTitle,
  rootSprites,
} from "./open-list-view.ts"
import { PENDING_COLOR, rootColor } from "./palette.ts"

const R1: Here = { kind: "root", root: entryId("r1") }
const R2: Here = { kind: "root", root: entryId("r2") }
const R3: Here = { kind: "root", root: entryId("r3") }
const reduce = (l: Layout, ...actions: Parameters<typeof layoutReducer>[1][]) =>
  actions.reduce(layoutReducer, l)
// Your list: r1, r2, r3, then a new agent tab "t"; you are on r1.
const layout = resolveLayout(
  reduce(
    initialLayout(),
    { kind: "newTab", key: "t", root: NEW_ROOT, asksAgent: true },
    { kind: "show", here: R1 },
  ),
  {
    index: tree({ r1: null, r2: null, r3: null }),
    lanes: [],
    archived: new Set(),
    list: [entryId("r1"), entryId("r2"), entryId("r3")],
  },
)
const none: CardMarks = {
  roots: new Set(),
  newTabs: new Set(),
  ends: new Set(),
  elsewhere: false,
}
const mark: MarkRecord = {
  entry: entryId("r1"),
  title: "Tab names",
  by: writerId("a@x.test"),
  at: 1,
}
const [BACKLOG, DOING, DONE] = ["b", "d", "x"].map(workflowStateIdFor) as [
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
  ReturnType<typeof workflowStateIdFor>,
]
const WORKFLOW: Workflow = {
  open: [
    { id: BACKLOG, name: "Backlog" },
    { id: DOING, name: "Doing" },
  ],
  closed: { id: DONE, name: "Done" },
}
const ID = (n: number) => rootIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`)
const input = (over: Partial<OpenListViewInput> = {}): OpenListViewInput => ({
  layout,
  active: R1,
  labels: new Map([
    [entryId("r1"), "Tab names"],
    [entryId("r2"), "second"],
  ]),
  lines: new Map([
    [entryId("r1"), "first"],
    [entryId("r2"), "second"],
  ]),
  marks: new Map([[entryId("r1"), mark]]),
  archived: new Set(),
  work: new Map(),
  offered: new Map(),
  unsent: none,
  status: new Map(),
  arrivals: { arrived: new Map(), done: new Map() },
  workflow: WORKFLOW,
  stateOf: new Map([
    [entryId("r1"), DOING],
    [entryId("r2"), DOING],
    [entryId("r3"), BACKLOG],
  ]),
  rootIds: new Map([
    [entryId("r1"), ID(1)],
    [entryId("r2"), ID(2)],
    [entryId("r3"), ID(3)],
  ]),
  sprites: new Map(),
  ...over,
})
const items = (over: Partial<OpenListViewInput> = {}) =>
  openListView(input(over)).items
const kinds = (
  r:
    | (typeof items extends (...a: never) => infer T ? T : never)[number]
    | undefined,
) => (r?.kind === "root" ? r.menu.map(i => i.kind) : null)

describe("openListView", () => {
  test("your roots, then new tabs, in listOf's order", () => {
    expect(items().map(t => t.kind)).toEqual(["root", "root", "root", "new"])
    expect(items().map(t => t.selected)).toEqual([true, false, false, false])
  })

  test("a root is labelled, and its rename field starts from its title", () => {
    expect(items()[0]).toMatchObject({
      kind: "root",
      label: "Tab names",
      line: "first",
      title: "Tab names",
    })
  })

  test("every root not archived offers ⋯, not only the one you are on", () => {
    const menus = items({ archived: new Set([entryId("r1")]) }).map(kinds)
    expect(menus).toEqual([
      [],
      ["rename", "retitle", "moveTo", "moveTo"],
      ["rename", "retitle", "moveTo", "moveTo"],
      null,
    ])
  })

  test("Auto-update title asks for the root's own", () => {
    const [r1] = items()
    expect(r1?.kind === "root" && r1.menu[1]).toEqual({
      kind: "retitle",
      intent: { kind: "retitle", root: entryId("r1") },
    })
  })

  test("Move to ▸ offers every state but its own, each a move on the board for everyone", () => {
    const [r1] = items()
    const moves =
      r1?.kind === "root" ? r1.menu.filter(i => i.kind === "moveTo") : []
    expect(moves.map(m => m.kind === "moveTo" && [m.name, m.closes])).toEqual([
      ["Backlog", false],
      ["Done", true],
    ])
    expect(moves[1]).toMatchObject({
      intent: {
        kind: "moveRoot",
        root: ID(1),
        from: DOING,
        to: DONE,
        before: null,
        closes: true,
      },
    })
  })

  test("Move to Done is refused while the agent works in the root", () => {
    const [r1] = items({ work: new Map([["r1", "running"]]) })
    const done =
      r1?.kind === "root"
        ? r1.menu.find(i => i.kind === "moveTo" && i.closes)
        : null
    expect(done).toMatchObject({ busy: "running", drops: [] })
  })

  test("Move to Done names the threads whose offers it withdraws", () => {
    const amber = "amber-fox" as ThreadName
    const [r1, r2] = items({ offered: new Map([[entryId("r1"), [amber]]]) })
    const done = (r: typeof r1) =>
      r?.kind === "root"
        ? r.menu.find(i => i.kind === "moveTo" && i.closes)
        : null
    expect(done(r1)).toMatchObject({ drops: [amber] })
    expect(done(r2)).toMatchObject({ drops: [] })
    expect(dropsWords([amber, "cozy-mallard" as ThreadName])).toBe(
      "work not accepted goes: amber-fox, cozy-mallard",
    )
    expect(dropsWords([])).toBe(null)
  })

  test("offeredByRoot: each open offer's thread, under its root; one the host has not named yet by its id's end", () => {
    const lane = (n: string) => n as LaneName
    const names = new Map([
      [lane("l1"), "amber-fox" as ThreadName],
      [lane("l2"), "cozy-mallard" as ThreadName],
    ])
    expect(
      offeredByRoot(
        [
          { lane: lane("l1"), root: entryId("r1") },
          { lane: lane("l2"), root: entryId("r1") },
          { lane: lane("l3"), root: entryId("r2") },
        ],
        names,
      ),
    ).toEqual(
      new Map([
        [entryId("r1"), ["amber-fox", "cozy-mallard"]],
        [entryId("r2"), ["l3"]],
      ]),
    )
  })

  test("a pip on each item holding a card of yours", () => {
    const unsent = {
      ...none,
      roots: new Set([entryId("r2")]),
      newTabs: new Set(["t"]),
    }
    expect(items({ unsent }).map(t => t.pip)).toEqual([
      false,
      true,
      false,
      true,
    ])
    expect(items().map(t => t.pip)).toEqual([false, false, false, false])
  })

  test("a root draws its status, and what arrived as you watched (ADR-0077)", () => {
    const item: Item = {
      lane: laneNameForThread("a"),
      root: entryId("r2"),
      end: entryId("e"),
      level: "needsYou",
      raised: { kind: "offer", source: "c-1" },
    }
    const status = new Map<EntryId, Status>([
      [entryId("r1"), { kind: "working" }],
      [entryId("r2"), { kind: "needsYou", item }],
    ])
    const [r1, r2] = items({
      status,
      arrivals: { arrived: new Map([[entryId("r2"), 5]]), done: new Map() },
    })
    expect(r1).toMatchObject({ status: { kind: "working" }, arrived: null })
    expect(r2).toMatchObject({ status: { kind: "needsYou" }, arrived: 5 })
  })

  test("a root that raises something offers not needed first in its ⋯; a working one does not", () => {
    const item: Item = {
      lane: laneNameForThread("a"),
      root: entryId("r1"),
      end: entryId("e"),
      level: "worthARead",
      raised: { kind: "offer", source: "c-1" },
    }
    const [raised] = items({
      status: new Map([[entryId("r1"), { kind: "worthARead", item }]]),
    })
    expect(raised?.kind === "root" && raised.menu[0]).toEqual({
      kind: "notNeeded",
      intent: { kind: "notNeeded", lane: item.lane, raised: item.raised },
    })
    const [working] = items({
      status: new Map([[entryId("r1"), { kind: "working" }]]),
    })
    expect(working?.kind === "root" && working.menu[0]).toEqual({
      kind: "rename",
    })
  })

  test("× closes it for you; a new tab's label says what it starts", () => {
    const [r1, , , t] = items()
    expect(r1?.close).toEqual({ kind: "close", here: R1 })
    expect(t).toMatchObject({
      kind: "new",
      label: "new agent",
      close: { kind: "close", here: { kind: "new", key: "t" } },
    })
  })
})

test("＋'s main action starts agent work; its menu, a conversation", () => {
  expect(openListView(input()).add).toEqual({
    agent: { kind: "newTab", asksAgent: true },
    conversation: { kind: "newTab", asksAgent: false },
  })
})

test("selected is the item you are on, and each item has its own key", () => {
  const view = openListView(input({ active: R2 }))
  expect(view.selected).toMatchObject({ kind: "root", root: entryId("r2") })
  expect(view.items.map(listKey)).toEqual([
    "root:r1",
    "root:r2",
    "root:r3",
    "new:t",
  ])
  expect(openListView(input({ active: R3 })).selected).toMatchObject({
    root: "r3",
  })
})

describe("pageTitle", () => {
  const [r1, , , t] = items()
  test.each([
    [0, "nothing", null, "pine·trie"],
    [3, "nothing", null, "(3) pine·trie"],
    [0, "a root", r1, "Tab names · pine·trie"],
    [3, "a root", r1, "(3) Tab names · pine·trie"],
    [0, "a new tab", t, "new agent · pine·trie"],
  ])("%i needing you, on %s", (count, _, here, words) => {
    expect(pageTitle(count, here ?? null)).toBe(words)
  })
})

describe("icons (ADR-0088)", () => {
  const SHA = "b".repeat(64) as Sha256
  test("a root with a sprite draws it; one without, its initials on its colour; a new tab, a hollow tile", () => {
    const [r1, r2, r3, fresh] = items({
      sprites: new Map([[entryId("r2"), SHA]]),
      rootIds: new Map([
        [entryId("r1"), ID(1)],
        [entryId("r2"), ID(2)],
      ]),
    })
    expect(r1?.icon).toEqual({
      kind: "initials",
      letters: "TN",
      color: rootColor(ID(1)),
    })
    expect(r2?.icon).toEqual({ kind: "sprite", src: blobUrl(SHA) })
    expect(r3?.icon).toEqual({
      kind: "initials",
      letters: "NT",
      color: PENDING_COLOR,
    })
    expect(fresh?.icon).toEqual({ kind: "fresh" })
  })
})

describe("rootSprites", () => {
  const lane = (n: number, tip: string): LaneView => ({
    name: laneNameForThread(`01a0ffd2-0000-7000-8000-00000000000${n}`),
    tip: entryId(tip),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  })
  const banner = (l: LaneView, c: string): [LaneName, BannerRecord] => [
    l.name,
    { lane: l.name, sha: c.repeat(64) as Sha256, at: 1 },
  ]
  const index = tree({ r1: null, a: "r1", b: "r1", r2: null, c: "r2" })
  const [early, late, other] = [lane(1, "a"), lane(2, "b"), lane(3, "c")]

  test("a root takes the banner of its earliest thread with one", () => {
    const sprites = rootSprites(
      index,
      [late, other, early],
      new Map([banner(late, "2"), banner(early, "1")]),
    )
    expect(sprites).toEqual(new Map([[entryId("r1"), "1".repeat(64)]]))
  })

  test("a thread with no banner gives way to a later one; a lane with no tip has no root", () => {
    const sprites = rootSprites(
      index,
      [early, late, { ...other, tip: null }],
      new Map([banner(late, "2"), banner(other, "3")]),
    )
    expect(sprites).toEqual(new Map([[entryId("r1"), "2".repeat(64)]]))
  })
})
