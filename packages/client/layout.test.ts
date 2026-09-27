import {
  type ArchiveRecord,
  type EntryLike,
  entryId,
  indexTree,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type ActiveTab,
  columnsOf,
  decodeLayout,
  encodeLayout,
  initialLayout,
  type Layout,
  layoutReducer,
  planOpen,
  tabBar,
} from "./layout.ts"

/** A tree from `child: parent` pairs; `sends` gives some entries a send id. */
const tree = (
  parents: Record<string, string | null>,
  sends: Record<string, string> = {},
) =>
  indexTree(
    Object.fromEntries(
      Object.entries(parents).map(([id, parentId]): [string, EntryLike] => [
        id,
        {
          id,
          parentId,
          type: "message",
          message: {
            role: "chat",
            content: id,
            ...(sends[id] === undefined ? {} : { sendId: sends[id] }),
          },
        },
      ]),
    ),
  )

// Two roots: r1 -> a -> b, with a branch a -> c; and r2 -> d.
const parents = {
  "1-r1": null,
  "2-a": "1-r1",
  "3-b": "2-a",
  "4-c": "2-a",
  "5-r2": null,
  "6-d": "5-r2",
}
const index = tree(parents)
const R1: ActiveTab = { kind: "root", root: "1-r1" }
const ARCHIVE: ActiveTab = { kind: "archive" }
const at = (l: Layout, tab: ActiveTab = R1): Layout =>
  layoutReducer(l, { kind: "show", tab })
const sync = (l: Layout, i = index) =>
  layoutReducer(l, { kind: "sync", index: i, lanes: [] })
const prune = (l: Layout, open: readonly string[], i = index) =>
  layoutReducer(l, { kind: "prune", index: i, open })
const archived = (root: string): ArchiveRecord => ({
  root: entryId(root),
  state: "archived",
  by: writerId("ada"),
  at: 0,
})

describe("layoutReducer", () => {
  test("a column action changes only its root's columns", () => {
    const r2 = layoutReducer(at(initialLayout()), {
      kind: "columns",
      root: "5-r2",
      action: { kind: "open", key: "j", after: 0, anchor: "6-d" },
    })
    const l = layoutReducer(r2, {
      kind: "columns",
      root: "1-r1",
      action: { kind: "open", key: "k", after: 0, anchor: "4-c" },
    })
    expect(columnsOf(l, "1-r1").map(c => c.anchor)).toEqual(["1-r1", "4-c"])
    expect(columnsOf(l, "5-r2")).toBe(columnsOf(r2, "5-r2"))
    expect(columnsOf(l, "7-r3")).toEqual([
      { key: "first-7-r3", anchor: "7-r3" },
    ])
  })

  test("a root's first column has a key with no colon, as a presence key needs", () => {
    expect(columnsOf(initialLayout(), "1-r1")[0]?.key).not.toContain(":")
  })

  test("closing a root's last column gives it its first column again", () => {
    const l = layoutReducer(initialLayout(), {
      kind: "columns",
      root: "1-r1",
      action: { kind: "close", index: 0 },
    })
    expect(l.roots.has("1-r1")).toBe(false)
    expect(columnsOf(l, "1-r1")).toEqual([
      { key: "first-1-r1", anchor: "1-r1" },
    ])
  })

  test("a new tab, closed before it sends, leaves the layout as it was", () => {
    const before = at(initialLayout())
    const opened = layoutReducer(before, {
      kind: "newTab",
      key: "n",
      asksAgent: true,
    })
    expect(opened.active).toEqual({ kind: "new", key: "n" })
    expect(opened.newTabs).toEqual([
      { key: "n", anchor: null, fresh: {}, asksAgent: true },
    ])
    expect(
      layoutReducer(opened, { kind: "closeNewTab", key: "n", fallback: R1 }),
    ).toEqual(before)
  })

  test("a sent new tab becomes its root's tab, and stays the one you are on", () => {
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      asksAgent: false,
    })
    const sent = layoutReducer(opened, { kind: "sent", key: "n", sendId: "s" })
    expect(sync(sent)).toBe(sent)
    const written = tree({ ...parents, "7-r3": null }, { "7-r3": "s" })
    const synced = sync(sent, written)
    expect(synced.newTabs).toEqual([])
    expect(synced.active).toEqual({ kind: "root", root: "7-r3" })
    expect(columnsOf(synced, "7-r3")).toEqual([{ key: "n", anchor: "7-r3" }])
  })

  test("sync moves every stored root's columns on, not only the active one's", () => {
    const l = layoutReducer(at(initialLayout(), ARCHIVE), {
      kind: "columns",
      root: "5-r2",
      action: { kind: "open", key: "k", after: 0, anchor: "5-r2" },
    })
    // Both columns of r2 end at its newest leaf, which a reply then moves on.
    const grown = sync(l, tree({ ...parents, "8-e": "6-d" }))
    expect(columnsOf(grown, "5-r2").map(c => c.anchor)).toEqual(["8-e", "8-e"])
  })

  test("prune chooses the newest open root, or Archive when there is none", () => {
    expect(prune(initialLayout(), ["1-r1", "5-r2"]).active).toEqual({
      kind: "root",
      root: "5-r2",
    })
    expect(prune(initialLayout(), []).active).toEqual(ARCHIVE)
  })

  test("prune replaces an active root that is archived or gone, and drops a gone root", () => {
    expect(prune(at(initialLayout()), ["5-r2"]).active).toEqual({
      kind: "root",
      root: "5-r2",
    })
    const gone = layoutReducer(
      at(initialLayout(), { kind: "root", root: "9-x" }),
      {
        kind: "columns",
        root: "9-x",
        action: { kind: "open", key: "k", after: 0, anchor: "9-y" },
      },
    )
    const pruned = prune(gone, ["1-r1"])
    expect(pruned.roots.has("9-x")).toBe(false)
    expect(pruned.active).toEqual(R1)
  })

  test("once chosen, the tab you are on stays when a root appears", () => {
    const grown = tree({ ...parents, "9-r3": null })
    for (const tab of [R1, ARCHIVE]) {
      const settled = prune(at(initialLayout(), tab), ["1-r1", "5-r2"])
      expect(settled.active).toEqual(tab)
      const later = prune(sync(settled, grown), ["1-r1", "5-r2", "9-r3"], grown)
      expect(later.active).toEqual(tab)
    }
  })
})

describe("tabBar", () => {
  test("Archive, the open roots, an archived active root in its place, then new tabs", () => {
    const bar = tabBar(["1-r1", "5-r2"], { kind: "root", root: "3-x" }, [
      { key: "n", anchor: null, fresh: {} },
    ])
    expect(bar).toEqual([
      ARCHIVE,
      R1,
      { kind: "root", root: "3-x" },
      { kind: "root", root: "5-r2" },
      { kind: "new", key: "n" },
    ])
    expect(tabBar(["1-r1"], R1, [])).toEqual([ARCHIVE, R1])
  })
})

describe("planOpen", () => {
  const l = at(initialLayout())
  test("scrolls to a message a column of its root already shows", () => {
    // The root's first column follows its newest leaf, 4-c, through 2-a.
    expect(planOpen(l, index, new Map(), "2-a")).toEqual({
      kind: "scroll",
      root: "1-r1",
    })
  })
  test("opens beside the column sharing most of its path, in its own root", () => {
    expect(planOpen(l, index, new Map(), "3-b")).toEqual({
      kind: "open",
      root: "1-r1",
      after: 0,
    })
    expect(planOpen(l, index, new Map(), "6-d")).toEqual({
      kind: "scroll",
      root: "5-r2",
    })
  })
  test("previews an archived root, unless it is the tab you are on", () => {
    const archive = new Map([["5-r2", archived("5-r2")]])
    expect(planOpen(l, index, archive, "6-d")).toEqual({
      kind: "preview",
      root: "5-r2",
    })
    const here = at(l, { kind: "root", root: "5-r2" })
    expect(planOpen(here, index, archive, "6-d")?.kind).toBe("scroll")
  })
  test("an entry the index lacks has no plan", () => {
    expect(planOpen(l, index, new Map(), "nope")).toBeNull()
  })
})

describe("encodeLayout / decodeLayout", () => {
  const L = laneNameForThread("l")
  const trip = (l: Layout) =>
    decodeLayout(JSON.parse(JSON.stringify(encodeLayout(l))))

  test("a round trip keeps the tab, each root's columns and new tabs", () => {
    const l: Layout = {
      active: { kind: "new", key: "n" },
      roots: new Map([
        [
          "1-r1",
          [
            { key: "a", anchor: "1-r1" },
            { key: "b", anchor: "2-a", lane: L },
            { key: "d", anchor: "2-a", fresh: { sendId: "s-1" } },
          ],
        ],
      ]),
      newTabs: [{ key: "n", anchor: null, asksAgent: true, fresh: {} }],
    }
    expect(trip(l)).toEqual(l)
    expect(trip(initialLayout())).toEqual(initialLayout())
  })

  test("a message waiting to be sent is never stored, nor restored: it would be sent again", () => {
    const stored = encodeLayout({
      ...initialLayout(),
      roots: new Map([
        ["1-r1", [{ key: "a", anchor: "1-r1", fresh: { pending: "hello" } }]],
      ]),
    })
    expect(JSON.stringify(stored)).not.toContain("hello")
    const raw = {
      v: 2,
      active: null,
      roots: {
        "1-r1": [{ key: "a", anchor: "1-r1", fresh: { pending: "hello" } }],
      },
      newTabs: [],
    }
    expect(decodeLayout(raw)?.roots.get("1-r1")).toEqual([
      { key: "a", anchor: "1-r1", fresh: {} },
    ])
  })

  test("a layout that is another version, or partly malformed, restores nothing", () => {
    const good = { key: "a", anchor: "1-r1" }
    for (const raw of [
      { v: 1, columns: [good] },
      { v: 2, active: null, roots: { r: [] }, newTabs: [] },
      { v: 2, active: { kind: "tab" }, roots: {}, newTabs: [] },
      { v: 2, active: null, roots: { r: [good, { key: 3 }] }, newTabs: [] },
      { v: 2, active: null, roots: {} },
      "layout",
      null,
    ])
      expect(decodeLayout(raw)).toBeUndefined()
  })

  test("a lane that is not a lane name is left off, and the column kept", () => {
    const raw = {
      v: 2,
      active: null,
      roots: { r: [{ key: "a", anchor: "1-a", lane: "w-someone" }] },
      newTabs: [],
    }
    expect(decodeLayout(raw)?.roots.get("r")).toEqual([
      { key: "a", anchor: "1-a" },
    ])
  })
})
