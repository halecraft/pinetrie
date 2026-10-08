import {
  atEntry,
  type CardPlace,
  type CardRecord,
  cardId,
  entryId,
  indexAsks,
  laneNameForThread,
  rootIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { describe, expect, test } from "vitest"
import { afterKeep } from "./card-intents.ts"
import type { CardFacts, IntentState } from "./effects.ts"
import { NEW_ROOT, tree } from "./fixtures.ts"
import { type Intent, planIntent } from "./intent.ts"
import {
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import type { ComposerSpot } from "./put-target.ts"
import { afterSpinOff } from "./spin-off.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("ada@x.io")
const C1 = cardId("c-1")
const C2 = cardId("c-2")
const index = tree({ "1-r1": null, "2-a": "1-r1" })
const R1 = entryId("1-r1")
const A = entryId("2-a")
const inventory = { kind: "inventory", holder: ADA } as const
const atEnd = {
  kind: "composing",
  root: TEST_ROOT,
  at: atEntry(A),
  lane: null,
} as const
const note = { ...atEnd, kind: "note", cell: 0 } as const
/** A move's note target: the host gives it the first empty cell. */
const toNote = { ...note, cell: null } as const
const pinnedKey = {
  kind: "pinned",
  root: TEST_ROOT,
  at: atEntry(A),
  lane: null,
} as const
const pinnedAtA = { ...pinnedKey, order: "a" } as const
const freshF1 = {
  kind: "fresh",
  column: "f-1",
  root: TEST_ROOT,
  at: atEntry(A),
} as const
const onR1: Layout = resolveLayout(
  layoutReducer(initialLayout(), {
    kind: "show",
    here: { kind: "root", root: R1 },
  }),
  { index, lanes: [], archived: new Set(), list: [R1] },
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
  carries: { kind: "message", command: null },
  unsent: null,
})
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  cards: [],
  lanes: [],
  laneRecords: new Map(),
  me: ADA,
  filled: new Set(),
  slots: {},
  selected: 0,
  composers: new Map<string, ComposerSpot>([
    [threadKey, { place: atEnd, message: null, cells: new Map() }],
    ["f-1", { place: freshF1, message: null, cells: new Map() }],
  ]),
  ...over,
})
const state = (
  cards: Partial<CardFacts> = {},
  layout = withFresh,
): IntentState => ({
  layout,
  index,
  asks: indexAsks(index),
  cards: facts(cards),
  rootEntries: new Map([[TEST_ROOT, R1]]),
  rootIds: new Map([[R1, TEST_ROOT]]),
  listWidth: "full",
  page: null,
})
const plan = (intent: Intent, s: IntentState) =>
  planIntent(intent, s, "new-k", NEW_ROOT)
const inColumn = (
  act: Extract<Intent, { kind: "column" }>["act"],
  key = "f-1",
): Intent => ({ kind: "column", position: 1, key, act })

describe("take into the inventory (ADR-0048 step 4)", () => {
  test("into the selected slot when it is empty, else the first empty", () => {
    const s = state({ cards: [card(C1, atEnd)], selected: 4 })
    const move = { card: C1, from: atEnd, to: inventory }
    expect(plan({ kind: "takeIntoInventory", card: C1 }, s)).toEqual([
      { kind: "showInventory", brief: true },
      {
        kind: "moveCard",
        move,
        how: { actedAt: { kind: "inventory" }, slot: 4 },
        queuedBy: null,
        fly: true,
      },
    ])
    const intoInventory = plan(
      { kind: "takeIntoInventory", card: C1 },
      state({ cards: [card(C1, atEnd)], selected: 4, slots: { "4": C2 } }),
    )
    expect(intoInventory[1]).toMatchObject({ how: { slot: 0 } })
  })

  test("full: refused at once, in the inventory", () => {
    const slots = Object.fromEntries(
      Array.from({ length: 18 }, (_, n) => [String(n), cardId(`h-${n}`)]),
    )
    expect(
      plan(
        { kind: "takeIntoInventory", card: C1 },
        state({ cards: [card(C1, atEnd)], slots }),
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

  test("a copy of a message's text is a new card in your inventory", () => {
    expect(
      plan(
        inColumn({ kind: "takeCopyIntoInventory", card: C2, text: "hello" }),
        state(),
      )[1],
    ).toEqual({
      kind: "createCard",
      card: {
        id: C2,
        owner: ADA,
        placer: ADA,
        place: inventory,
        carries: { kind: "message", command: null },
        unsent: null,
      },
      text: "hello",
      how: { actedAt: { kind: "inventory" }, slot: 0 },
    })
  })
})

describe("put", () => {
  test("to a column: a note at its end, said there (ADR-0113)", () => {
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    const move = { card: C1, from: inventory, to: toNote }
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "column", key: threadKey } },
        s,
      ),
    ).toEqual([
      {
        kind: "moveCard",
        move,
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
      },
    ])
  })

  test("to a slot: a swap within your inventory, or a take into the inventory there", () => {
    const s = state({
      cards: [card(C1, inventory), card(C2, atEnd)],
      slots: { "3": C1 },
    })
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "inventory", slot: 7 } },
        s,
      ),
    ).toEqual([{ kind: "swapSlots", a: 3, b: 7 }])
    expect(
      plan(
        { kind: "put", card: C2, target: { kind: "inventory", slot: 7 } },
        s,
      )[1],
    ).toMatchObject({ kind: "moveCard", how: { slot: 7 } })
  })

  test("a column no composer publishes, or where the card already is: nothing", () => {
    const s = state({ cards: [card(C1, note)] })
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

describe("your message (ADR-0113)", () => {
  const MSG = cardId("c-9")
  const withMessage = (
    filled: boolean,
    cards: readonly CardRecord[],
    key = threadKey,
    place: CardPlace = atEnd,
  ) =>
    state({
      cards: [...cards, card(MSG, place)],
      filled: new Set(filled ? [MSG] : []),
      slots: { "3": C1 },
      composers: new Map<string, ComposerSpot>([
        [key, { place, message: MSG, cells: new Map() }],
      ]),
    })
  const toComposer = (key = threadKey): Intent => ({
    kind: "put",
    card: C1,
    target: { kind: "composer", key },
  })

  test("a drop on the composer with no message there makes the card your message", () => {
    const s = state({ cards: [card(C1, note)] })
    expect(plan(toComposer(), s)).toEqual([
      {
        kind: "moveCard",
        move: { card: C1, from: note, to: atEnd },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
      },
    ])
  })

  test("a message with text takes the note's place, in one move of the two: one undo", () => {
    expect(plan(toComposer(), withMessage(true, [card(C1, note)]))).toEqual([
      {
        kind: "keep",
        moves: [
          { move: { card: C1, from: note, to: atEnd }, slot: null },
          { move: { card: MSG, from: atEnd, to: note }, slot: null },
        ],
        actedAt: { kind: "column", key: threadKey },
        close: [],
      },
    ])
  })

  test("a message with text goes to the slot a card from your inventory leaves", () => {
    const [keep] = plan(toComposer(), withMessage(true, [card(C1, inventory)]))
    expect(keep).toMatchObject({
      kind: "keep",
      moves: [
        { move: { card: C1, to: atEnd }, slot: null },
        { move: { card: MSG, to: inventory }, slot: 3 },
      ],
    })
  })

  test("an empty message is discarded as the card takes its place", () => {
    const [keep] = plan(toComposer(), withMessage(false, [card(C1, note)]))
    expect(keep).toMatchObject({
      kind: "keep",
      moves: [
        { move: { card: C1, to: atEnd } },
        { move: { card: MSG, to: { kind: "gone" } } },
      ],
    })
  })

  test("in a fresh column, a message with text refuses a card from anywhere but your inventory", () => {
    const s = withMessage(true, [card(C1, note)], "f-1", freshF1)
    expect(plan(toComposer("f-1"), s)).toEqual([
      {
        kind: "refuse",
        refusal: {
          card: C1,
          actedAt: { kind: "column", key: "f-1" },
          code: "message-holds-text",
        },
      },
    ])
    const fromInventory = withMessage(
      true,
      [card(C1, inventory)],
      "f-1",
      freshF1,
    )
    expect(plan(toComposer("f-1"), fromInventory)[0]).toMatchObject({
      kind: "keep",
    })
  })

  test("Move to ▸ notes: your message becomes a note at its end", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(plan(inColumn({ kind: "toNote", card: C1 }, threadKey), s)).toEqual([
      {
        kind: "moveCard",
        move: { card: C1, from: atEnd, to: toNote },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
      },
    ])
  })
})

describe("a notes board's cells (ADR-0113)", () => {
  const C3 = cardId("c-3")
  const inCell = (cell: number) => ({ ...note, cell })
  const board = (cards: readonly CardRecord[], cells: [number, typeof C1][]) =>
    state({
      cards,
      slots: { "3": C1 },
      composers: new Map<string, ComposerSpot>([
        [threadKey, { place: atEnd, message: null, cells: new Map(cells) }],
      ]),
    })
  const toCell = (card: typeof C1, cell: number): Intent => ({
    kind: "put",
    card,
    target: { kind: "cell", key: threadKey, cell },
  })

  test("an empty cell takes the card", () => {
    expect(
      plan(toCell(C1, 4), board([card(C1, inCell(0))], [[0, C1]]))[0],
    ).toMatchObject({
      kind: "moveCard",
      move: { card: C1, from: inCell(0), to: inCell(4) },
    })
  })

  test("a note on a note swaps the two, in one move of the two", () => {
    const s = board(
      [card(C1, inCell(0)), card(C3, inCell(4))],
      [
        [0, C1],
        [4, C3],
      ],
    )
    expect(plan(toCell(C1, 4), s)).toEqual([
      {
        kind: "keep",
        moves: [
          { move: { card: C1, from: inCell(0), to: inCell(4) }, slot: null },
          { move: { card: C3, from: inCell(4), to: inCell(0) }, slot: null },
        ],
        actedAt: { kind: "column", key: threadKey },
        close: [],
      },
    ])
  })

  test("a card from your inventory on a note: the note takes its slot", () => {
    const s = board([card(C1, inventory), card(C3, inCell(4))], [[4, C3]])
    expect(plan(toCell(C1, 4), s)[0]).toMatchObject({
      kind: "keep",
      moves: [
        { move: { card: C1, to: inCell(4) } },
        { move: { card: C3, to: inventory }, slot: 3 },
      ],
    })
  })

  test("a pinned card on a note takes the first empty cell instead", () => {
    const s = board([card(C1, pinnedAtA), card(C3, inCell(4))], [[4, C3]])
    expect(plan(toCell(C1, 4), s)[0]).toMatchObject({
      kind: "moveCard",
      move: { card: C1, to: toNote },
    })
  })
})

describe("pin and unpin (ADR-0048 step 5)", () => {
  test("pin: your message to the top of the same thread's column, a move said in the column", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(plan(inColumn({ kind: "pin", card: C1 }, threadKey), s)).toEqual([
      {
        kind: "moveCard",
        move: { card: C1, from: atEnd, to: pinnedKey },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
      },
    ])
  })

  test("unpin: a note where it was pinned", () => {
    const s = state({ cards: [card(C1, pinnedAtA)] })
    expect(
      plan(inColumn({ kind: "unpin", card: C1 }, threadKey), s)[0],
    ).toMatchObject({
      kind: "moveCard",
      move: { card: C1, from: pinnedKey, to: toNote },
    })
  })

  test("a fresh card has no thread to pin to; an unpin of a card not pinned is nothing", () => {
    const s = state({ cards: [card(C1, freshF1), card(C2, atEnd)] })
    expect(plan(inColumn({ kind: "pin", card: C1 }), s)).toEqual([])
    expect(plan(inColumn({ kind: "unpin", card: C2 }, threadKey), s)).toEqual(
      [],
    )
  })

  test("a drop on a column's pinned strip pins", () => {
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "pinned", key: threadKey } },
        s,
      )[0],
    ).toMatchObject({
      kind: "moveCard",
      move: { card: C1, from: inventory, to: pinnedKey },
    })
  })
})

describe("keep on close (ADR-0066)", () => {
  test("one move of every card into successive slots, then the close", () => {
    const s = state({
      cards: [card(C1, freshF1), card(C2, freshF1)],
      slots: { "0": cardId("x") },
    })
    const [keep] = plan(inColumn({ kind: "keep", cards: [C1, C2] }), s)
    expect(keep).toMatchObject({
      kind: "keep",
      moves: [
        { move: { card: C1, from: freshF1, to: inventory }, slot: 1 },
        { move: { card: C2, from: freshF1, to: inventory }, slot: 2 },
      ],
      actedAt: { kind: "column", key: "f-1" },
      close: [
        {
          kind: "layout",
          action: { kind: "columns", action: { kind: "close", index: 1 } },
        },
      ],
    })
  })

  test("a keep whose cards have all gone closes its column and sends no move", () => {
    const s = state({ cards: [], slots: {} })
    const effects = plan(inColumn({ kind: "keep", cards: [C1, C2] }), s)
    expect(effects).toHaveLength(1)
    expect(effects).toMatchObject([
      {
        kind: "layout",
        action: { kind: "columns", action: { kind: "close", index: 1 } },
      },
    ])
  })

  test("afterKeep closes only when the keep was accepted", () => {
    const close = [{ kind: "reload" }] as const
    expect(afterKeep({ kind: "accepted", rev: 1 }, close)).toBe(close)
    expect(afterKeep({ kind: "refused", refusal: null }, close)).toEqual([])
  })
})

describe("undo and redo of moves (ADR-0066)", () => {
  const undo: Intent = { kind: "undoMove", direction: "undo", inPanel: false }

  test("in a root's tab: that root's history, by its id", () => {
    expect(plan(undo, state({}, onR1))).toEqual([
      { kind: "undoMoves", root: TEST_ROOT, direction: "undo" },
    ])
  })

  test("in a new tab: the root it minted as it opened", () => {
    const newTab = layoutReducer(onR1, {
      kind: "newTab",
      key: "n",
      root: NEW_ROOT,
      asksAgent: false,
    })
    expect(
      plan({ ...undo, direction: "redo" } as Intent, state({}, newTab)),
    ).toEqual([{ kind: "undoMoves", root: NEW_ROOT, direction: "redo" }])
  })

  test("with the inventory panel focused: this tab's swaps", () => {
    expect(plan({ ...undo, inPanel: true } as Intent, state())).toEqual([
      { kind: "undoSwap", direction: "undo" },
    ])
  })

  test("on nothing, or a root the directory does not name: nothing", () => {
    const nothing = layoutReducer(onR1, {
      kind: "show",
      here: { kind: "nothing" },
    })
    expect(plan(undo, state({}, nothing))).toEqual([])
    expect(plan(undo, { ...state({}, onR1), rootIds: new Map() })).toEqual([])
  })
})

describe("afterUndo: what an undo's answer brings into view (ADR-0052)", () => {
  const answered = (outcome: Outcome, s: IntentState = state({}, onR1)) =>
    plan({ kind: "undoAnswered", outcome }, s)

  test("a card back at a thread's end: shown as openAt shows it", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: atEnd }] }),
    ).toContainEqual({ kind: "reveal", entry: A })
  })

  test("an undone pin: shown at its thread's end, as a note is", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: pinnedKey }] }),
    ).toContainEqual({ kind: "reveal", entry: A })
  })

  test("a discarded queued card back in its queue: its thread shown, and the card scrolled to in the dock (ADR-0113)", () => {
    const effects = answered({
      kind: "undone",
      cards: [
        {
          card: C1,
          place: {
            kind: "queued",
            root: TEST_ROOT,
            at: atEntry(A),
            lane: laneNameForThread("x"),
            seen: "",
          },
        },
      ],
    })
    expect(effects).toContainEqual({ kind: "reveal", entry: A })
    expect(effects.at(-1)).toEqual({ kind: "revealCard", card: C1 })
  })

  test("back in your inventory: the panel", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: inventory }] }),
    ).toEqual([{ kind: "showInventory", brief: false }])
  })

  test("back in a fresh column the layout holds: its root shown, once for a keep's cards", () => {
    expect(
      answered(
        {
          kind: "undone",
          cards: [
            { card: C1, place: freshF1 },
            { card: C2, place: freshF1 },
          ],
        },
        state({}, withFresh),
      ),
    ).toEqual([
      {
        kind: "layout",
        action: { kind: "show", here: { kind: "root", root: R1 } },
      },
      { kind: "list", act: { kind: "ensure", root: TEST_ROOT } },
    ])
  })

  test("back in a fresh column it no longer holds: opened again at the end of its root's columns", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: freshF1 }] }),
    ).toEqual([
      {
        kind: "layout",
        action: { kind: "show", here: { kind: "root", root: R1 } },
      },
      { kind: "list", act: { kind: "ensure", root: TEST_ROOT } },
      {
        kind: "layout",
        action: {
          kind: "columns",
          root: R1,
          action: { kind: "openFresh", key: "f-1", at: A, after: 0 },
        },
      },
    ])
  })

  test("refused: the card shown where it is now, and who moved it said there", () => {
    const effects = answered(
      {
        kind: "unmoved",
        code: "moved",
        place: freshF1,
        by: writerId("bea@x.io"),
      },
      state({}, withFresh),
    )
    expect(effects.at(-1)).toEqual({
      kind: "refuse",
      refusal: {
        card: null,
        actedAt: { kind: "column", key: "f-1" },
        code: "moved",
        by: writerId("bea@x.io"),
        fromQueue: false,
      },
    })
  })

  test("nothing to undo: nothing", () => {
    expect(answered({ kind: "nothing" })).toEqual([])
  })
})

describe("openTrace: where a trace leads (ADR-0048, Other people)", () => {
  const BEA = writerId("bea@x.io")
  const trace = (message: ReturnType<typeof entryId> | null) =>
    ({
      id: "t-1",
      for: ADA,
      card: C1,
      by: BEA,
      from: atEnd,
      to: null,
      message,
      at: 1,
    }) as const
  const follow = (s: IntentState, message: ReturnType<typeof entryId> | null) =>
    plan({ kind: "openTrace", trace: trace(message) }, s)

  test("a card still here: shown where it is now, as an undo shows it", () => {
    expect(
      follow(
        state({ cards: [card(C1, { ...pinnedKey, order: "1" })] }, onR1),
        null,
      ),
    ).toContainEqual({ kind: "reveal", entry: A })
  })

  test("a card sent: the message it became", () => {
    expect(follow(state({}, onR1), A)).toContainEqual({
      kind: "reveal",
      entry: A,
    })
  })

  test("a card in someone else's inventory, or gone some other way: nothing", () => {
    const theirs = { kind: "inventory", holder: BEA } as const
    expect(follow(state({ cards: [card(C1, theirs)] }, onR1), null)).toEqual([])
    expect(follow(state({}, onR1), null)).toEqual([])
  })
})

describe("a card made a thread (ADR-0111)", () => {
  const S1 = workflowStateIdFor("s-1")
  const spun = (root: typeof TEST_ROOT | null) => ({
    kind: "gone",
    root,
    why: { kind: "spun", thread: NEW_ROOT },
  })
  test.each([
    [
      "a note dropped on a state: its thread there, the move in the note's root",
      card(C1, note),
      { kind: "state", state: S1 },
      { from: note, history: TEST_ROOT, state: S1, sidebar: null },
    ],
    [
      "an inventory card dropped in the sidebar: the move in the new root, placed before the root it was dropped on",
      card(C1, { kind: "inventory", holder: ADA }),
      { kind: "sidebar", before: R1 },
      {
        from: inventory,
        history: NEW_ROOT,
        state: null,
        sidebar: { before: TEST_ROOT },
      },
    ],
    [
      "an inventory card dropped on a state: the move in the root you are on",
      card(C1, { kind: "inventory", holder: ADA }),
      { kind: "state", state: S1 },
      { from: inventory, history: TEST_ROOT, state: S1, sidebar: null },
    ],
  ] as const)("%s", (_, c, target, want) => {
    expect(
      plan({ kind: "put", card: C1, target }, state({ cards: [c] })),
    ).toEqual([
      {
        kind: "spinOff",
        request: {
          kind: "spin-off",
          move: { card: C1, from: want.from, to: spun(want.history) },
          state: want.state,
        },
        thread: NEW_ROOT,
        sidebar: want.sidebar,
      },
    ])
  })

  test("a note's ⋯ Move to a new thread in a state is the same as its drop there", () => {
    const s = state({ cards: [card(C1, note)] })
    expect(
      plan(inColumn({ kind: "spinOff", card: C1, state: S1 }, threadKey), s),
    ).toEqual(
      plan({ kind: "put", card: C1, target: { kind: "state", state: S1 } }, s),
    )
  })

  test("nothing for someone else's inventory card", () => {
    const theirs = card(C1, { kind: "inventory", holder: writerId("bea@x.io") })
    expect(
      plan(
        { kind: "put", card: C1, target: { kind: "state", state: S1 } },
        state({ cards: [theirs] }),
      ),
    ).toEqual([])
  })

  test("afterSpinOff: a sidebar drop places and shows the new root once its first message is written; nothing else", () => {
    const sidebar = { before: TEST_ROOT }
    expect(
      afterSpinOff({ kind: "appended", id: entryId("t-1") }, NEW_ROOT, sidebar),
    ).toEqual([
      {
        kind: "list",
        act: { kind: "place", root: NEW_ROOT, before: TEST_ROOT },
      },
      {
        kind: "layout",
        action: { kind: "show", here: { kind: "root", root: entryId("t-1") } },
      },
    ])
    expect(
      afterSpinOff({ kind: "appended", id: entryId("t-1") }, NEW_ROOT, null),
    ).toEqual([])
    expect(
      afterSpinOff(
        { kind: "refused", code: "refused", message: "no" },
        NEW_ROOT,
        sidebar,
      ),
    ).toEqual([])
  })
})

describe("a new note on the notes board (ADR-0113)", () => {
  test("Enter or + on an empty cell makes an empty note in that cell, at the column's thread end; a fresh column has no board", () => {
    const s = state()
    expect(
      plan(inColumn({ kind: "newNote", card: C1, cell: 5 }, threadKey), s),
    ).toEqual([
      {
        kind: "createCard",
        card: {
          id: C1,
          owner: ADA,
          placer: ADA,
          place: { ...atEnd, kind: "note", cell: 5 },
          carries: { kind: "message", command: null },
          unsent: null,
        },
        text: "",
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
      },
    ])
    expect(plan(inColumn({ kind: "newNote", card: C1, cell: 5 }), s)).toEqual(
      [],
    )
  })
})
