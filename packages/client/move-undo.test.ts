import {
  type ArchiveRecord,
  atEntry,
  type CardPlace,
  type CardRecord,
  cardId,
  type EntryId,
  entryId,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import type { HistoryEntry, MoveHistory } from "./card-moves.ts"
import { tree } from "./fixtures.ts"
import {
  type ClosedColumn,
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import { planUndo, type UndoState } from "./move-undo.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const C1 = cardId("c-1")
// r1 -> a -> b; and r2.
const index = tree({ "1-r1": null, "2-a": "1-r1", "3-b": "2-a", "5-r2": null })
const R1 = entryId("1-r1")
const B = entryId("3-b")
const inventory = { kind: "inventory", holder: ADA } as const
const drafting = { kind: "drafting", at: atEntry(B), lane: null } as const

const onR1: Layout = resolveLayout(
  layoutReducer(initialLayout(), {
    kind: "show",
    tab: { kind: "root", root: R1 },
  }),
  { index, lanes: [], archive: new Map() },
)
const withFresh: Layout = layoutReducer(onR1, {
  kind: "columns",
  root: R1,
  action: { kind: "openFresh", key: "f-1", at: B, after: 0 },
})
const closed: ClosedColumn = {
  column: { key: "f-1", anchor: B, fresh: {} },
  tab: { kind: "root", root: R1, index: 1 },
}
const card = (
  place: CardPlace,
  over: Partial<CardRecord> = {},
): CardRecord => ({
  id: C1,
  owner: ADA,
  placer: ADA,
  place,
  command: null,
  unsent: null,
  ...over,
})
const state = (over: Partial<UndoState> = {}): UndoState => ({
  cards: [],
  slots: {},
  layout: onR1,
  index,
  lanes: [],
  archive: new Map(),
  me: ADA,
  ...over,
})
const undoOf = (entry: HistoryEntry): MoveHistory => ({
  undo: [entry],
  redo: [],
})
const redoOf = (entry: HistoryEntry): MoveHistory => ({
  undo: [],
  redo: [entry],
})

describe("planUndo (ADR-0052, ADR-0059)", () => {
  test("an empty history plans nothing", () => {
    expect(planUndo("undo", { undo: [], redo: [] }, state())).toEqual({
      kind: "none",
    })
  })

  test("a take reverses to its source, shown at the thread's end", () => {
    const take: HistoryEntry = {
      kind: "handoff",
      move: { card: C1, from: drafting, to: inventory },
      slot: 4,
      column: null,
    }
    expect(
      planUndo("undo", undoOf(take), state({ cards: [card(inventory)] })),
    ).toEqual({
      kind: "handoff",
      show: { kind: "entry", entry: B },
      move: { card: C1, from: inventory, to: drafting },
      slot: null,
      step: { kind: "undo", entry: take },
    })
  })

  test("a put reverses into the inventory, asking for its old slot, or the first empty", () => {
    const put: HistoryEntry = {
      kind: "handoff",
      move: { card: C1, from: inventory, to: drafting },
      slot: 4,
      column: null,
    }
    const cards = [card(drafting)]
    expect(planUndo("undo", undoOf(put), state({ cards }))).toMatchObject({
      kind: "handoff",
      show: { kind: "inventory" },
      move: { card: C1, from: drafting, to: inventory },
      slot: 4,
    })
    expect(
      planUndo(
        "undo",
        undoOf(put),
        state({ cards, slots: { "4": cardId("c-x") } }),
      ),
    ).toMatchObject({ slot: 0 })
    expect(
      planUndo("redo", redoOf(put), state({ cards: [card(inventory)] })),
    ).toMatchObject({
      kind: "handoff",
      show: { kind: "entry", entry: B },
      move: put.move,
      step: { kind: "redo", entry: put },
    })
  })

  test("a creation reverses to a removal, undone for good, with no redo", () => {
    const copy: HistoryEntry = {
      kind: "handoff",
      move: { card: C1, from: null, to: inventory },
      slot: 2,
      column: null,
    }
    expect(
      planUndo("undo", undoOf(copy), state({ cards: [card(inventory)] })),
    ).toEqual({
      kind: "handoff",
      show: { kind: "inventory" },
      move: { card: C1, from: inventory, to: null },
      slot: null,
      step: { kind: "forget", entry: copy },
    })
    expect(planUndo("redo", redoOf(copy), state())).toEqual({ kind: "none" })
  })

  test("a card moved since, or gone, is refused at once, saying who moved it", () => {
    const take: HistoryEntry = {
      kind: "handoff",
      move: { card: C1, from: drafting, to: inventory },
      slot: 0,
      column: null,
    }
    const queued = card(
      {
        kind: "queued",
        at: atEntry(B),
        lane: laneNameForThread("x"),
        order: "a",
        by: BEA,
        seen: "",
      },
      { placer: BEA },
    )
    expect(
      planUndo("undo", undoOf(take), state({ cards: [queued] })),
    ).toMatchObject({
      kind: "refused",
      entry: take,
      why: { card: C1, code: "moved", by: BEA },
    })
    expect(planUndo("undo", undoOf(take), state())).toMatchObject({
      kind: "refused",
      why: { code: "gone" },
    })
  })

  describe("a fresh column", () => {
    const take: HistoryEntry = {
      kind: "handoff",
      move: { card: C1, from: { kind: "fresh", column: "f-1" }, to: inventory },
      slot: 0,
      column: closed,
    }
    const cards = [card(inventory)]

    test("still open: shown as it is", () => {
      expect(
        planUndo("undo", undoOf(take), state({ cards, layout: withFresh })),
      ).toMatchObject({ kind: "handoff", show: { kind: "column", key: "f-1" } })
    })

    test("closed since: reopened", () => {
      expect(planUndo("undo", undoOf(take), state({ cards }))).toMatchObject({
        kind: "handoff",
        show: { kind: "reopen", closed },
        move: { to: { kind: "fresh", column: "f-1" } },
      })
    })

    test("in an archived root: asks first", () => {
      const archive = new Map<EntryId, ArchiveRecord>([
        [R1, { root: R1, state: "archived", by: BEA, at: 0 }],
      ])
      expect(
        planUndo("undo", undoOf(take), state({ cards, archive })),
      ).toMatchObject({
        kind: "ask",
        root: R1,
        plan: { kind: "handoff", show: { kind: "reopen", closed } },
      })
    })

    test("closed with nothing kept to reopen it: refused", () => {
      expect(
        planUndo("undo", undoOf({ ...take, column: null }), state({ cards })),
      ).toMatchObject({ kind: "refused", why: { code: "gone" } })
    })
  })

  test("a swap swaps back while both slots hold what it wrote, and is refused when one changed", () => {
    const A = cardId("c-a")
    const swap: HistoryEntry = { kind: "swap", a: 0, b: 5, cards: [A, null] }
    expect(
      planUndo("undo", undoOf(swap), state({ slots: { "0": A } })),
    ).toEqual({
      kind: "swap",
      a: 0,
      b: 5,
      step: { kind: "undo", entry: swap },
    })
    expect(
      planUndo("undo", undoOf(swap), state({ slots: { "0": A, "5": C1 } })),
    ).toEqual({
      kind: "refused",
      entry: swap,
      show: { kind: "inventory" },
      why: { card: null, code: "slots-changed" },
    })
    expect(
      planUndo("redo", redoOf(swap), state({ slots: { "5": A } })),
    ).toMatchObject({
      kind: "swap",
      step: { kind: "redo" },
    })
  })
})

describe("layout reopen", () => {
  test("a root's column goes back at its index, its tab shown; the key kept; nothing when it is there", () => {
    const three = layoutReducer(withFresh, {
      kind: "columns",
      root: R1,
      action: { kind: "openFresh", key: "f-2", at: B, after: 1 },
    })
    const shut = layoutReducer(
      { ...three, active: { kind: "archive" }, open: [] },
      { kind: "columns", root: R1, action: { kind: "close", index: 1 } },
    )
    const back = layoutReducer(shut, { kind: "reopen", closed })
    expect(back.active).toEqual({ kind: "root", root: R1 })
    expect(back.open).toEqual([R1])
    expect(back.roots.get(R1)?.map(c => c.key)).toEqual(
      three.roots.get(R1)?.map(c => c.key),
    )
    expect(layoutReducer(back, { kind: "reopen", closed })).toBe(back)
  })

  test("past the end it goes last; a new tab comes back as a new tab", () => {
    const far = {
      ...closed,
      tab: { kind: "root", root: R1, index: 9 },
    } as const
    expect(
      layoutReducer(onR1, { kind: "reopen", closed: far }).roots.get(R1)?.at(-1)
        ?.key,
    ).toBe("f-1")
    const tab = layoutReducer(onR1, {
      kind: "reopen",
      closed: {
        column: { key: "t-1", anchor: null, fresh: {} },
        tab: { kind: "new" },
      },
    })
    expect(tab.active).toEqual({ kind: "new", key: "t-1" })
    expect(tab.newTabs.map(c => c.key)).toEqual(["t-1"])
  })
})
