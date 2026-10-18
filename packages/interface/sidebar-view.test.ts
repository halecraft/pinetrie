import {
  blobUrl,
  type CanvasId,
  canvasIdFor,
  entryId,
  type Sha256,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type {
  BannerRecord,
  IconsRecord,
  MarkRecord,
  Workflow,
} from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { Item, Status } from "./attention.ts"
import { tree } from "./fixtures.ts"
import {
  type Here,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import { canvasSlot } from "./palette.ts"
import {
  canvasIcons,
  dropsWords,
  listKey,
  openProposedByCanvas,
  pageTitle,
  type SidebarViewInput,
  sidebarView,
} from "./sidebar-view.ts"
import type { UnsentSignals } from "./signals.ts"
import { type ThreadCardFacts, threadCardHeads } from "./thread-card.ts"
import { builtInIconUrl, type IconLookup, threadIcon } from "./thread-icon.ts"

/** Each root's canvas, one a root: `K("r1")` holds root r1's threads. */
const K = (root: string) => canvasIdFor(root)
const R1: Here = { kind: "canvas", canvas: K("r1") }
const R2: Here = { kind: "canvas", canvas: K("r2") }
const R3: Here = { kind: "canvas", canvas: K("r3") }
const reduce = (l: Layout, ...actions: Parameters<typeof layoutReducer>[1][]) =>
  actions.reduce(layoutReducer, l)
// The sidebar: r1, r2, r3; you are on r1.
const layout = resolveLayout(
  reduce(initialLayout(), { kind: "show", here: R1 }),
  {
    index: tree({ r1: null, r2: null, r3: null }),
    lanes: [],
    archived: new Set(),
    list: [K("r1"), K("r2"), K("r3")],
    cardsOn: new Map(),
    unstarted: new Map(),
    holders: new Map(),
  },
)
const none: UnsentSignals = {
  canvases: new Set(),
  ends: new Set(),
  elsewhere: false,
}
const mark: MarkRecord = {
  canvas: K("r1"),
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
  archive: { id: DONE, name: "Done" },
}
/** What the sidebar's items are read from, its thread cards' facts among them. */
type Facts = Omit<SidebarViewInput, "heads"> &
  Omit<ThreadCardFacts, "pips"> & {
    readonly shown: readonly CanvasId[]
    /** Your unsent text: each canvas's pip. */
    readonly unsent: UnsentSignals
  }
const input = (over: Partial<Facts> = {}): SidebarViewInput => {
  const f: Facts = {
    layout,
    active: R1,
    labels: new Map([
      [K("r1"), "Tab names"],
      [K("r2"), "second"],
    ]),
    summaries: new Map([
      [K("r1"), { line: "first", writers: [], newest: entryId("r1") }],
      [K("r2"), { line: "second", writers: [], newest: entryId("r2") }],
    ]),
    marks: new Map([[K("r1"), mark]]),
    archived: new Set(),
    work: new Map(),
    proposed: new Map(),
    unsent: none,
    status: new Map(),
    arrivals: { arrived: new Map(), done: new Map() },
    workflow: WORKFLOW,
    stateOf: new Map([
      [K("r1"), DOING],
      [K("r2"), DOING],
      [K("r3"), BACKLOG],
    ]),
    icons: new Map(),
    shown: [K("r1"), K("r2"), K("r3")],
    ...over,
  }
  return {
    layout: f.layout,
    active: f.active,
    heads: threadCardHeads(f.shown, { ...f, pips: f.unsent.canvases }),
    summaries: f.summaries,
    marks: f.marks,
    archived: f.archived,
    arrivals: f.arrivals,
    icons: f.icons,
    workflow: f.workflow,
  }
}
const items = (over: Partial<Facts> = {}) => sidebarView(input(over)).items
const kinds = (
  r:
    | (typeof items extends (...a: never) => infer T ? T : never)[number]
    | undefined,
) => (r?.kind === "canvas" ? r.menu.map(i => i.kind) : null)

describe("sidebarView", () => {
  test("your canvases, in sidebarList's order", () => {
    expect(items().map(t => t.kind)).toEqual(["canvas", "canvas", "canvas"])
    expect(items().map(t => t.selected)).toEqual([true, false, false])
  })

  test("a root is labelled, and its rename field starts from its title", () => {
    expect(items()[0]).toMatchObject({
      kind: "canvas",
      label: "Tab names",
      line: "first",
      title: "Tab names",
    })
  })

  test("every root not archived offers ⋯, not only the one you are on", () => {
    const menus = items({ archived: new Set([K("r1")]) }).map(kinds)
    expect(menus).toEqual([
      [],
      ["rename", "retitle", "moveTo", "moveTo"],
      ["rename", "retitle", "moveTo", "moveTo"],
    ])
  })

  test("Auto-update title asks for the root's own", () => {
    const [r1] = items()
    expect(r1?.kind === "canvas" && r1.menu[1]).toEqual({
      kind: "retitle",
      intent: { kind: "retitle", canvas: K("r1") },
    })
  })

  test("Move to ▸ offers every state but its own, each a move on the board for everyone", () => {
    const [r1] = items()
    const moves =
      r1?.kind === "canvas" ? r1.menu.filter(i => i.kind === "moveTo") : []
    expect(moves.map(m => m.kind === "moveTo" && [m.name, m.closes])).toEqual([
      ["Backlog", false],
      ["Done", true],
    ])
    expect(moves[1]).toMatchObject({
      intent: {
        kind: "moveCanvas",
        canvas: K("r1"),
        from: DOING,
        to: DONE,
        before: null,
        closes: true,
      },
    })
  })

  test("Move to Done is refused while the agent works in the root", () => {
    const [r1] = items({ work: new Map([[K("r1"), "running"]]) })
    const done =
      r1?.kind === "canvas"
        ? r1.menu.find(i => i.kind === "moveTo" && i.closes)
        : null
    expect(done).toMatchObject({ busy: "running", drops: [] })
  })

  test("Move to Done names the threads whose proposed changes it withdraws", () => {
    const amber = "amber-fox" as ThreadName
    const [r1, r2] = items({ proposed: new Map([[K("r1"), [amber]]]) })
    const done = (r: typeof r1) =>
      r?.kind === "canvas"
        ? r.menu.find(i => i.kind === "moveTo" && i.closes)
        : null
    expect(done(r1)).toMatchObject({ drops: [amber] })
    expect(done(r2)).toMatchObject({ drops: [] })
    expect(dropsWords([amber, "cozy-mallard" as ThreadName])).toBe(
      "unfinished changes will be dropped: amber-fox, cozy-mallard",
    )
    expect(dropsWords([])).toBe(null)
  })

  test("openProposedByCanvas: each open proposed changes' thread, under its canvas; one the host has not named yet by its id's end; one in no canvas left out", () => {
    const lane = (n: string) => n as ThreadId
    const names = new Map([
      [lane("l1"), "amber-fox" as ThreadName],
      [lane("l2"), "cozy-mallard" as ThreadName],
    ])
    expect(
      openProposedByCanvas(
        [
          { lane: lane("l1") },
          { lane: lane("l2") },
          { lane: lane("l3") },
          { lane: lane("l4") },
        ],
        names,
        new Map([
          [lane("l1"), K("r1")],
          [lane("l2"), K("r1")],
          [lane("l3"), K("r2")],
        ]),
      ),
    ).toEqual(
      new Map([
        [K("r1"), ["amber-fox", "cozy-mallard"]],
        [K("r2"), ["l3"]],
      ]),
    )
  })

  test("a pip on each item holding a card of yours", () => {
    const unsent = { ...none, canvases: new Set([K("r2")]) }
    expect(items({ unsent }).map(t => t.pip)).toEqual([false, true, false])
    expect(items().map(t => t.pip)).toEqual([false, false, false])
  })

  test("a root draws its status, and what arrived as you watched", () => {
    const item: Item = {
      lane: threadIdFor("a"),
      end: entryId("e"),
      level: "needsYou",
      raised: { kind: "ready", source: cardIdFor("c1") },
    }
    const status = new Map<CanvasId, Status>([
      [K("r1"), { kind: "working" }],
      [K("r2"), { kind: "needsYou", item }],
    ])
    const [r1, r2] = items({
      status,
      arrivals: { arrived: new Map([[K("r2"), 5]]), done: new Map() },
    })
    expect(r1).toMatchObject({ status: { kind: "working" }, arrived: null })
    expect(r2).toMatchObject({ status: { kind: "needsYou" }, arrived: 5 })
  })

  test("a root that raises something offers not needed first in its ⋯; a working one does not", () => {
    const item: Item = {
      lane: threadIdFor("a"),
      end: entryId("e"),
      level: "worthARead",
      raised: { kind: "ready", source: cardIdFor("c1") },
    }
    const [raised] = items({
      status: new Map([[K("r1"), { kind: "worthARead", item }]]),
    })
    expect(raised?.kind === "canvas" && raised.menu[0]).toEqual({
      kind: "notNeeded",
      intent: { kind: "notNeeded", lane: item.lane, raised: item.raised },
    })
    const [working] = items({
      status: new Map([[K("r1"), { kind: "working" }]]),
    })
    expect(working?.kind === "canvas" && working.menu[0]).toEqual({
      kind: "rename",
    })
  })

  test("× closes it for you", () => {
    const [r1] = items()
    expect(r1?.close).toEqual({ kind: "close", here: R1 })
  })
})

test("＋ makes a canvas at the end of the first open state, with no menu", () => {
  const { add } = sidebarView(input())
  expect(add.main.intent).toEqual({ kind: "newCanvas" })
  expect(add.main.title).toContain("at the end of Backlog")
  expect(add.more).toBeNull()
})

test("an item's hover names its label and where it is on the board", () => {
  const [r1, , r3] = items()
  expect(r1?.hover).toBe(`${r1?.label} · a task, in Doing`)
  expect(r3?.hover).toBe(`${r3?.label} · a topic, in Backlog`)
})

test("selected is the item you are on, and each item has its own key", () => {
  const view = sidebarView(input({ active: R2 }))
  expect(view.selected).toMatchObject({ kind: "canvas", canvas: K("r2") })
  expect(view.items.map(listKey)).toEqual([
    `canvas:${K("r1")}`,
    `canvas:${K("r2")}`,
    `canvas:${K("r3")}`,
  ])
  expect(sidebarView(input({ active: R3 })).selected).toMatchObject({
    canvas: K("r3"),
  })
})

describe("pageTitle", () => {
  const [r1] = items()
  test.each([
    [0, "nothing", null, "pine·trie"],
    [3, "nothing", null, "(3) pine·trie"],
    [0, "a root", r1, "Tab names · pine·trie"],
    [3, "a root", r1, "(3) Tab names · pine·trie"],
  ])("%i needing you, on %s", (count, _, here, words) => {
    expect(pageTitle(count, here ?? null, null)).toBe(words)
  })
  test("a page over the stage names the window, not the root under it", () => {
    expect(pageTitle(2, r1 ?? null, "profile")).toBe("(2) Profile · pine·trie")
    expect(pageTitle(0, null, "profile")).toBe("Profile · pine·trie")
  })
})

describe("icons", () => {
  const ICON = { kind: "built-in", url: builtInIconUrl("fox") } as const
  test("a canvas with an icon draws it; one without, its initials on a colour its id seeds", () => {
    const [r1, r2, r3] = items({
      icons: new Map([[K("r2"), ICON]]),
    })
    expect(r1?.icon).toEqual({
      kind: "initials",
      letters: "TN",
      slot: canvasSlot(K("r1")),
    })
    expect(r2?.icon).toEqual({ kind: "icon", icon: ICON })
    expect(r3?.icon).toEqual({
      kind: "initials",
      letters: "NT",
      slot: canvasSlot(K("r3")),
    })
  })
})

describe("canvasIcons", () => {
  const thread = (n: number) =>
    threadIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`)
  const banner = (t: ThreadId, c: string): [ThreadId, BannerRecord] => [
    t,
    { lane: t, sha: c.repeat(64) as Sha256, at: 1 },
  ]
  const [early, late, other] = [thread(1), thread(2), thread(3)]
  const lookup =
    (
      banners: ReadonlyMap<ThreadId, BannerRecord>,
      names: ReadonlyMap<ThreadId, ThreadName> = new Map(),
      icons: IconsRecord | null = null,
    ): IconLookup =>
    t =>
      threadIcon({ thread: t, names, banners, icons })
  const bannerIcon = (c: string) => ({
    kind: "banner",
    url: blobUrl(c.repeat(64) as Sha256),
  })

  test("a canvas takes the icon of its earliest thread with one, whatever its canvas order", () => {
    const icons = canvasIcons(
      new Map([
        [K("r1"), [late, early]],
        [K("r2"), [other]],
      ]),
      lookup(new Map([banner(late, "2"), banner(early, "1")])),
    )
    expect(icons).toEqual(new Map([[K("r1"), bannerIcon("1")]]))
  })

  test("a thread with no icon gives way to a later one", () => {
    const icons = canvasIcons(
      new Map([[K("r1"), [early, late]]]),
      lookup(new Map([banner(late, "2"), banner(other, "3")])),
    )
    expect(icons).toEqual(new Map([[K("r1"), bannerIcon("2")]]))
  })

  test("under built-in icons, the earliest named thread's noun icon; with no names, none", () => {
    const names = new Map([[late, "amber-fox" as ThreadName]])
    const builtIn = { source: "built-in" } as const
    expect(
      canvasIcons(
        new Map([[K("r1"), [late, early]]]),
        lookup(new Map(), names, builtIn),
      ),
    ).toEqual(
      new Map([[K("r1"), { kind: "built-in", url: builtInIconUrl("fox") }]]),
    )
    expect(
      canvasIcons(
        new Map([[K("r1"), [early]]]),
        lookup(new Map(), names, builtIn),
      ),
    ).toEqual(new Map())
  })
})
