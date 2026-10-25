import {
  type CanvasId,
  canvasIdFor,
  entryId,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  type CardId,
  indexTree,
  type LaneView,
  type TreeIndex,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { defaultView, type YourCanvasView } from "./canvas-columns.ts"
import {
  canvasesFor,
  entriesById,
  entry,
  NEW_CANVAS,
  NEW_THREAD,
  personMessage,
  threadOfEntry,
  tree,
} from "./fixtures.ts"
import {
  decodeLayout,
  drawnColumns,
  encodeLayout,
  type Here,
  initialLayout,
  type Layout,
  type LayoutAction,
  layoutReducer,
  NOTHING,
  planOpen,
  resolveLayout,
  sidebarList,
  storedLayout,
  unlisted,
  type ViewChange,
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
/**
 * Each root's canvas, one a root: `7-r3` is the root a new canvas's first send
 * writes, so its canvas is the one the tab minted.
 */
const TK = (root: string): CanvasId =>
  root === "7-r3" ? NEW_CANVAS : canvasIdFor(root)
const ROOTS = ["1-r1", "5-r2", "7-r3", "9-r", "9-x"]
/** Each canvas's threads on its canvas, in thread order (`canvasesFor`). */
const canvasesIn = (i: TreeIndex) =>
  canvasesFor(i, ...ROOTS.map(r => [TK(r), entryId(r)] as const)).index
const CANVASES = canvasesIn(index)
const _ADA = writerId("ada@x.io")
const R1: Here = { kind: "canvas", canvas: TK("1-r1") }
const R2: Here = { kind: "canvas", canvas: TK("5-r2") }
const TRUNK = threadOfEntry("1-r1")
const C = threadOfEntry("4-c")
const at = (l: Layout, here: Here = R1): Layout =>
  layoutReducer(l, { kind: "show", here })
/** The sidebar, as the session's document holds it, by root entry. */
const listed = (...roots: string[]) => roots.map(TK)
const resolve = (
  l: Layout,
  i = index,
  archived: ReadonlySet<CanvasId> = new Set(),
  lanes: readonly LaneView[] = [],
  list: readonly CanvasId[] = [],
  cardsOn = canvasesIn(i).cardsOn,
) =>
  resolveLayout(l, {
    index: i,
    lanes,
    archived,
    list,
    cardsOn,
    unstarted: new Map(),
    inventoryHolders: new Map(),
  })
const sync = (l: Layout, i = index) => resolve(l, i)
/** `l` drawn with `list` as the sidebar. */
const drawn = (l: Layout, list: readonly CanvasId[]) =>
  resolve(l, index, new Set(), [], list)
const prune = (
  l: Layout,
  list: readonly CanvasId[] = [],
  archived: ReadonlySet<CanvasId> = new Set(),
  i = index,
  cardsOn = canvasesIn(i).cardsOn,
) =>
  layoutReducer(l, {
    kind: "prune",
    index: i,
    lanes: [],
    archived,
    list,
    cardsOn,
    unstarted: new Map(),
    inventoryHolders: new Map(),
    known: new Set(i.roots.map(r => TK(r))),
  })
/** A change to your view of `root`'s canvas, its first card the canvas's. */
const view = (root: string, change: ViewChange): LayoutAction => ({
  kind: "view",
  canvas: TK(root),
  first: CANVASES.cardsOn.get(TK(root))?.[0]?.id ?? null,
  change,
})
const unfold = (card: CardId, root = "1-r1") =>
  view(root, { kind: "fold", card, unfolded: true })
/** The keys of `root`'s canvas's columns as drawn, each folded or not. */
const columnsOf = (l: Layout, root = "1-r1", i = index) =>
  drawnColumns(l, TK(root), {
    cardsOn: canvasesIn(i).cardsOn,
    unstarted: new Map(),
    inventoryHolders: new Map(),
    index: i,
    lanes: [],
  }).map(c => [c.kind !== "thread" ? c.card : c.column.key, c.folded])
describe("layoutReducer", () => {
  test("a view change changes only its canvas's view, which starts from the default", () => {
    const l = layoutReducer(at(initialLayout()), unfold(C))
    expect(columnsOf(l)).toEqual([
      [TRUNK, false],
      [C, false],
    ])
    expect(l.canvases.has(TK("5-r2"))).toBe(false)
    expect(columnsOf(l, "5-r2")).toEqual([[threadOfEntry("5-r2"), false]])
    const folded = layoutReducer(
      l,
      view("1-r1", { kind: "fold", card: TRUNK, unfolded: false }),
    )
    expect(columnsOf(folded)).toEqual([
      [TRUNK, true],
      [C, false],
    ])
    // Unfolding what is unfolded changes nothing.
    expect(layoutReducer(folded, unfold(C))).toBe(folded)
  })

  test("the canvas column starts folded, and folds apart from the cards", () => {
    const l = layoutReducer(
      initialLayout(),
      view("1-r1", { kind: "fold-canvas", unfolded: true }),
    )
    expect(l.canvases.get(TK("1-r1"))?.canvas).toEqual({ unfolded: true })
    expect(defaultView(null).canvas).toEqual({ unfolded: false })
  })

  test("a reader's density is kept by card, folded or not", () => {
    const l = layoutReducer(
      initialLayout(),
      view("1-r1", { kind: "density", card: C, density: "outline" }),
    )
    expect(l.canvases.get(TK("1-r1"))?.cards.get(C)).toEqual({
      density: "outline",
    })
  })

  test("a thread you opened is unfolded with what it starts with, until its first send spends it; reader settings stay", () => {
    const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    const pending = { text: "@agent separately?" }
    const prefill = { text: "@agent ", blank: true }
    const opened = layoutReducer(
      initialLayout(),
      view("1-r1", {
        kind: "opened",
        card: T,
        pending,
        prefill,
      }),
    )
    expect(opened.canvases.get(TK("1-r1"))?.cards.get(T)).toEqual({
      unfolded: true,
      pending,
      prefill,
    })
    const read = layoutReducer(
      opened,
      view("1-r1", { kind: "density", card: T, density: "raw" }),
    )
    const sent = layoutReducer(read, view("1-r1", { kind: "sent", card: T }))
    expect(sent.canvases.get(TK("1-r1"))?.cards.get(T)).toEqual({
      unfolded: true,
      density: "raw",
    })
    expect(layoutReducer(sent, view("1-r1", { kind: "sent", card: T }))).toBe(
      sent,
    )
  })

  test("the sidebar is the facts', in its order, and the canvas you are on wherever it lacks it", () => {
    const l = at(initialLayout(), R2)
    expect(drawn(l, listed("1-r1", "5-r2")).open).toEqual([
      TK("1-r1"),
      TK("5-r2"),
    ])
    expect(drawn(l, listed("5-r2", "1-r1")).open).toEqual([
      TK("5-r2"),
      TK("1-r1"),
    ])
    // Another device's repair took it out: it stays on the screen you are on.
    expect(drawn(l, listed("1-r1")).open).toEqual([TK("1-r1"), TK("5-r2")])
    expect(drawn(at(l, NOTHING), listed("1-r1")).open).toEqual([TK("1-r1")])
  })

  test("a canvas that leaves the sidebar keeps your view of it, and opening it again brings it back", () => {
    const viewed = layoutReducer(at(initialLayout()), unfold(C))
    const closed = drawn(
      layoutReducer(viewed, { kind: "close-canvas", canvas: TK("1-r1") }),
      [],
    )
    expect(columnsOf(at(closed))).toEqual(columnsOf(viewed))
  })

  test("closing the canvas you are on shows its neighbour below, else above, else nothing", () => {
    const list = listed("1-r1", "5-r2", "9-r")
    const middle = drawn(at(initialLayout(), R2), list)
    expect(
      layoutReducer(middle, { kind: "close-canvas", canvas: TK("5-r2") })
        .active,
    ).toEqual({ kind: "canvas", canvas: TK("9-r") })
    const last = drawn(
      at(initialLayout(), { kind: "canvas", canvas: TK("9-r") }),
      list,
    )
    expect(
      layoutReducer(last, { kind: "close-canvas", canvas: TK("9-r") }).active,
    ).toEqual(R2)
    const one = drawn(at(initialLayout()), listed("1-r1"))
    expect(
      layoutReducer(one, { kind: "close-canvas", canvas: TK("1-r1") }).active,
    ).toEqual(NOTHING)
    // A tab you are not on closes without moving you.
    expect(
      layoutReducer(middle, { kind: "close-canvas", canvas: TK("1-r1") })
        .active,
    ).toEqual(R2)
  })

  test("archived canvases leave the sidebar as drawn, except the one you are on until you leave it", () => {
    const list = listed("1-r1", "5-r2")
    const archived = new Set(list)
    const l = at(initialLayout(), R2)
    const forgotten = resolve(l, index, archived, [], list)
    expect(forgotten.open).toEqual([TK("5-r2")])
    expect(resolve(forgotten, index, archived, [], list)).toBe(forgotten)
    expect(
      resolve(at(forgotten, NOTHING), index, archived, [], list).open,
    ).toEqual([])
  })

  test("showing a canvas closes the board; showing nothing keeps it", () => {
    const open = layoutReducer(at(initialLayout()), {
      kind: "board",
      open: true,
    })
    expect(open.board).toBe(true)
    expect(at(open, R2).board).toBe(false)
    expect(at(open, NOTHING).board).toBe(true)
  })

  test("resolve is idempotent, and the stored state catches up to what it drew", () => {
    const l = at(initialLayout())
    const archived = new Set([TK("5-r2")])
    const list = listed("1-r1", "5-r2")
    const shown = resolve(l, index, archived, [], list)
    expect(resolve(shown, index, archived, [], list)).toBe(shown)
    const stored = layoutReducer(l, {
      kind: "resolve",
      index,
      lanes: [],
      archived,
      list,
      cardsOn: CANVASES.cardsOn,
      unstarted: new Map(),
      inventoryHolders: new Map(),
    })
    expect(stored).toEqual(shown)
  })

  test("the canvas you are on keeps its default view once its cards are drawn: a later tick folds nothing", () => {
    const shown = resolve(at(initialLayout()))
    expect(shown.canvases.get(TK("1-r1"))).toEqual(
      defaultView(CANVASES.cardsOn.get(TK("1-r1"))?.[0]?.id ?? null),
    )
    const cards = CANVASES.cardsOn.get(TK("1-r1")) ?? []
    const ticked = new Map([
      [
        TK("1-r1"),
        cards.map(c => ({ ...c, content: { ticked: true } }) as typeof c),
      ],
    ])
    expect(
      drawnColumns(shown, TK("1-r1"), {
        cardsOn: ticked,
        unstarted: new Map(),
        inventoryHolders: new Map(),
        index,
        lanes: [],
      }).map(c => c.folded),
    ).toEqual(columnsOf(shown).map(([, folded]) => folded))
    // Before its cards arrive, nothing is kept: it would unfold nothing.
    expect(
      resolve(at(initialLayout()), index, new Set(), [], [], new Map()).canvases
        .size,
    ).toBe(0)
  })

  test("a column's anchor moves with its thread's end", () => {
    expect(
      drawnColumns(initialLayout(), TK("1-r1"), {
        cardsOn: CANVASES.cardsOn,
        unstarted: new Map(),
        inventoryHolders: new Map(),
        index,
        lanes: [],
      })[0],
    ).toMatchObject({ column: { anchor: entryId("3-b") } })
    const replied = tree({ ...parents, "8-e": "3-b" })
    expect(
      drawnColumns(initialLayout(), TK("1-r1"), {
        cardsOn: canvasesIn(replied).cardsOn,
        unstarted: new Map(),
        inventoryHolders: new Map(),
        index: replied,
        lanes: [],
      })[0],
    ).toMatchObject({ column: { anchor: entryId("8-e") } })
  })

  test("prune with nothing stored lands on nothing, with the board open: nothing opens a canvas by itself", () => {
    const pruned = prune(initialLayout())
    expect(pruned.active).toEqual(NOTHING)
    expect(pruned.board).toBe(true)
  })

  test("prune replaces a canvas you were on that is archived or gone with the last of the sidebar, and drops a gone canvas's view", () => {
    const onR1 = at(initialLayout())
    const archivedR1 = prune(
      onR1,
      listed("5-r2", "1-r1"),
      new Set([TK("1-r1")]),
    )
    expect(archivedR1.active).toEqual(R2)
    expect(archivedR1.board).toBe(false)
    const gone = layoutReducer(
      at(initialLayout(), { kind: "canvas", canvas: TK("9-x") }),
      view("9-x", { kind: "fold", card: C, unfolded: true }),
    )
    const pruned = prune(gone, listed("1-r1"))
    expect(pruned.canvases.has(TK("9-x"))).toBe(false)
    expect(pruned.active).toEqual(R1)
    expect(prune(gone).active).toEqual(NOTHING)
  })

  test("storing drops the view of a card no longer on the canvas", () => {
    const T = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
    let l = at(initialLayout())
    for (const change of [
      { kind: "fold", card: threadIdFor("taken"), unfolded: true },
      { kind: "density", card: C, density: "raw" },
      { kind: "opened", card: T },
    ] as const)
      l = layoutReducer(l, view("1-r1", change))
    const stored = storedLayout(l, CANVASES.cardsOn).canvases.get(TK("1-r1"))
    expect([...(stored?.cards.keys() ?? [])]).toEqual([TRUNK, C])
    // A canvas not arrived yet keeps every view.
    expect(storedLayout(l, new Map())).toBe(l)
  })

  test("once chosen, what you are on stays when a canvas appears", () => {
    const grown = tree({ ...parents, "9-r3": null })
    for (const here of [R1, NOTHING]) {
      const settled = prune(at(initialLayout(), here), listed("1-r1"))
      expect(settled.active).toEqual(here)
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

describe("sidebarList", () => {
  test("the sidebar as drawn", () => {
    const l = drawn(at(initialLayout()), listed("5-r2", "1-r1"))
    expect(sidebarList(l)).toEqual([R2, R1])
    expect(sidebarList(initialLayout())).toEqual([])
  })
})

test("unlisted: the canvases not in the sidebar, and not archived", () => {
  const open = { open: [TK("1-r1")] }
  expect(
    unlisted(open, new Set([TK("7-r3")]), [TK("1-r1"), TK("5-r2"), TK("7-r3")]),
  ).toEqual([TK("5-r2")])
})

describe("planOpen", () => {
  const l = at(initialLayout())
  test("a thread that carried on past a branch's older context entry shows its own continuation", () => {
    // Under 3-b, branch X's first run wrote its canvas entry, then its
    // prompt; then the trunk's next run wrote its own canvas entry and
    // prompt. Neither canvas entry is a message a column draws.
    const X = threadIdFor("x")
    const canvasEntry = (id: string, parent: string, thread: ThreadId) =>
      entry(
        id,
        parent,
        {
          role: "canvas",
          content: "",
          canvas: { canvas: canvasIdFor("c"), title: "c", lines: [], more: 0 },
        },
        { thread },
      )
    const said = (id: string, parent: string, thread: ThreadId) =>
      entry(id, parent, personMessage(id), { thread })
    const grown = indexTree({
      ...index.entries,
      ...entriesById([
        canvasEntry("7-cx", "3-b", X),
        said("8-x", "7-cx", X),
        canvasEntry("9-cq", "3-b", TRUNK),
        said("9-n", "9-cq", TRUNK),
      ]),
    })
    const canvases = canvasesIn(grown)
    expect(planOpen(l, grown, entryId("9-n"), canvases, [], new Map())).toEqual(
      {
        kind: "scroll",
        canvas: TK("1-r1"),
        key: TRUNK,
      },
    )
    const [trunk] = drawnColumns(l, TK("1-r1"), {
      cardsOn: canvases.cardsOn,
      unstarted: new Map(),
      inventoryHolders: new Map(),
      index: grown,
      lanes: [],
    })
    expect(trunk?.kind === "thread" && trunk.column.anchor).toBe("9-n")
  })
  test("scrolls to a message an unfolded column already shows", () => {
    // The canvas's first column follows its thread, through 2-a to 3-b.
    expect(planOpen(l, index, entryId("2-a"), CANVASES, [], new Map())).toEqual(
      {
        kind: "scroll",
        canvas: TK("1-r1"),
        key: TRUNK,
      },
    )
    expect(planOpen(l, index, entryId("6-d"), CANVASES, [], new Map())).toEqual(
      {
        kind: "scroll",
        canvas: TK("5-r2"),
        key: threadOfEntry("5-r2"),
      },
    )
  })
  test("unfolds the column of a message's thread when no unfolded column shows it", () => {
    // 4-c is a branch at 2-a: another thread, its column folded.
    expect(planOpen(l, index, entryId("4-c"), CANVASES, [], new Map())).toEqual(
      {
        kind: "unfold",
        canvas: TK("1-r1"),
        card: C,
      },
    )
    // The trunk folded, the branch's column shows the shared 2-a.
    const folded = layoutReducer(
      layoutReducer(l, unfold(C)),
      view("1-r1", { kind: "fold", card: TRUNK, unfolded: false }),
    )
    expect(
      planOpen(folded, index, entryId("2-a"), CANVASES, [], new Map()),
    ).toEqual({
      kind: "scroll",
      canvas: TK("1-r1"),
      key: C,
    })
    expect(
      planOpen(folded, index, entryId("3-b"), CANVASES, [], new Map()),
    ).toEqual({
      kind: "unfold",
      canvas: TK("1-r1"),
      card: TRUNK,
    })
  })
  test("an entry the index lacks, or one whose thread is in no canvas, has no plan", () => {
    expect(
      planOpen(l, index, entryId("nope"), CANVASES, [], new Map()),
    ).toBeNull()
    expect(
      planOpen(
        l,
        index,
        entryId("4-c"),
        { canvasOfThread: new Map(), cardsOn: new Map() },
        [],
        new Map(),
      ),
    ).toBeNull()
  })
})

describe("encodeLayout / decodeLayout", () => {
  const trip = (l: Layout) =>
    decodeLayout(JSON.parse(JSON.stringify(encodeLayout(l))))
  const F = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
  const VIEW: YourCanvasView = {
    cards: new Map([
      [TRUNK, { unfolded: true, density: "outline" }],
      [C, { density: "raw" }],
      [
        F,
        {
          unfolded: true,
          prefill: { text: "@agent ", blank: true },
        },
      ],
    ]),
    canvas: { unfolded: true },
  }

  test("a round trip keeps what you are on, each canvas's view and the board; never the sidebar, which is your document's", () => {
    const l: Layout = {
      active: R1,
      open: [],
      board: true,
      canvases: new Map([[TK("1-r1"), VIEW]]),
    }
    expect(trip(l)).toEqual(l)
    expect(trip({ ...l, open: [TK("1-r1")] })?.open).toEqual([])
    expect(trip(initialLayout())).toEqual(initialLayout())
  })

  test("a view stored with an older key, its details open, loads as the view without it", () => {
    const stored = JSON.parse(
      JSON.stringify(
        encodeLayout({
          ...initialLayout(),
          canvases: new Map([[TK("1-r1"), VIEW]]),
        }),
      ),
    )
    stored.canvases[TK("1-r1")].cards[C] = { density: "raw", details: true }
    expect(
      decodeLayout(stored)?.canvases.get(TK("1-r1"))?.cards.get(C),
    ).toEqual({ density: "raw" })
  })

  test("a message waiting to be sent is never stored, nor restored: it would be sent again", () => {
    const stored = encodeLayout({
      ...initialLayout(),
      canvases: new Map([
        [
          TK("1-r1"),
          {
            ...defaultView(null),
            cards: new Map([
              [F, { unfolded: true, pending: { text: "hello" } }],
            ]),
          },
        ],
      ]),
    })
    expect(JSON.stringify(stored)).not.toContain("hello")
    const raw = {
      ...stored,
      canvases: {
        [TK("1-r1")]: {
          cards: { [F]: { unfolded: true, pending: "hello" } },
          canvas: { unfolded: false },
        },
      },
    }
    expect(decodeLayout(raw)?.canvases.get(TK("1-r1"))?.cards.get(F)).toEqual({
      unfolded: true,
    })
  })

  test("a layout that is another version, or partly malformed, restores nothing", () => {
    const good = encodeLayout({
      ...initialLayout(),
      canvases: new Map([[TK("1-r1"), VIEW]]),
    })
    const goodView = good.canvases[TK("1-r1")]
    expect(decodeLayout(good)).toBeDefined()
    for (const raw of [
      { v: 1, columns: [] },
      { v: 6, active: null, roots: {}, newTabs: [], board: false },
      // v8 kept branches and new tabs of this tab's own.
      { ...good, v: 8 },
      // A view keyed by something that is no canvas.
      { ...good, canvases: { "1-r1": goodView } },
      // A card's view keyed by something that is no card.
      {
        ...good,
        canvases: {
          [TK("1-r1")]: { ...goodView, cards: { "not a card": {} } },
        },
      },
      // A view as a list: an order of this tab's.
      { ...good, canvases: { [TK("1-r1")]: [TRUNK, C] } },
      { ...good, active: { kind: "root", root: "1-r1" } },
      { ...good, active: { kind: "new", key: NEW_THREAD } },
      // The version before canvases, otherwise whole.
      { ...good, v: 9 },
      "layout",
      null,
    ])
      expect(decodeLayout(raw)).toBeUndefined()
  })
})
