import {
  type EntryId,
  entryId,
  type LaneView,
  laneNameForThread,
  rootIdFor,
  workflowStateIdFor,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { NEW_ROOT, tree } from "./fixtures.ts"
import {
  columnsOf,
  decodeLayout,
  encodeLayout,
  type Here,
  initialLayout,
  type Layout,
  layoutReducer,
  listOf,
  NOTHING,
  planOpen,
  resolveLayout,
  unlisted,
} from "./layout.ts"

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
const R1: Here = { kind: "root", root: entryId("1-r1") }
const at = (l: Layout, here: Here = R1): Layout =>
  layoutReducer(l, { kind: "show", here })
/** Your list, as the session's document holds it, by root entry. */
const listed = (...roots: string[]) => roots.map(entryId)
const resolve = (
  l: Layout,
  i = index,
  archived: ReadonlySet<EntryId> = new Set(),
  lanes: readonly LaneView[] = [],
  list: readonly EntryId[] = [],
) => resolveLayout(l, { index: i, lanes, archived, list })
const sync = (l: Layout, i = index) => resolve(l, i)
/** `l` drawn with `list` as your list. */
const drawn = (l: Layout, list: readonly EntryId[]) =>
  resolve(l, index, new Set(), [], list)
const prune = (
  l: Layout,
  list: readonly EntryId[] = [],
  archived: ReadonlySet<EntryId> = new Set(),
  i = index,
) =>
  layoutReducer(l, {
    kind: "prune",
    index: i,
    lanes: [],
    archived,
    list,
    known: new Set(i.roots),
  })
const R2: Here = { kind: "root", root: entryId("5-r2") }

describe("layoutReducer", () => {
  test("a column action changes only its root's columns", () => {
    const r2 = layoutReducer(at(initialLayout()), {
      kind: "columns",
      root: entryId("5-r2"),
      action: { kind: "open", key: "j", after: 0, anchor: entryId("6-d") },
    })
    const l = layoutReducer(r2, {
      kind: "columns",
      root: entryId("1-r1"),
      action: { kind: "open", key: "k", after: 0, anchor: entryId("4-c") },
    })
    expect(columnsOf(l, entryId("1-r1")).map(c => c.anchor)).toEqual([
      "1-r1",
      "4-c",
    ])
    expect(columnsOf(l, entryId("5-r2"))).toBe(columnsOf(r2, entryId("5-r2")))
    expect(columnsOf(l, entryId("7-r3"))).toEqual([
      { key: "first-7-r3", anchor: entryId("7-r3") },
    ])
  })

  test("a root's first column has a key with no colon, as a presence key needs", () => {
    expect(columnsOf(initialLayout(), entryId("1-r1"))[0]?.key).not.toContain(
      ":",
    )
  })

  test("closing a root's last column gives it its first column again", () => {
    const l = layoutReducer(initialLayout(), {
      kind: "columns",
      root: entryId("1-r1"),
      action: { kind: "close", index: 0 },
    })
    expect(l.roots.has(entryId("1-r1"))).toBe(false)
    expect(columnsOf(l, entryId("1-r1"))).toEqual([
      { key: "first-1-r1", anchor: entryId("1-r1") },
    ])
  })

  test("a new tab, closed before it sends, leaves the layout as it was", () => {
    const before = drawn(at(initialLayout()), listed("1-r1"))
    const opened = layoutReducer(before, {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: true,
    })
    expect(opened.active).toEqual({ kind: "new", key: "n" })
    expect(opened.newTabs).toEqual([
      { key: "n", anchor: null, fresh: { root: NEW_ROOT }, asksAgent: true },
    ])
    expect(layoutReducer(opened, { kind: "closeNewTab", key: "n" })).toEqual(
      before,
    )
  })

  test("a new tab can start with a prefill: a message's text, to send again", () => {
    const prefill = { text: "the first question", blank: false }
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: true,
      prefill,
    })
    expect(opened.newTabs).toEqual([
      {
        key: "n",
        anchor: null,
        fresh: { root: NEW_ROOT, prefill },
        asksAgent: true,
      },
    ])
  })

  test("a sent new tab becomes its root's columns, and stays the one you are on, in your list", () => {
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: false,
    })
    const sent = layoutReducer(opened, {
      kind: "newTabColumn",
      key: "n",
      action: { kind: "sent", key: "n", sendId: "s" },
    })
    expect(sync(sent)).toBe(sent)
    const written = tree({ ...parents, "7-r3": null }, { "7-r3": "s" })
    const synced = sync(sent, written)
    expect(synced.newTabs).toEqual([])
    expect(synced.active).toEqual({ kind: "root", root: "7-r3" })
    // The session puts it in your list as its send is answered; until then
    // it is drawn as the root you are on.
    expect(synced.open).toEqual(["7-r3"])
    expect(columnsOf(synced, entryId("7-r3"))).toEqual([
      { key: "n", anchor: entryId("7-r3") },
    ])
  })

  test("a new tab's column takes the reader's settings, and keeps them as it becomes its root's (ADR-0073)", () => {
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: true,
    })
    const shown = layoutReducer(opened, {
      kind: "newTabColumn",
      key: "n",
      action: { kind: "details", key: "n", open: true },
    })
    expect(shown.newTabs[0]?.details).toBe(true)
    const sent = layoutReducer(shown, {
      kind: "newTabColumn",
      key: "n",
      action: { kind: "sent", key: "n", sendId: "s" },
    })
    const written = tree({ ...parents, "7-r3": null }, { "7-r3": "s" })
    expect(columnsOf(sync(sent, written), entryId("7-r3"))[0]?.details).toBe(
      true,
    )
  })

  test("a new tab bound by its reserved lane becomes that root's tab, in every browser tab holding it (ADR-0057)", () => {
    const R = laneNameForThread("r")
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: true,
    })
    const reserved = layoutReducer(opened, {
      kind: "newTabColumn",
      key: "n",
      action: { kind: "reserve", key: "n", lane: R },
    })
    expect(reserved.newTabs[0]?.reserved).toBe(R)
    // Sent from another browser tab: no send id here, only the lane.
    const written = tree({ ...parents, "7-r3": null })
    const lanes = [
      {
        name: R,
        tip: entryId("7-r3"),
        running: true,
        waiting: 0,
        askedBy: null,
        lastWaiting: null,
        heldBy: null,
      },
    ]
    const synced = resolve(reserved, written, new Set(), lanes)
    expect(synced.newTabs).toEqual([])
    expect(columnsOf(synced, entryId("7-r3"))).toEqual([
      { key: "n", anchor: entryId("7-r3"), lane: R, asksAgent: true },
    ])
  })

  // A stored column that the grown tree moves on, so `sync` returns a new
  // layout rather than the same one.
  const withColumn = (l: Layout) =>
    layoutReducer(l, {
      kind: "columns",
      root: entryId("1-r1"),
      action: { kind: "open", key: "k", after: 0, anchor: entryId("4-c") },
    })

  test("a root someone else starts is not in your list", () => {
    const l = withColumn(drawn(at(initialLayout()), listed("1-r1")))
    const grown = resolve(
      l,
      tree({ ...parents, "8-e": "4-c", "9-r3": null }),
      new Set(),
      [],
      listed("1-r1"),
    )
    expect(grown).not.toBe(l)
    expect(grown.open).toEqual(["1-r1"])
  })

  test("your list is the facts', in its order, and the root you are on wherever it lacks it", () => {
    const l = at(initialLayout(), R2)
    expect(drawn(l, listed("1-r1", "5-r2")).open).toEqual(["1-r1", "5-r2"])
    expect(drawn(l, listed("5-r2", "1-r1")).open).toEqual(["5-r2", "1-r1"])
    // Another device's repair took it out: it stays on the screen you are on.
    expect(drawn(l, listed("1-r1")).open).toEqual(["1-r1", "5-r2"])
    expect(drawn(at(l, NOTHING), listed("1-r1")).open).toEqual(["1-r1"])
  })

  test("a root that leaves your list keeps its columns, and opening it again brings them back", () => {
    const withColumn = layoutReducer(at(initialLayout()), {
      kind: "columns",
      root: entryId("1-r1"),
      action: { kind: "open", key: "k", after: 0, anchor: entryId("3-b") },
    })
    const closed = drawn(
      layoutReducer(withColumn, { kind: "closeRoot", root: entryId("1-r1") }),
      [],
    )
    expect(closed.roots.get(entryId("1-r1"))?.map(c => c.key)).toEqual(
      withColumn.roots.get(entryId("1-r1"))?.map(c => c.key),
    )
    expect(columnsOf(at(closed), entryId("1-r1")).map(c => c.key)).toEqual(
      columnsOf(withColumn, entryId("1-r1")).map(c => c.key),
    )
  })

  test("closing the root you are on shows its neighbour below, else above, else nothing", () => {
    const list = listed("1-r1", "5-r2", "9-r")
    const middle = drawn(at(initialLayout(), R2), list)
    expect(
      layoutReducer(middle, { kind: "closeRoot", root: entryId("5-r2") })
        .active,
    ).toEqual({ kind: "root", root: "9-r" })
    const last = drawn(
      at(initialLayout(), { kind: "root", root: entryId("9-r") }),
      list,
    )
    expect(
      layoutReducer(last, { kind: "closeRoot", root: entryId("9-r") }).active,
    ).toEqual(R2)
    const one = drawn(at(initialLayout()), listed("1-r1"))
    expect(
      layoutReducer(one, { kind: "closeRoot", root: entryId("1-r1") }).active,
    ).toEqual(NOTHING)
    // A tab you are not on closes without moving you.
    expect(
      layoutReducer(middle, { kind: "closeRoot", root: entryId("1-r1") })
        .active,
    ).toEqual(R2)
    // An unsent new tab, likewise: its neighbour.
    const withNew = layoutReducer(drawn(at(initialLayout()), listed("1-r1")), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: false,
    })
    expect(
      layoutReducer(withNew, { kind: "closeNewTab", key: "n" }).active,
    ).toEqual(R1)
  })

  test("archived roots leave your list as drawn, except the one you are on until you leave it", () => {
    const list = listed("1-r1", "5-r2")
    const archived = new Set(list)
    const l = at(initialLayout(), R2)
    const forgotten = resolve(l, index, archived, [], list)
    expect(forgotten.open).toEqual(["5-r2"])
    expect(resolve(forgotten, index, archived, [], list)).toBe(forgotten)
    expect(
      resolve(at(forgotten, NOTHING), index, archived, [], list).open,
    ).toEqual([])
  })

  test("showing a root or a new tab closes the board; showing nothing keeps it", () => {
    const open = layoutReducer(at(initialLayout()), {
      kind: "board",
      open: true,
    })
    expect(open.board).toBe(true)
    expect(at(open, R2).board).toBe(false)
    expect(at(open, NOTHING).board).toBe(true)
    expect(
      layoutReducer(open, {
        kind: "newTab",
        key: "n",
        root: NEW_ROOT,
        asksAgent: true,
      }).board,
    ).toBe(false)
  })

  test("sync moves every stored root's columns on, not only the active one's", () => {
    const l = layoutReducer(at(initialLayout(), NOTHING), {
      kind: "columns",
      root: entryId("5-r2"),
      action: { kind: "open", key: "k", after: 0, anchor: entryId("5-r2") },
    })
    // Both columns of r2 end at its newest leaf, which a reply then moves on.
    const grown = sync(l, tree({ ...parents, "8-e": "6-d" }))
    expect(columnsOf(grown, entryId("5-r2")).map(c => c.anchor)).toEqual([
      "8-e",
      "8-e",
    ])
  })

  test("resolve is idempotent, and the stored state catches up to what it drew", () => {
    const l = withColumn(at(initialLayout()))
    const grown = tree({ ...parents, "8-e": "4-c" })
    const archived = new Set([entryId("5-r2")])
    const list = listed("1-r1", "5-r2")
    const shown = resolve(at(l, R2), grown, archived, [], list)
    expect(resolve(shown, grown, archived, [], list)).toBe(shown)
    const stored = layoutReducer(at(l, R2), {
      kind: "resolve",
      index: grown,
      lanes: [],
      archived,
      list,
    })
    expect(stored).toEqual(shown)
  })

  test("a bound column's anchor moves with its lane's tip in the layout drawn", () => {
    const L = laneNameForThread("l")
    const lane = (tip: string): LaneView => ({
      name: L,
      tip: entryId(tip),
      running: true,
      waiting: 0,
      askedBy: null,
      lastWaiting: null,
      heldBy: null,
    })
    const bound = resolve(withColumn(at(initialLayout())), index, new Set(), [
      lane("4-c"),
    ])
    expect(columnsOf(bound, entryId("1-r1"))[1]).toMatchObject({
      anchor: entryId("4-c"),
      lane: L,
    })
    const replied = tree({ ...parents, "8-e": "4-c" })
    const next = resolve(bound, replied, new Set(), [lane("8-e")])
    expect(columnsOf(next, entryId("1-r1"))[1]?.anchor).toBe("8-e")
  })

  test("prune with nothing stored lands on nothing, with the board open: nothing opens a root by itself", () => {
    const pruned = prune(initialLayout())
    expect(pruned.active).toEqual(NOTHING)
    expect(pruned.board).toBe(true)
  })

  test("prune replaces a root you were on that is archived or gone with the last of your list, and drops a gone root's columns", () => {
    const onR1 = at(initialLayout())
    const archivedR1 = prune(
      onR1,
      listed("5-r2", "1-r1"),
      new Set([entryId("1-r1")]),
    )
    expect(archivedR1.active).toEqual(R2)
    expect(archivedR1.board).toBe(false)
    const gone = layoutReducer(
      at(initialLayout(), { kind: "root", root: entryId("9-x") }),
      {
        kind: "columns",
        root: entryId("9-x"),
        action: { kind: "open", key: "k", after: 0, anchor: entryId("9-y") },
      },
    )
    const pruned = prune(gone, listed("1-r1"))
    expect(pruned.roots.has(entryId("9-x"))).toBe(false)
    expect(pruned.active).toEqual(R1)
    expect(prune(gone).active).toEqual(NOTHING)
  })

  test("once chosen, what you are on stays when a root appears", () => {
    const grown = tree({ ...parents, "9-r3": null })
    const moved = tree({ ...parents, "8-e": "4-c", "9-r3": null })
    for (const here of [R1, NOTHING]) {
      const settled = prune(
        withColumn(at(initialLayout(), here)),
        listed("1-r1"),
      )
      expect(settled.active).toEqual(here)
      const synced = sync(settled, moved)
      expect(synced).not.toBe(settled)
      expect(synced.active).toEqual(here)
      const later = prune(
        sync(settled, grown),
        listed("1-r1"),
        new Set(),
        grown,
      )
      expect(later.active).toEqual(here)
    }
  })
})

describe("listOf", () => {
  test("your list as drawn, then new tabs", () => {
    const l = layoutReducer(
      drawn(at(initialLayout()), listed("5-r2", "1-r1")),
      {
        kind: "newTab",
        key: "n",
        root: NEW_ROOT,
        asksAgent: false,
      },
    )
    expect(listOf(l)).toEqual([R2, R1, { kind: "new", key: "n" }])
    expect(listOf(initialLayout())).toEqual([])
  })
})

test("unlisted: the roots not in your list, and not archived (ADR-0077, ADR-0085)", () => {
  const open = { open: [entryId("1-r1")] }
  expect(
    unlisted(open, new Set([entryId("7-r3")]), [
      entryId("1-r1"),
      entryId("5-r2"),
      entryId("7-r3"),
    ]),
  ).toEqual([entryId("5-r2")])
})

describe("planOpen", () => {
  const l = at(initialLayout())
  test("scrolls to a message a column of its root already shows", () => {
    // The root's first column follows its newest leaf, 4-c, through 2-a.
    expect(planOpen(l, index, entryId("2-a"))).toEqual({
      kind: "scroll",
      root: "1-r1",
      key: expect.any(String),
    })
  })
  test("opens beside the column sharing most of its path, in its own root", () => {
    expect(planOpen(l, index, entryId("3-b"))).toEqual({
      kind: "open",
      root: "1-r1",
      after: 0,
    })
    expect(planOpen(l, index, entryId("6-d"))).toEqual({
      kind: "scroll",
      root: "5-r2",
      key: expect.any(String),
    })
  })
  test("an entry the index lacks has no plan", () => {
    expect(planOpen(l, index, entryId("nope"))).toBeNull()
  })
})

describe("encodeLayout / decodeLayout", () => {
  const L = laneNameForThread("l")
  const trip = (l: Layout) =>
    decodeLayout(JSON.parse(JSON.stringify(encodeLayout(l))), () =>
      rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff"),
    )

  test("a round trip keeps what you are on, each root's columns, new tabs and the board; never your list, which is your document's", () => {
    const l: Layout = {
      active: { kind: "new", key: "n" },
      open: [],
      board: true,
      roots: new Map([
        [
          entryId("1-r1"),
          [
            { key: "a", anchor: entryId("1-r1") },
            { key: "b", anchor: entryId("2-a"), lane: L },
            { key: "d", anchor: entryId("2-a"), fresh: { sendId: "s-1" } },
          ],
        ],
      ]),
      newTabs: [
        {
          key: "n",
          anchor: null,
          asksAgent: true,
          fresh: { root: NEW_ROOT, state: workflowStateIdFor("d") },
        },
      ],
    }
    expect(trip(l)).toEqual(l)
    expect(trip({ ...l, open: [entryId("1-r1")] })?.open).toEqual([])
    expect(trip(initialLayout())).toEqual(initialLayout())
  })

  test("a column's density is kept, and a layout stored before densities still decodes (ADR-0056)", () => {
    const l: Layout = {
      active: { kind: "root", root: entryId("1-r1") },
      open: [],
      board: false,
      roots: new Map([
        [
          entryId("1-r1"),
          [
            { key: "a", anchor: entryId("1-r1"), density: "outline" },
            { key: "b", anchor: entryId("2-a") },
          ],
        ],
      ]),
      newTabs: [],
    }
    expect(trip(l)).toEqual(l)
    const before = JSON.parse(JSON.stringify(encodeLayout(l)))
    delete before.roots["1-r1"][0].density
    expect(
      decodeLayout(before, () => NEW_ROOT)?.roots.get(entryId("1-r1"))?.[0],
    ).toEqual({
      key: "a",
      anchor: entryId("1-r1"),
    })
  })

  test("a column's open details are kept, and a layout stored before them decodes closed (ADR-0073)", () => {
    const l: Layout = {
      active: { kind: "root", root: entryId("1-r1") },
      open: [],
      board: false,
      roots: new Map([
        [
          entryId("1-r1"),
          [
            { key: "a", anchor: entryId("1-r1"), details: true },
            { key: "b", anchor: entryId("2-a") },
          ],
        ],
      ]),
      newTabs: [],
    }
    expect(trip(l)).toEqual(l)
    const before = JSON.parse(JSON.stringify(encodeLayout(l)))
    delete before.roots["1-r1"][0].details
    expect(
      decodeLayout(before, () => NEW_ROOT)?.roots.get(entryId("1-r1"))?.[0],
    ).toEqual({ key: "a", anchor: entryId("1-r1") })
  })

  test("a message waiting to be sent is never stored, nor restored: it would be sent again", () => {
    const stored = encodeLayout({
      ...initialLayout(),
      roots: new Map([
        [
          entryId("1-r1"),
          [
            {
              key: "a",
              anchor: entryId("1-r1"),
              fresh: { pending: { text: "hello" } },
            },
          ],
        ],
      ]),
    })
    expect(JSON.stringify(stored)).not.toContain("hello")
    const raw = {
      v: 5,
      active: null,
      roots: {
        "1-r1": [
          { key: "a", anchor: entryId("1-r1"), fresh: { pending: "hello" } },
        ],
      },
      newTabs: [],
      board: false,
    }
    expect(
      decodeLayout(raw, () => NEW_ROOT)?.roots.get(entryId("1-r1")),
    ).toEqual([{ key: "a", anchor: entryId("1-r1"), fresh: {} }])
  })

  test("a prefill, blank or content, and where its agent works, is stored and restored: only pending sends on opening", () => {
    const l = {
      ...initialLayout(),
      roots: new Map([
        [
          entryId("1-r1"),
          [
            { key: "a", anchor: entryId("1-r1") },
            {
              key: "b",
              anchor: entryId("1-r1"),
              fresh: { prefill: { text: "@agent ", blank: true } },
            },
            {
              key: "c",
              anchor: entryId("1-r1"),
              fresh: { prefill: { text: "say it again", blank: false } },
            },
            {
              key: "d",
              anchor: entryId("1-r1"),
              fresh: {
                prefill: {
                  text: "resolve them",
                  blank: false,
                  work: { kind: "direct" as const, dir: "/work" },
                },
              },
            },
          ],
        ],
      ]),
    }
    expect(decodeLayout(encodeLayout(l), () => NEW_ROOT)).toEqual(l)
  })

  test("a layout that is another version, or partly malformed, restores nothing", () => {
    const good = { key: "a", anchor: entryId("1-r1") }
    for (const raw of [
      { v: 1, columns: [good] },
      { v: 2, active: null, roots: {}, newTabs: [] },
      // A layout of this shape under the previous version is dropped too.
      { v: 3, active: null, open: [], roots: {}, newTabs: [] },
      // v3 stored a prefill as a string.
      {
        v: 3,
        active: null,
        open: [],
        roots: {
          r: [
            {
              key: "a",
              anchor: entryId("1-r1"),
              fresh: { prefill: "@agent " },
            },
          ],
        },
        newTabs: [],
      },
      // v4 held your list (ADR-0085), and an Archive tab; one in v5's shape
      // under v4 is dropped too.
      { v: 4, active: null, roots: {}, newTabs: [], board: false },
      { v: 4, active: { kind: "archive" }, open: [], roots: {}, newTabs: [] },
      { v: 5, active: null, roots: { r: [] }, newTabs: [], board: false },
      {
        v: 5,
        active: { kind: "archive" },
        roots: {},
        newTabs: [],
        board: false,
      },
      {
        v: 5,
        active: null,
        roots: { r: [good, { key: 3 }] },
        newTabs: [],
        board: false,
      },
      { v: 5, active: null, roots: {}, newTabs: [] },
      "layout",
      null,
    ])
      expect(decodeLayout(raw, () => NEW_ROOT)).toBeUndefined()
  })

  test("a reservation is stored, and one not in the host's shape is left off (ADR-0057)", () => {
    const R = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
    const l: Layout = {
      ...initialLayout(),
      newTabs: [
        { key: "n", anchor: null, reserved: R, fresh: { root: NEW_ROOT } },
      ],
    }
    expect(trip(l)).toEqual(l)
    const raw = {
      ...encodeLayout(l),
      newTabs: [{ key: "n", anchor: null, reserved: "t-x" }],
    }
    expect(decodeLayout(raw, () => NEW_ROOT)?.newTabs).toEqual([
      { key: "n", anchor: null },
    ])
  })

  test("a new tab keeps its root; one stored without one, or with one not in the host's shape, is given one (ADR-0066)", () => {
    const minted = rootIdFor("01a0ffd2-0000-7000-8000-00000000000c")
    const stored = (fresh: object) => ({
      ...encodeLayout(initialLayout()),
      newTabs: [{ key: "n", anchor: null, fresh }],
    })
    const rootOf = (fresh: object) =>
      decodeLayout(stored(fresh), () => minted)?.newTabs[0]?.fresh?.root
    expect(rootOf({ root: NEW_ROOT })).toBe(NEW_ROOT)
    expect(rootOf({})).toBe(minted)
    expect(rootOf({ root: "r-x" })).toBe(minted)
  })

  test("a lane that is not a lane name is left off, and the column kept", () => {
    const raw = {
      v: 5,
      active: null,
      roots: { r: [{ key: "a", anchor: entryId("1-a"), lane: "w-someone" }] },
      newTabs: [],
      board: false,
    }
    expect(decodeLayout(raw, () => NEW_ROOT)?.roots.get(entryId("r"))).toEqual([
      { key: "a", anchor: entryId("1-a") },
    ])
  })
})
