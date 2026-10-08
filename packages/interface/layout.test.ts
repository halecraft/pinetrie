import {
  type EntryId,
  entryId,
  indexTree,
  type LaneView,
  threadIdFor,
  workflowStateIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  entriesOf,
  entry,
  NEW_ROOT,
  NEW_THREAD,
  threadOfEntry,
  tree,
  withThreads,
} from "./fixtures.ts"
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
/** The sidebar, as the session's document holds it, by root entry. */
const listed = (...roots: string[]) => roots.map(entryId)
const resolve = (
  l: Layout,
  i = index,
  archived: ReadonlySet<EntryId> = new Set(),
  lanes: readonly LaneView[] = [],
  list: readonly EntryId[] = [],
) => resolveLayout(l, { index: i, lanes, archived, list })
const sync = (l: Layout, i = index) => resolve(l, i)
/** `l` drawn with `list` as the sidebar. */
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
      thread: NEW_THREAD,
      asksAgent: true,
    })
    expect(opened.active).toEqual({ kind: "new", key: "n" })
    expect(opened.newTabs).toEqual([
      {
        key: "n",
        anchor: null,
        thread: NEW_THREAD,
        fresh: { root: NEW_ROOT },
        asksAgent: true,
      },
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
      thread: NEW_THREAD,
      asksAgent: true,
      prefill,
    })
    expect(opened.newTabs).toEqual([
      {
        key: "n",
        anchor: null,
        thread: NEW_THREAD,
        fresh: { root: NEW_ROOT, prefill },
        asksAgent: true,
      },
    ])
  })

  test("a sent new tab becomes its root's columns, and stays the one you are on, in the sidebar", () => {
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      thread: NEW_THREAD,
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
    // The session puts it in the sidebar as its send is answered; until then
    // it is drawn as the root you are on.
    expect(synced.open).toEqual(["7-r3"])
    expect(columnsOf(synced, entryId("7-r3"))).toEqual([
      { key: "n", anchor: entryId("7-r3"), thread: NEW_THREAD },
    ])
  })

  test("a new tab's column takes the reader's settings, and keeps them as it becomes its root's (ADR-0073)", () => {
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      thread: NEW_THREAD,
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

  test("a new tab whose thread starts becomes that root's tab, in every browser tab holding it (ADR-0117)", () => {
    const opened = layoutReducer(at(initialLayout()), {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      thread: NEW_THREAD,
      asksAgent: true,
    })
    // Sent from another browser tab: no send id here, only its thread's
    // first message.
    const written = indexTree(
      withThreads(
        entriesOf([
          ...Object.entries(parents).map(([id, parent]) =>
            entry(id, parent, { role: "chat", content: id }),
          ),
        ]),
      ),
    )
    const started = indexTree({
      ...written.entries,
      ...entriesOf([
        entry("7-r3", null, {
          role: "chat",
          content: "7-r3",
          starts: NEW_THREAD,
        }),
      ]),
    })
    const synced = resolve(opened, started)
    expect(synced.newTabs).toEqual([])
    expect(columnsOf(synced, entryId("7-r3"))).toEqual([
      {
        key: "n",
        anchor: entryId("7-r3"),
        thread: NEW_THREAD,
        asksAgent: true,
      },
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

  test("a root someone else starts is not in the sidebar", () => {
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

  test("the sidebar is the facts', in its order, and the root you are on wherever it lacks it", () => {
    const l = at(initialLayout(), R2)
    expect(drawn(l, listed("1-r1", "5-r2")).open).toEqual(["1-r1", "5-r2"])
    expect(drawn(l, listed("5-r2", "1-r1")).open).toEqual(["5-r2", "1-r1"])
    // Another device's repair took it out: it stays on the screen you are on.
    expect(drawn(l, listed("1-r1")).open).toEqual(["1-r1", "5-r2"])
    expect(drawn(at(l, NOTHING), listed("1-r1")).open).toEqual(["1-r1"])
  })

  test("a root that leaves the sidebar keeps its columns, and opening it again brings them back", () => {
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
      thread: NEW_THREAD,
      asksAgent: false,
    })
    expect(
      layoutReducer(withNew, { kind: "closeNewTab", key: "n" }).active,
    ).toEqual(R1)
  })

  test("archived roots leave the sidebar as drawn, except the one you are on until you leave it", () => {
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
        thread: NEW_THREAD,
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

  test("a column's anchor moves with its thread's end in the layout drawn", () => {
    const drawn = resolve(withColumn(at(initialLayout())), index)
    expect(columnsOf(drawn, entryId("1-r1"))[1]).toMatchObject({
      anchor: entryId("4-c"),
      thread: threadOfEntry("4-c"),
    })
    const replied = tree({ ...parents, "8-e": "4-c" })
    const next = resolve(drawn, replied)
    expect(columnsOf(next, entryId("1-r1"))[1]?.anchor).toBe("8-e")
  })

  test("prune with nothing stored lands on nothing, with the board open: nothing opens a root by itself", () => {
    const pruned = prune(initialLayout())
    expect(pruned.active).toEqual(NOTHING)
    expect(pruned.board).toBe(true)
  })

  test("prune replaces a root you were on that is archived or gone with the last of the sidebar, and drops a gone root's columns", () => {
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
  test("the sidebar as drawn, then new tabs", () => {
    const l = layoutReducer(
      drawn(at(initialLayout()), listed("5-r2", "1-r1")),
      {
        kind: "newTab",
        key: "n",
        root: NEW_ROOT,
        thread: NEW_THREAD,
        asksAgent: false,
      },
    )
    expect(listOf(l)).toEqual([R2, R1, { kind: "new", key: "n" }])
    expect(listOf(initialLayout())).toEqual([])
  })
})

test("unlisted: the roots not in the sidebar, and not archived (ADR-0077, ADR-0122)", () => {
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
    // The root's first column follows its thread, through 2-a to 3-b.
    expect(planOpen(l, index, entryId("2-a"))).toEqual({
      kind: "scroll",
      root: "1-r1",
      key: expect.any(String),
    })
  })
  test("opens beside the column sharing most of its path, in its own root", () => {
    // 4-c is a branch at 2-a: another thread, which no column shows.
    expect(planOpen(l, index, entryId("4-c"))).toEqual({
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
  const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000bb")
  const trip = (l: Layout) =>
    decodeLayout(JSON.parse(JSON.stringify(encodeLayout(l))))

  test("a round trip keeps what you are on, each root's columns and threads, new tabs and the board; never the sidebar, which is your document's", () => {
    const l: Layout = {
      active: { kind: "new", key: "n" },
      open: [],
      board: true,
      roots: new Map([
        [
          entryId("1-r1"),
          [
            { key: "a", anchor: entryId("1-r1") },
            { key: "b", anchor: entryId("2-a"), thread: T },
            {
              key: "d",
              anchor: entryId("2-a"),
              thread: NEW_THREAD,
              fresh: { sendId: "s-1" },
            },
          ],
        ],
      ]),
      newTabs: [
        {
          key: "n",
          anchor: null,
          thread: NEW_THREAD,
          asksAgent: true,
          fresh: { root: NEW_ROOT, state: workflowStateIdFor("d") },
        },
      ],
    }
    expect(trip(l)).toEqual(l)
    expect(trip({ ...l, open: [entryId("1-r1")] })?.open).toEqual([])
    expect(trip(initialLayout())).toEqual(initialLayout())
  })

  test("a column's density and open details are kept (ADR-0106, ADR-0073)", () => {
    const l: Layout = {
      active: { kind: "root", root: entryId("1-r1") },
      open: [],
      board: false,
      roots: new Map([
        [
          entryId("1-r1"),
          [
            { key: "a", anchor: entryId("1-r1"), density: "outline" },
            { key: "b", anchor: entryId("2-a"), details: true },
          ],
        ],
      ]),
      newTabs: [],
    }
    expect(trip(l)).toEqual(l)
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
              thread: NEW_THREAD,
              fresh: { pending: { text: "hello" } },
            },
          ],
        ],
      ]),
    })
    expect(JSON.stringify(stored)).not.toContain("hello")
    const raw = {
      v: 6,
      active: null,
      roots: {
        "1-r1": [
          {
            key: "a",
            anchor: entryId("1-r1"),
            thread: NEW_THREAD,
            fresh: { pending: "hello" },
          },
        ],
      },
      newTabs: [],
      board: false,
    }
    expect(decodeLayout(raw)?.roots.get(entryId("1-r1"))).toEqual([
      { key: "a", anchor: entryId("1-r1"), thread: NEW_THREAD, fresh: {} },
    ])
  })

  test("a prefill, blank or content, is stored and restored: only pending sends on opening", () => {
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
              thread: NEW_THREAD,
              fresh: { prefill: { text: "@agent ", blank: true } },
            },
            {
              key: "c",
              anchor: entryId("1-r1"),
              thread: T,
              fresh: { prefill: { text: "say it again", blank: false } },
            },
          ],
        ],
      ]),
    }
    expect(decodeLayout(encodeLayout(l))).toEqual(l)
  })

  test("a layout that is another version, or partly malformed, restores nothing", () => {
    const good = { key: "a", anchor: entryId("1-r1") }
    for (const raw of [
      { v: 1, columns: [good] },
      { v: 2, active: null, roots: {}, newTabs: [] },
      { v: 3, active: null, open: [], roots: {}, newTabs: [] },
      { v: 4, active: null, roots: {}, newTabs: [], board: false },
      // v5 named a column's lane and reserved id (ADR-0117); one in v6's
      // shape under v5 is dropped too.
      { v: 5, active: null, roots: { r: [good] }, newTabs: [], board: false },
      { v: 6, active: null, roots: { r: [] }, newTabs: [], board: false },
      {
        v: 6,
        active: { kind: "archive" },
        roots: {},
        newTabs: [],
        board: false,
      },
      {
        v: 6,
        active: null,
        roots: { r: [good, { key: 3 }] },
        newTabs: [],
        board: false,
      },
      {
        v: 6,
        active: null,
        roots: { r: [{ ...good, thread: "w-someone" }] },
        newTabs: [],
        board: false,
      },
      { v: 6, active: null, roots: {}, newTabs: [] },
      "layout",
      null,
    ])
      expect(decodeLayout(raw)).toBeUndefined()
  })

  test("a fresh column with no thread, or a new tab with no root of its own, restores nothing (ADR-0066, ADR-0117)", () => {
    const stored = (column: object) => ({
      ...encodeLayout(initialLayout()),
      newTabs: [column],
    })
    expect(
      decodeLayout(
        stored({
          key: "n",
          anchor: null,
          thread: NEW_THREAD,
          fresh: { root: NEW_ROOT },
        }),
      )?.newTabs[0]?.fresh?.root,
    ).toBe(NEW_ROOT)
    for (const column of [
      { key: "n", anchor: null, fresh: { root: NEW_ROOT } },
      { key: "n", anchor: null, thread: NEW_THREAD, fresh: {} },
      { key: "n", anchor: null, thread: NEW_THREAD, fresh: { root: "r-x" } },
    ])
      expect(decodeLayout(stored(column))).toBeUndefined()
  })
})
