import { entryId, type MarkRecord, writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import type { CardMarks } from "./card-marks.ts"
import {
  type ActiveTab,
  initialLayout,
  type Layout,
  layoutReducer,
} from "./layout.ts"
import { type TabsViewInput, tabsView } from "./tabs-view.ts"

const R1: ActiveTab = { kind: "root", root: entryId("r1") }
const R2: ActiveTab = { kind: "root", root: entryId("r2") }
const reduce = (l: Layout, ...actions: Parameters<typeof layoutReducer>[1][]) =>
  actions.reduce(layoutReducer, l)
// Your tabs: r1, r2, and a new agent tab "t"; you are on r1.
const layout = reduce(
  initialLayout(),
  { kind: "show", tab: R1 },
  { kind: "show", tab: R2 },
  { kind: "newTab", key: "t", asksAgent: true },
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
  unsent: none,
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
    expect(menus).toEqual([null, [], ["rename", "archive"], null])
  })

  test("Archive is refused while the agent works in the root", () => {
    const [, r1] = tabs({ work: new Map([["r1", "running"]]) })
    expect(r1?.kind === "root" && r1.menu[1]).toEqual({
      kind: "archive",
      busy: "running",
      intent: { kind: "archive", root: "r1" },
    })
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
