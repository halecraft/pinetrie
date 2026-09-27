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
const prune = (
  l: Layout,
  archive: ReadonlyMap<string, ArchiveRecord> = new Map(),
  i = index,
) => layoutReducer(l, { kind: "prune", index: i, archive })
const R2: ActiveTab = { kind: "root", root: "5-r2" }
const forget = (l: Layout, archive: ReadonlyMap<string, ArchiveRecord>) =>
  layoutReducer(l, { kind: "forgetArchived", archive })
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
    expect(layoutReducer(opened, { kind: "closeNewTab", key: "n" })).toEqual(
      before,
    )
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
    expect(synced.open).toEqual(["1-r1", "7-r3"])
    expect(columnsOf(synced, "7-r3")).toEqual([{ key: "n", anchor: "7-r3" }])
  })

  // A stored column that the grown tree moves on, so `sync` returns a new
  // layout rather than the same one.
  const withColumn = (l: Layout) =>
    layoutReducer(l, {
      kind: "columns",
      root: "1-r1",
      action: { kind: "open", key: "k", after: 0, anchor: "4-c" },
    })

  test("a root someone else starts opens no tab", () => {
    const l = withColumn(at(initialLayout()))
    const grown = sync(l, tree({ ...parents, "8-e": "4-c", "9-r3": null }))
    expect(grown).not.toBe(l)
    expect(grown.open).toEqual(["1-r1"])
  })

  test("showing a root opens it once, at the end", () => {
    const l = at(at(at(initialLayout()), R2))
    expect(l.open).toEqual(["1-r1", "5-r2"])
    expect(at(l, ARCHIVE).open).toEqual(["1-r1", "5-r2"])
  })

  test("closing a root's tab keeps its columns, and opening it again brings them back", () => {
    const withColumn = layoutReducer(at(initialLayout()), {
      kind: "columns",
      root: "1-r1",
      action: { kind: "open", key: "k", after: 0, anchor: "3-b" },
    })
    const closed = layoutReducer(withColumn, {
      kind: "closeRoot",
      root: "1-r1",
    })
    expect(closed.open).toEqual([])
    expect(closed.roots.get("1-r1")).toBe(withColumn.roots.get("1-r1"))
    const back = at(closed)
    expect(back.open).toEqual(["1-r1"])
    expect(columnsOf(back, "1-r1")).toBe(columnsOf(withColumn, "1-r1"))
  })

  test("closing the tab you are on shows its right neighbour, else its left, else Archive", () => {
    const three = at(at(at(initialLayout()), R2), { kind: "root", root: "9-r" })
    const middle = at(three, R2)
    expect(
      layoutReducer(middle, { kind: "closeRoot", root: "5-r2" }).active,
    ).toEqual({ kind: "root", root: "9-r" })
    const last = layoutReducer(three, { kind: "closeRoot", root: "9-r" })
    expect(last.active).toEqual(R2)
    const one = at(initialLayout())
    expect(
      layoutReducer(one, { kind: "closeRoot", root: "1-r1" }).active,
    ).toEqual(ARCHIVE)
    // A tab you are not on closes without moving you.
    expect(
      layoutReducer(middle, { kind: "closeRoot", root: "1-r1" }).active,
    ).toEqual(R2)
    // An unsent new tab, likewise: its neighbour.
    const withNew = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      asksAgent: false,
    })
    expect(
      layoutReducer(withNew, { kind: "closeNewTab", key: "n" }).active,
    ).toEqual(R1)
  })

  test("archived roots leave your tabs, except the one you are on until you leave it", () => {
    // Open r1, then r2, and be on r2.
    const l = at(at(initialLayout()), R2)
    const archive = new Map([
      ["1-r1", archived("1-r1")],
      ["5-r2", archived("5-r2")],
    ])
    const forgotten = forget(l, archive)
    expect(forgotten.open).toEqual(["5-r2"])
    expect(forget(forgotten, archive)).toBe(forgotten)
    expect(forget(at(forgotten, ARCHIVE), archive).open).toEqual([])
    expect(forget(l, new Map())).toBe(l)
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

  test("prune with nothing stored lands on Archive: nothing opens a tab by itself", () => {
    expect(prune(initialLayout()).active).toEqual(ARCHIVE)
    expect(prune(initialLayout()).open).toEqual([])
  })

  test("prune replaces an active root that is archived or gone with your last open tab, and drops a gone root", () => {
    const both = at(at(initialLayout(), R2))
    const archivedR1 = prune(both, new Map([["1-r1", archived("1-r1")]]))
    expect(archivedR1.active).toEqual(R2)
    expect(archivedR1.open).toEqual(["5-r2"])
    const gone = layoutReducer(
      at(initialLayout(), { kind: "root", root: "9-x" }),
      {
        kind: "columns",
        root: "9-x",
        action: { kind: "open", key: "k", after: 0, anchor: "9-y" },
      },
    )
    const pruned = prune(layoutReducer(gone, { kind: "show", tab: R1 }))
    expect(pruned.roots.has("9-x")).toBe(false)
    expect(pruned.open).toEqual(["1-r1"])
    const lost = prune(gone)
    expect(lost.active).toEqual(ARCHIVE)
  })

  test("once chosen, the tab you are on stays when a root appears", () => {
    const grown = tree({ ...parents, "9-r3": null })
    const moved = tree({ ...parents, "8-e": "4-c", "9-r3": null })
    for (const tab of [R1, ARCHIVE]) {
      const settled = prune(withColumn(at(initialLayout(), tab)))
      expect(settled.active).toEqual(tab)
      const synced = sync(settled, moved)
      expect(synced).not.toBe(settled)
      expect(synced.active).toEqual(tab)
      const later = prune(sync(settled, grown), new Map(), grown)
      expect(later.active).toEqual(tab)
    }
  })
})

describe("tabBar", () => {
  test("Archive, your open roots in the order you opened them, then new tabs", () => {
    const l = layoutReducer(at(at(initialLayout(), R2)), {
      kind: "newTab",
      key: "n",
      asksAgent: false,
    })
    expect(tabBar(l)).toEqual([ARCHIVE, R2, R1, { kind: "new", key: "n" }])
    expect(tabBar(initialLayout())).toEqual([ARCHIVE])
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
      open: ["1-r1", "5-r2"],
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
      v: 3,
      active: null,
      open: [],
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
      { v: 2, active: null, roots: {}, newTabs: [] },
      // A layout of this shape under the previous version is dropped too.
      { v: 2, active: null, open: [], roots: {}, newTabs: [] },
      { v: 3, active: null, open: [], roots: { r: [] }, newTabs: [] },
      { v: 3, active: { kind: "tab" }, open: [], roots: {}, newTabs: [] },
      { v: 3, active: null, open: [3], roots: {}, newTabs: [] },
      {
        v: 3,
        active: null,
        open: [],
        roots: { r: [good, { key: 3 }] },
        newTabs: [],
      },
      { v: 3, active: null, roots: {}, newTabs: [] },
      "layout",
      null,
    ])
      expect(decodeLayout(raw)).toBeUndefined()
  })

  test("a lane that is not a lane name is left off, and the column kept", () => {
    const raw = {
      v: 3,
      active: null,
      open: [],
      roots: { r: [{ key: "a", anchor: "1-a", lane: "w-someone" }] },
      newTabs: [],
    }
    expect(decodeLayout(raw)?.roots.get("r")).toEqual([
      { key: "a", anchor: "1-a" },
    ])
  })
})
