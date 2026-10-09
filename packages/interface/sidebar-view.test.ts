import {
  type BannerRecord,
  blobUrl,
  entryId,
  type MarkRecord,
  type Sha256,
  type TaskId,
  type ThreadId,
  type ThreadName,
  taskIdFor,
  threadIdFor,
  type Workflow,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import type { Item, Status } from "./attention.ts"
import type { CardMarks } from "./card-marks.ts"
import { NEW_ROOT, NEW_TASK, NEW_THREAD, tree } from "./fixtures.ts"
import {
  type Here,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import { taskSlot } from "./palette.ts"
import {
  dropsWords,
  listKey,
  offeredByTask,
  pageTitle,
  type SidebarViewInput,
  sidebarView,
  taskSprites,
} from "./sidebar-view.ts"
import { type ThreadCardFacts, threadCardHeads } from "./thread-card.ts"

/** Each root's task, one a root (ADR-0116): `K("r1")` holds root r1's threads. */
const K = (root: string) => taskIdFor(root)
const R1: Here = { kind: "task", task: K("r1") }
const R2: Here = { kind: "task", task: K("r2") }
const R3: Here = { kind: "task", task: K("r3") }
const reduce = (l: Layout, ...actions: Parameters<typeof layoutReducer>[1][]) =>
  actions.reduce(layoutReducer, l)
// The sidebar: r1, r2, r3, then a new agent tab "t"; you are on r1.
const layout = resolveLayout(
  reduce(
    initialLayout(),
    {
      kind: "newTab",
      key: "t",
      root: NEW_ROOT,
      task: NEW_TASK,
      thread: NEW_THREAD,
      asksAgent: true,
    },
    { kind: "show", here: R1 },
  ),
  {
    index: tree({ r1: null, r2: null, r3: null }),
    lanes: [],
    archived: new Set(),
    list: [K("r1"), K("r2"), K("r3")],
    entries: new Map(["r1", "r2", "r3"].map(r => [K(r), entryId(r)] as const)),
  },
)
const none: CardMarks = {
  tasks: new Set(),
  newTabs: new Set(),
  ends: new Set(),
  elsewhere: false,
}
const mark: MarkRecord = {
  task: K("r1"),
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
  Omit<ThreadCardFacts, "pips"> & { readonly shown: readonly TaskId[] }
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
    offered: new Map(),
    unsent: none,
    status: new Map(),
    arrivals: { arrived: new Map(), done: new Map() },
    workflow: WORKFLOW,
    stateOf: new Map([
      [K("r1"), DOING],
      [K("r2"), DOING],
      [K("r3"), BACKLOG],
    ]),
    entries: new Map(["r1", "r2", "r3"].map(r => [K(r), entryId(r)] as const)),
    sprites: new Map(),
    shown: [K("r1"), K("r2"), K("r3")],
    ...over,
  }
  return {
    layout: f.layout,
    active: f.active,
    heads: threadCardHeads(f.shown, { ...f, pips: f.unsent.tasks }),
    entries: f.entries,
    summaries: f.summaries,
    marks: f.marks,
    archived: f.archived,
    unsent: f.unsent,
    arrivals: f.arrivals,
    sprites: f.sprites,
  }
}
const items = (over: Partial<Facts> = {}) => sidebarView(input(over)).items
const kinds = (
  r:
    | (typeof items extends (...a: never) => infer T ? T : never)[number]
    | undefined,
) => (r?.kind === "task" ? r.menu.map(i => i.kind) : null)

describe("sidebarView", () => {
  test("your roots, then new tabs, in listOf's order", () => {
    expect(items().map(t => t.kind)).toEqual(["task", "task", "task", "new"])
    expect(items().map(t => t.selected)).toEqual([true, false, false, false])
  })

  test("a root is labelled, and its rename field starts from its title", () => {
    expect(items()[0]).toMatchObject({
      kind: "task",
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
      null,
    ])
  })

  test("Auto-update title asks for the root's own", () => {
    const [r1] = items()
    expect(r1?.kind === "task" && r1.menu[1]).toEqual({
      kind: "retitle",
      intent: { kind: "retitle", task: K("r1") },
    })
  })

  test("Move to ▸ offers every state but its own, each a move on the board for everyone", () => {
    const [r1] = items()
    const moves =
      r1?.kind === "task" ? r1.menu.filter(i => i.kind === "moveTo") : []
    expect(moves.map(m => m.kind === "moveTo" && [m.name, m.closes])).toEqual([
      ["Backlog", false],
      ["Done", true],
    ])
    expect(moves[1]).toMatchObject({
      intent: {
        kind: "moveTask",
        task: K("r1"),
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
      r1?.kind === "task"
        ? r1.menu.find(i => i.kind === "moveTo" && i.closes)
        : null
    expect(done).toMatchObject({ busy: "running", drops: [] })
  })

  test("Move to Done names the threads whose offers it withdraws", () => {
    const amber = "amber-fox" as ThreadName
    const [r1, r2] = items({ offered: new Map([[K("r1"), [amber]]]) })
    const done = (r: typeof r1) =>
      r?.kind === "task"
        ? r.menu.find(i => i.kind === "moveTo" && i.closes)
        : null
    expect(done(r1)).toMatchObject({ drops: [amber] })
    expect(done(r2)).toMatchObject({ drops: [] })
    expect(dropsWords([amber, "cozy-mallard" as ThreadName])).toBe(
      "work not accepted goes: amber-fox, cozy-mallard",
    )
    expect(dropsWords([])).toBe(null)
  })

  test("offeredByTask: each open offer's thread, under its task; one the host has not named yet by its id's end; one in no task left out (ADR-0116)", () => {
    const lane = (n: string) => n as ThreadId
    const names = new Map([
      [lane("l1"), "amber-fox" as ThreadName],
      [lane("l2"), "cozy-mallard" as ThreadName],
    ])
    expect(
      offeredByTask(
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
    const unsent = {
      ...none,
      tasks: new Set([K("r2")]),
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
      lane: threadIdFor("a"),
      end: entryId("e"),
      level: "needsYou",
      raised: { kind: "offer", source: cardIdFor("c1") },
    }
    const status = new Map<TaskId, Status>([
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
      raised: { kind: "offer", source: cardIdFor("c1") },
    }
    const [raised] = items({
      status: new Map([[K("r1"), { kind: "worthARead", item }]]),
    })
    expect(raised?.kind === "task" && raised.menu[0]).toEqual({
      kind: "notNeeded",
      intent: { kind: "notNeeded", lane: item.lane, raised: item.raised },
    })
    const [working] = items({
      status: new Map([[K("r1"), { kind: "working" }]]),
    })
    expect(working?.kind === "task" && working.menu[0]).toEqual({
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
  expect(sidebarView(input()).add).toEqual({
    agent: { kind: "newTab", asksAgent: true },
    conversation: { kind: "newTab", asksAgent: false },
  })
})

test("selected is the item you are on, and each item has its own key", () => {
  const view = sidebarView(input({ active: R2 }))
  expect(view.selected).toMatchObject({ kind: "task", task: K("r2") })
  expect(view.items.map(listKey)).toEqual([
    `task:${K("r1")}`,
    `task:${K("r2")}`,
    `task:${K("r3")}`,
    "new:t",
  ])
  expect(sidebarView(input({ active: R3 })).selected).toMatchObject({
    task: K("r3"),
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
    expect(pageTitle(count, here ?? null, null)).toBe(words)
  })
  test("a page over the workspace names the window, not the root under it (ADR-0098)", () => {
    expect(pageTitle(2, r1 ?? null, "profile")).toBe("(2) Profile · pine·trie")
    expect(pageTitle(0, null, "profile")).toBe("Profile · pine·trie")
  })
})

describe("icons (ADR-0088)", () => {
  const SHA = "b".repeat(64) as Sha256
  test("a task with a sprite draws it; one without, its initials on a colour its id seeds; a new tab, a hollow tile", () => {
    const [r1, r2, r3, fresh] = items({
      sprites: new Map([[K("r2"), SHA]]),
    })
    expect(r1?.icon).toEqual({
      kind: "initials",
      letters: "TN",
      slot: taskSlot(K("r1")),
    })
    expect(r2?.icon).toEqual({ kind: "sprite", src: blobUrl(SHA) })
    expect(r3?.icon).toEqual({
      kind: "initials",
      letters: "NT",
      slot: taskSlot(K("r3")),
    })
    expect(fresh?.icon).toEqual({ kind: "fresh" })
  })
})

describe("taskSprites", () => {
  const thread = (n: number) =>
    threadIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`)
  const banner = (t: ThreadId, c: string): [ThreadId, BannerRecord] => [
    t,
    { lane: t, sha: c.repeat(64) as Sha256, at: 1 },
  ]
  const [early, late, other] = [thread(1), thread(2), thread(3)]

  test("a task takes the banner of its earliest thread with one, whatever its canvas order (ADR-0116)", () => {
    const sprites = taskSprites(
      new Map([
        [K("r1"), [late, early]],
        [K("r2"), [other]],
      ]),
      new Map([banner(late, "2"), banner(early, "1")]),
    )
    expect(sprites).toEqual(new Map([[K("r1"), "1".repeat(64)]]))
  })

  test("a thread with no banner gives way to a later one", () => {
    const sprites = taskSprites(
      new Map([[K("r1"), [early, late]]]),
      new Map([banner(late, "2"), banner(other, "3")]),
    )
    expect(sprites).toEqual(new Map([[K("r1"), "2".repeat(64)]]))
  })
})
