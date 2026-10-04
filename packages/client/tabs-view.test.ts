import {
  type EntryId,
  entryId,
  type LaneName,
  laneNameForThread,
  type MarkRecord,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import type { Item, Status } from "./attention.ts"
import type { CardMarks } from "./card-marks.ts"
import { NEW_ROOT } from "./fixtures.ts"
import {
  type ActiveTab,
  initialLayout,
  type Layout,
  layoutReducer,
} from "./layout.ts"
import {
  dropsWords,
  offeredByRoot,
  type TabsViewInput,
  tabsView,
} from "./tabs-view.ts"

const R1: ActiveTab = { kind: "root", root: entryId("r1") }
const R2: ActiveTab = { kind: "root", root: entryId("r2") }
const reduce = (l: Layout, ...actions: Parameters<typeof layoutReducer>[1][]) =>
  actions.reduce(layoutReducer, l)
// Your tabs: r1, r2, and a new agent tab "t"; you are on r1.
const layout = reduce(
  initialLayout(),
  { kind: "show", tab: R1 },
  { kind: "show", tab: R2 },
  { kind: "newTab", key: "t", root: NEW_ROOT, asksAgent: true },
  { kind: "show", tab: R1 },
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
const input = (over: Partial<TabsViewInput> = {}): TabsViewInput => ({
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
  elsewhere: null,
  arrivals: { arrived: new Map(), done: new Map() },
  ...over,
})
const tabs = (over: Partial<TabsViewInput> = {}) => tabsView(input(over)).tabs

describe("tabsView", () => {
  test("Archive, your roots, then new tabs, in tabBar's order", () => {
    expect(tabs().map(t => t.kind)).toEqual(["archive", "root", "root", "new"])
    expect(tabs().map(t => t.selected)).toEqual([false, true, false, false])
  })

  test("a root tab is labelled, and its rename field starts from its title", () => {
    const [, r1] = tabs()
    expect(r1).toMatchObject({
      kind: "root",
      label: "Tab names",
      line: "first",
      title: "Tab names",
    })
  })

  test("every root tab not archived offers ⋯, not only the one you are on", () => {
    const menus = tabs({ archived: new Set([entryId("r1")]) }).map(t =>
      t.kind === "root" ? t.menu.map(i => i.kind) : null,
    )
    expect(menus).toEqual([null, [], ["rename", "retitle", "archive"], null])
  })

  test("Auto-update title asks for the tab's own root", () => {
    const [, r1] = tabs()
    expect(r1?.kind === "root" && r1.menu[1]).toEqual({
      kind: "retitle",
      intent: { kind: "retitle", root: entryId("r1") },
    })
  })

  test("Archive is refused while the agent works in the root", () => {
    const [, r1] = tabs({ work: new Map([["r1", "running"]]) })
    expect(r1?.kind === "root" && r1.menu[2]).toEqual({
      kind: "archive",
      busy: "running",
      drops: [],
      intent: { kind: "archive", root: "r1" },
    })
  })

  test("Archive names the threads whose offers it withdraws", () => {
    const amber = "amber-fox" as ThreadName
    const [, r1, r2] = tabs({ offered: new Map([[entryId("r1"), [amber]]]) })
    expect(r1?.kind === "root" && r1.menu[2]).toMatchObject({ drops: [amber] })
    expect(r2?.kind === "root" && r2.menu[2]).toMatchObject({ drops: [] })
    expect(dropsWords([amber, "cozy-mallard" as ThreadName])).toBe(
      "work not added to the project goes: amber-fox, cozy-mallard",
    )
    expect(dropsWords([])).toBe(null)
  })

  test("offeredByRoot: each open offer's named thread, under its root", () => {
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
    ).toEqual(new Map([[entryId("r1"), ["amber-fox", "cozy-mallard"]]]))
  })

  test("a pip on each tab holding a card of yours, and on Archive for one elsewhere", () => {
    const unsent = {
      ...none,
      roots: new Set([entryId("r2")]),
      newTabs: new Set(["t"]),
      elsewhere: true,
    }
    expect(tabs({ unsent }).map(t => t.pip)).toEqual([true, false, true, true])
    expect(tabs().map(t => t.pip)).toEqual([false, false, false, false])
  })

  test("a root tab draws its status, and what arrived as you watched; Archive, the highest elsewhere (ADR-0077)", () => {
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
    const [archive, r1, r2] = tabs({
      status,
      elsewhere: "worthARead",
      arrivals: { arrived: new Map([[entryId("r2"), 5]]), done: new Map() },
    })
    expect(archive).toMatchObject({ kind: "archive", status: "worthARead" })
    expect(r1).toMatchObject({ status: { kind: "working" }, arrived: null })
    expect(r2).toMatchObject({ status: { kind: "needsYou" }, arrived: 5 })
  })

  test("a tab that raises something offers not needed first in its ⋯; a working one does not", () => {
    const item: Item = {
      lane: laneNameForThread("a"),
      root: entryId("r1"),
      end: entryId("e"),
      level: "worthARead",
      raised: { kind: "offer", source: "c-1" },
    }
    const [, raised] = tabs({
      status: new Map([[entryId("r1"), { kind: "worthARead", item }]]),
    })
    expect(raised?.kind === "root" && raised.menu[0]).toEqual({
      kind: "notNeeded",
      intent: { kind: "notNeeded", lane: item.lane, raised: item.raised },
    })
    const [, working] = tabs({
      status: new Map([[entryId("r1"), { kind: "working" }]]),
    })
    expect(working?.kind === "root" && working.menu[0]).toEqual({
      kind: "rename",
    })
  })

  test("× closes the tab for you; a new tab's label says what it starts", () => {
    const [, r1, , t] = tabs()
    expect(r1?.kind === "root" && r1.close).toEqual({
      kind: "closeTab",
      tab: R1,
    })
    expect(t).toMatchObject({
      kind: "new",
      label: "new agent",
      close: { kind: "closeTab", tab: { kind: "new", key: "t" } },
    })
  })
})

test("the add tab's main action starts agent work; its menu, a conversation", () => {
  expect(tabsView(input()).add).toEqual({
    agent: { kind: "newTab", asksAgent: true },
    conversation: { kind: "newTab", asksAgent: false },
  })
})
