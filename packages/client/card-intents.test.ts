import {
  atEntry,
  type CardPlace,
  type CardRecord,
  cardId,
  entryId,
  indexAsks,
  rootIdFor,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { afterKeep } from "./card-intents.ts"
import type { HistoryEntry } from "./card-moves.ts"
import { tree } from "./fixtures.ts"
import {
  type CardFacts,
  type Intent,
  type IntentState,
  planIntent,
} from "./intent.ts"
import {
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("ada@x.io")
const C1 = cardId("c-1")
const C2 = cardId("c-2")
const index = tree({ "1-r1": null, "2-a": "1-r1" })
const R1 = entryId("1-r1")
const A = entryId("2-a")
const inventory = { kind: "inventory", holder: ADA } as const
const drafting = {
  kind: "drafting",
  root: TEST_ROOT,
  at: atEntry(A),
  lane: null,
} as const
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
  action: { kind: "openFresh", key: "f-1", at: A, after: 0 },
})
const threadKey = onR1.roots.get(R1)?.[0]?.key ?? ""

const card = (id: typeof C1, place: CardPlace): CardRecord => ({
  id,
  owner: ADA,
  placer: ADA,
  place,
  command: null,
  unsent: null,
})
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  cards: [],
  lanes: [],
  me: ADA,
  slots: {},
  selected: 0,
  history: { undo: [], redo: [] },
  composers: new Map<string, CardPlace>([
    [threadKey, drafting],
    ["f-1", { kind: "fresh", column: "f-1" }],
  ]),
  ...over,
})
const state = (
  cards: Partial<CardFacts> = {},
  layout = withFresh,
): IntentState => ({
  layout,
  index,
  archive: new Map(),
  asks: indexAsks(index),
  cards: facts(cards),
})
const plan = (intent: Intent, s: IntentState) => planIntent(intent, s, "new-k")
const inColumn = (
  act: Extract<Intent, { kind: "column" }>["act"],
  key = "f-1",
): Intent => ({ kind: "column", position: 1, key, act })

describe("take (ADR-0048 step 4)", () => {
  test("into the selected slot when it is empty, else the first empty, recorded", () => {
    const s = state({ cards: [card(C1, drafting)], selected: 4 })
    const move = { card: C1, from: drafting, to: inventory }
    expect(plan({ kind: "take", card: C1 }, s)).toEqual([
      { kind: "showInventory", brief: true },
      {
        kind: "moveCard",
        move,
        how: {
          actedAt: { kind: "inventory" },
          history: {
            kind: "record",
            entry: { kind: "handoff", move, slot: 4, column: null },
          },
          slot: 4,
        },
      },
    ])
    const taken = plan(
      { kind: "take", card: C1 },
      state({ cards: [card(C1, drafting)], selected: 4, slots: { "4": C2 } }),
    )
    expect(taken[1]).toMatchObject({ how: { slot: 0 } })
  })

  test("from a fresh column, the column is kept whole for an undo", () => {
    const fresh = { kind: "fresh", column: "f-1" } as const
    const effects = plan(
      inColumn({ kind: "take", card: C1 }),
      state({ cards: [card(C1, fresh)] }),
    )
    expect(effects[1]).toMatchObject({
      how: {
        history: {
          entry: {
            column: {
              column: { key: "f-1" },
              tab: { kind: "root", root: R1, index: 1 },
            },
          },
        },
      },
    })
  })

  test("full: refused at once, in the inventory", () => {
    const slots = Object.fromEntries(
      Array.from({ length: 18 }, (_, n) => [String(n), cardId(`h-${n}`)]),
    )
    expect(
      plan(
        { kind: "take", card: C1 },
        state({ cards: [card(C1, drafting)], slots }),
      )[1],
    ).toEqual({
      kind: "refuse",
      refusal: {
        card: C1,
        actedAt: { kind: "inventory" },
        code: "full",
        by: null,
        fromQueue: false,
      },
    })
  })

  test("a copy of a message's text is a new card in your inventory, recorded as a creation", () => {
    expect(
      plan(inColumn({ kind: "takeCopy", card: C2, text: "hello" }), state())[1],
    ).toMatchObject({
      kind: "createCard",
      card: { id: C2, owner: ADA, place: inventory },
      text: "hello",
      how: {
        slot: 0,
        history: { entry: { move: { card: C2, from: null, to: inventory } } },
      },
    })
  })
})

describe("put", () => {
  test("to a column: below the line where its composer creates cards, said there", () => {
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    const move = { card: C1, from: inventory, to: drafting }
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "column", key: threadKey } },
        s,
      ),
    ).toEqual([
      {
        kind: "moveCard",
        move,
        how: {
          actedAt: { kind: "column", key: threadKey },
          history: {
            kind: "record",
            entry: { kind: "handoff", move, slot: 3, column: null },
          },
          slot: null,
        },
      },
    ])
  })

  test("to a slot: a swap within your inventory, or a take into it", () => {
    const s = state({
      cards: [card(C1, inventory), card(C2, drafting)],
      slots: { "3": C1 },
    })
    const swap: HistoryEntry = { kind: "swap", a: 3, b: 7, cards: [null, C1] }
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "inventory", slot: 7 } },
        s,
      ),
    ).toEqual([
      { kind: "swapSlots", a: 3, b: 7, step: { kind: "record", entry: swap } },
    ])
    expect(
      plan(
        { kind: "put", card: C2, target: { kind: "inventory", slot: 7 } },
        s,
      )[1],
    ).toMatchObject({ kind: "moveCard", how: { slot: 7 } })
  })

  test("a column no composer publishes, or where the card already is: nothing", () => {
    const s = state({ cards: [card(C1, drafting)] })
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "column", key: "gone" } },
        s,
      ),
    ).toEqual([])
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "column", key: threadKey } },
        s,
      ),
    ).toEqual([])
  })
})

describe("keep on close", () => {
  const fresh = { kind: "fresh", column: "f-1" } as const
  test("one take per card into successive slots, then the close", () => {
    const s = state({
      cards: [card(C1, fresh), card(C2, fresh)],
      slots: { "0": cardId("x") },
    })
    const [keep] = plan(inColumn({ kind: "keep", cards: [C1, C2] }), s)
    expect(keep).toMatchObject({
      kind: "keep",
      moves: [
        { move: { card: C1, to: inventory }, how: { slot: 1 } },
        { move: { card: C2, to: inventory }, how: { slot: 2 } },
      ],
      close: [
        {
          kind: "layout",
          action: { kind: "columns", action: { kind: "close", index: 1 } },
        },
      ],
    })
  })

  test("without room: refused, nothing sent, the column left open", () => {
    const slots = Object.fromEntries(
      Array.from({ length: 17 }, (_, n) => [String(n), cardId(`h-${n}`)]),
    )
    expect(
      plan(
        inColumn({ kind: "keep", cards: [C1, C2] }),
        state({ cards: [card(C1, fresh), card(C2, fresh)], slots }),
      ),
    ).toEqual([
      {
        kind: "refuse",
        refusal: {
          card: null,
          actedAt: { kind: "column", key: "f-1" },
          code: "no-room",
          need: 2,
          free: 1,
        },
      },
    ])
  })

  test("afterKeep closes only when every card was accepted", () => {
    const close = [{ kind: "reload" }] as const
    expect(afterKeep([{ kind: "accepted", rev: 1 }], close)).toBe(close)
    expect(
      afterKeep(
        [
          { kind: "accepted", rev: 1 },
          { kind: "refused", refusal: null },
        ],
        close,
      ),
    ).toEqual([])
  })
})

describe("undo and redo of moves (ADR-0052)", () => {
  const take: HistoryEntry = {
    kind: "handoff",
    move: { card: C1, from: { kind: "fresh", column: "f-1" }, to: inventory },
    slot: 2,
    column: {
      column: { key: "f-1", anchor: A, fresh: {} },
      tab: { kind: "root", root: R1, index: 1 },
    },
  }
  const undo: Intent = { kind: "undoMove", direction: "undo", restored: null }

  test("shows the place first, then moves, said there", () => {
    const effects = plan(
      undo,
      state(
        { cards: [card(C1, inventory)], history: { undo: [take], redo: [] } },
        onR1,
      ),
    )
    expect(effects).toEqual([
      { kind: "layout", action: { kind: "reopen", closed: take.column } },
      {
        kind: "moveCard",
        move: {
          card: C1,
          from: inventory,
          to: { kind: "fresh", column: "f-1" },
        },
        how: {
          actedAt: { kind: "column", key: "f-1" },
          history: { kind: "undo", entry: take },
          slot: null,
        },
      },
    ])
  })

  test("in an archived root: asks; restore-and-undo restores, then undoes afresh", () => {
    const archive = new Map([
      [R1, { root: R1, state: "archived", by: ADA, at: 0 } as const],
    ])
    const s = {
      ...state(
        { cards: [card(C1, inventory)], history: { undo: [take], redo: [] } },
        onR1,
      ),
      archive,
    }
    expect(plan(undo, s)).toEqual([
      { kind: "askRestore", root: R1, direction: "undo" },
    ])
    expect(
      plan({ kind: "restoreAndUndo", root: R1, direction: "undo" }, s),
    ).toEqual([
      {
        kind: "restoreThen",
        root: R1,
        next: { kind: "undoMove", direction: "undo", restored: R1 },
      },
    ])
    expect(
      plan({ kind: "undoMove", direction: "undo", restored: R1 }, s)[0],
    ).toEqual({
      kind: "layout",
      action: { kind: "reopen", closed: take.column },
    })
  })

  test("refused at once: shown, then dropped with why", () => {
    const effects = plan(
      undo,
      state({
        cards: [card(C1, drafting)],
        history: { undo: [take], redo: [] },
      }),
    )
    expect(effects.at(-1)).toMatchObject({
      kind: "dropEntry",
      entry: take,
      refusal: { code: "moved", actedAt: { kind: "column", key: "f-1" } },
    })
  })

  test("nothing to undo: nothing", () => {
    expect(plan(undo, state())).toEqual([])
  })
})
