import {
  type CardId,
  type CardPlace,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  entryMargin,
  fitsPlace,
  INVENTORY_SLOTS,
  indexAsks,
  KINDS,
  livePlace,
  makeCard,
  type PlacedKind,
  rootIdFor,
  type Sha256,
  type TextCard,
  type TextPlace,
  TRASH_PLACE,
  textCardId,
  threadIdFor,
  UNTICKED,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { Outcome } from "@pinetrie/protocol/codec"
import { addressLink } from "@pinetrie/rules"
import { LAST_ORDER } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { afterKeep, type Landing, planPut, putLanding } from "./card-intents.ts"
import type { Clip } from "./clip.ts"
import { type ColumnKey, keyText } from "./columns.ts"
import type { CardFacts, Effect, IntentState } from "./effects.ts"
import {
  canvasesFor,
  NEW_CANVAS,
  NEW_MEDIA,
  NEW_NOTE_COLUMN,
  NEW_ROOT,
  NEW_TEXT,
  NEW_THREAD,
  NO_CLIPS,
  newImage,
  TEST_CANVAS,
  threadOfEntry,
  tree,
} from "./fixtures.ts"
import { type Intent, planIntent } from "./intent.ts"
import {
  initialLayout,
  type Layout,
  layoutReducer,
  resolveLayout,
} from "./layout.ts"
import type { ComposerSpot, PutTarget } from "./put-target.ts"
import { afterSpinOff } from "./spin-off.ts"

/** The thread `index` is: its first entry names it (`withThreads`). */
const TEST_THREAD = threadIdFor("1-r1")
const R1_CANVAS_FOR_DROP = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000d1")
const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("ada@x.io")
const C1 = cardIdFor("c1")
const C2 = cardIdFor("c2")
const index = tree({ "1-r1": null, "2-a": "1-r1" })
const R1 = entryId("1-r1")
const A = entryId("2-a")
const inventory = { kind: "inventory", holder: ADA } as const
const atEnd = {
  kind: "composing",
  thread: TEST_THREAD,
} as const
/** The note column the fixtures' notes are in. */
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)
const note = { kind: "note", column: NOTES, order: "a" } as const
const noteKey = { kind: "note", column: NOTES } as const
/** A move's target at the thread's nearest notes, which the host resolves. */
const toNote = { kind: "notes", near: "thread", thread: TEST_THREAD } as const
const pinnedKey = {
  kind: "pinned",
  thread: TEST_THREAD,
} as const
const pinnedAtA = { ...pinnedKey, order: "a" } as const
/** A branch not yet started, and its column's key. */
const F1 = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
/** Your message at it: it has no end yet. */
const unstartedF1 = { kind: "composing", thread: F1 } as const
const onR1: Layout = resolveLayout(
  layoutReducer(initialLayout(), {
    kind: "show",
    here: { kind: "canvas", canvas: TEST_CANVAS },
  }),
  {
    index,
    lanes: [],
    archived: new Set(),
    list: [TEST_CANVAS],
    cardsOn: canvasesFor(index, [TEST_CANVAS, R1]).index.cardsOn,
    unstarted: new Map(),
    holders: new Map(),
  },
)
const withUnstarted: Layout = layoutReducer(onR1, {
  kind: "view",
  canvas: TEST_CANVAS,
  first: null,
  change: { kind: "opened", card: F1 },
})
/** The trunk's column: its thread's card's. */
const threadKey: string = threadOfEntry("1-r1")

const card = (id: typeof C1, place: TextPlace): TextCard => ({
  kind: "text",
  id,
  owner: ADA,
  placer: ADA,
  place,
  content: { command: null, unsent: null, origin: null },
})
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  cards: [],
  lanes: [],
  me: ADA,
  filled: new Set(),
  slots: {},
  selected: 0,
  composers: new Map<string, ComposerSpot>([
    [threadKey, { place: atEnd, message: null }],
    [F1, { place: unstartedF1, message: null }],
  ]),
  ...over,
})
const state = (
  cards: Partial<CardFacts> = {},
  layout = withUnstarted,
): IntentState => ({
  layout,
  index,
  asks: indexAsks(index),
  cards: facts(cards),
  canvases: canvasesFor(index, [TEST_CANVAS, R1]),
  listWidth: "full",
  page: null,
  searching: false,
  clips: NO_CLIPS,
})
const MINTED = {
  key: "new-k",
  root: NEW_ROOT,
  canvas: NEW_CANVAS,
  thread: NEW_THREAD,
  noteColumn: NEW_NOTE_COLUMN,
  media: NEW_MEDIA,
  images: (count: number) =>
    Array.from({ length: count }, (_, i) => newImage(i)),
  reference: cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1"),
  text: NEW_TEXT,
  branches: () => [],
}
const plan = (intent: Intent, s: IntentState) => planIntent(intent, s, MINTED)
/** The trunk's column and the note column, as keys an intent names. */
const TRUNK_COLUMN: ColumnKey = { kind: "card", card: threadOfEntry("1-r1") }
const NOTES_COLUMN: ColumnKey = { kind: "card", card: NOTES }
const inColumn = (
  act: Extract<Intent, { kind: "column" }>["act"],
  column: ColumnKey = { kind: "card", card: F1 },
): Intent => ({ kind: "column", column, act })

describe("take into the inventory", () => {
  test("into the selected slot when it is empty, else the first empty", () => {
    const s = state({ cards: [card(C1, atEnd)], selected: 4 })
    const move = { card: C1, from: atEnd, to: inventory }
    expect(plan({ kind: "put-away", card: C1 }, s)).toEqual([
      { kind: "inventory", act: { kind: "show", how: "peek" } },
      {
        kind: "move-card",
        move,
        how: { actedAt: { kind: "inventory" }, slot: 4 },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
    const intoInventory = plan(
      { kind: "put-away", card: C1 },
      state({ cards: [card(C1, atEnd)], selected: 4, slots: { "4": C2 } }),
    )
    expect(intoInventory[1]).toMatchObject({ how: { slot: 0 } })
  })

  test("full: refused at once, in the inventory", () => {
    const slots = Object.fromEntries(
      Array.from({ length: 18 }, (_, n) => [String(n), textCardId(`h-${n}`)]),
    )
    expect(
      plan(
        { kind: "put-away", card: C1 },
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
})

/** A card of each kind with records, at the first of its places that is no inventory. */
const ofEveryKind = (): readonly CardRecord[] => {
  const at: Partial<Record<CardPlace["kind"], CardPlace>> = {
    composing: atEnd,
    note,
    canvas: { kind: "canvas", canvas: TEST_CANVAS, order: "a", width: 1 },
    image: { kind: "image", column: NEW_MEDIA, order: "a" },
    board: { kind: "board", state: workflowStateIdFor("open"), order: "a" },
    queued: {
      kind: "queued",
      thread: TEST_THREAD,
      order: "a",
      by: ADA,
      seen: "",
    },
  }
  return (Object.keys(KINDS) as PlacedKind[]).flatMap((kind, n) => {
    const place = KINDS[kind].places.flatMap(p => at[p] ?? [])[0]
    if (place === undefined) return []
    const id = cardIdOfKind(kind, `01a0ffd2-0000-7000-8000-0000000000${n}9`)
    return [
      { kind, id, owner: ADA, placer: ADA, place, content: {} } as CardRecord,
    ]
  })
}

describe("which kinds are taken and put (KINDS)", () => {
  test("a card is taken into your inventory, or put in a slot, if its kind is ever in one (PLACES_OF)", () => {
    expect(ofEveryKind().map(c => c.kind)).toEqual(
      Object.keys(KINDS).filter(k => KINDS[k as PlacedKind].places.length > 0),
    )
    for (const c of ofEveryKind()) {
      const s = state({ cards: [c] })
      const holds = fitsPlace(c.kind, "inventory")
      const take = plan({ kind: "put-away", card: c.id }, s)
      const put = plan(
        {
          kind: "put",
          source: { kind: "card", card: c.id },
          how: "move",
          target: { kind: "inventory", slot: 7 },
        },
        s,
      )
      // What the drag engine draws says so too (`putLanding`).
      const landing = putLanding(
        { kind: "card", card: c.id },
        { kind: "inventory", slot: 7 },
        "move",
        s,
      ).kind
      expect([c.kind, take.length > 0, put.length > 0, landing]).toEqual([
        c.kind,
        holds,
        holds,
        holds ? "move" : "refused",
      ])
    }
  })

  test("a kind no person moves is put nowhere (KINDS' moves)", () => {
    for (const c of ofEveryKind().filter(c => !KINDS[c.kind].moves))
      expect(
        plan(
          {
            kind: "put",
            source: { kind: "card", card: c.id },
            how: "move",
            target: { kind: "column", key: threadKey },
          },
          state({ cards: [c] }),
        ),
      ).toEqual([])
  })
})

describe("a queued reference", () => {
  const id = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e3")
  const queuedAt = {
    kind: "queued",
    thread: TEST_THREAD,
    order: "a",
    by: ADA,
    seen: "",
  } as const
  const reference: CardRecord = {
    kind: "reference",
    id,
    owner: ADA,
    placer: ADA,
    place: queuedAt,
    content: {
      address: { kind: "entry", thread: TEST_THREAD, entry: A },
      quote: "0".repeat(64) as Sha256,
    },
  }
  const from = { kind: "queued", thread: TEST_THREAD, seen: "" } as const
  const how = { actedAt: { kind: "column", key: TEST_THREAD }, slot: null }
  test("goes back to its thread's notes from its ⋯, and to the trash from its ×", () => {
    const s = state({ cards: [reference] })
    const column = { kind: "card", card: TEST_THREAD } as const
    expect(
      plan(
        inColumn(
          { kind: "unqueue", card: id, lane: TEST_THREAD, by: ADA },
          column,
        ),
        s,
      ),
    ).toEqual([
      {
        kind: "move-card",
        move: {
          card: id,
          from,
          to: { kind: "notes", near: "thread", thread: TEST_THREAD },
        },
        how,
        queuedBy: ADA,
        fly: false,
        here: null,
      },
    ])
    expect(plan(inColumn({ kind: "trash", card: id }, column), s)).toEqual([
      {
        kind: "move-card",
        move: { card: id, from, to: TRASH_PLACE },
        how,
        queuedBy: null,
        fly: false,
        here: TEST_CANVAS,
      },
    ])
  })
})

describe("comments", () => {
  test("a reference to a comment is queued on its thread", () => {
    const card = textCardId("01a0ffd2-0000-7000-8000-0000000000d1")
    expect(
      plan(
        inColumn(
          { kind: "queue-reference", card, entry: A, thread: TEST_THREAD },
          { kind: "card", card: TEST_THREAD },
        ),
        state(),
      ),
    ).toEqual([
      {
        kind: "paste",
        paste: {
          kind: "reference",
          card: cardIdOfKind(
            "reference",
            "01a0ffd2-0000-7000-8000-0000000000e1",
          ),
          address: { kind: "card", card },
          quote: {
            kind: "comment",
            comment: card,
            entry: { kind: "entry", thread: TEST_THREAD, entry: A },
          },
        },
        to: { kind: "queued", thread: TEST_THREAD, seen: "" },
        replacing: null,
        how: { actedAt: { kind: "column", key: TEST_THREAD }, slot: null },
        here: TEST_CANVAS,
      },
    ])
  })
})

describe("put", () => {
  test("to a column: a note at its end, said there", () => {
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    const move = { card: C1, from: inventory, to: toNote }
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "column", key: threadKey },
        },
        s,
      ),
    ).toEqual([
      {
        kind: "move-card",
        move,
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
  })

  test("to a spot on a canvas: a text card goes there for the host to make it a note column (WRAPS)", () => {
    const target = {
      kind: "canvas",
      canvas: TEST_CANVAS,
      after: TEST_THREAD,
    } as const
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target,
        },
        s,
      ),
    ).toEqual([
      {
        kind: "move-card",
        move: {
          card: C1,
          from: inventory,
          to: { kind: "canvas-at", canvas: TEST_CANVAS, after: TEST_THREAD },
        },
        how: { actedAt: { kind: "inventory" }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
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
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "inventory", slot: 7 },
        },
        s,
      ),
    ).toEqual([{ kind: "swap-slots", a: 3, b: 7 }])
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C2 },
          how: "move",
          target: { kind: "inventory", slot: 7 },
        },
        s,
      )[1],
    ).toMatchObject({ kind: "move-card", how: { slot: 7 } })
  })

  test("a column no composer publishes, or where the card already is: nothing", () => {
    const s = state({ cards: [card(C1, note)] })
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "column", key: "gone" },
        },
        s,
      ),
    ).toEqual([])
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "notes", column: NOTES },
        },
        s,
      ),
    ).toEqual([])
  })
})

describe("your message", () => {
  const MSG = cardIdFor("c9")
  const withMessage = (
    filled: boolean,
    cards: readonly CardRecord[],
    key = threadKey,
    place: TextPlace = atEnd,
  ) =>
    state({
      cards: [...cards, card(MSG, place)],
      filled: new Set(filled ? [MSG] : []),
      slots: { "3": C1 },
      composers: new Map<string, ComposerSpot>([
        [key, { place, message: MSG }],
      ]),
    })
  const toComposer = (key = threadKey): Intent => ({
    kind: "put",
    source: { kind: "card", card: C1 },
    how: "move",
    target: { kind: "composer", key },
  })

  test("a drop on the composer with no message there makes the card your message", () => {
    const s = state({ cards: [card(C1, note)] })
    expect(plan(toComposer(), s)).toEqual([
      {
        kind: "move-card",
        move: { card: C1, from: noteKey, to: atEnd },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
  })

  test("a message with text takes the note's place, in one move of the two: one undo", () => {
    expect(plan(toComposer(), withMessage(true, [card(C1, note)]))).toEqual([
      {
        kind: "move-cards",
        moves: [
          { move: { card: C1, from: noteKey, to: atEnd }, slot: null },
          { move: { card: MSG, from: atEnd, to: noteKey }, slot: null },
        ],
        actedAt: { kind: "column", key: threadKey },
        close: [],
        here: null,
      },
    ])
  })

  test("a message with text goes to the slot a card from your inventory leaves", () => {
    const [keep] = plan(toComposer(), withMessage(true, [card(C1, inventory)]))
    expect(keep).toMatchObject({
      kind: "move-cards",
      moves: [
        { move: { card: C1, to: atEnd }, slot: null },
        { move: { card: MSG, to: inventory }, slot: 3 },
      ],
    })
  })

  test("an empty message is trashed as the card takes its place", () => {
    const [keep] = plan(toComposer(), withMessage(false, [card(C1, note)]))
    expect(keep).toMatchObject({
      kind: "move-cards",
      moves: [
        { move: { card: C1, to: atEnd } },
        { move: { card: MSG, to: { kind: "trash" } } },
      ],
    })
  })

  test("Move to ▸ notes: your message goes to the note column nearest its thread", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(
      plan(inColumn({ kind: "to-note", card: C1 }, TRUNK_COLUMN), s),
    ).toEqual([
      {
        kind: "move-card",
        move: { card: C1, from: atEnd, to: toNote },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
  })
})

describe("a note column", () => {
  const C3 = cardIdFor("c3")
  const OTHER = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a2",
  )
  const into = (card: typeof C1, column = OTHER): Intent => ({
    kind: "put",
    source: { kind: "card", card },
    how: "move",
    target: { kind: "notes", column },
  })

  test("a drop on a note column makes the card a note at its end, said there", () => {
    const s = state({ cards: [card(C1, atEnd), card(C3, note)] })
    expect(plan(into(C1), s)).toEqual([
      {
        kind: "move-card",
        move: { card: C1, from: atEnd, to: { kind: "note", column: OTHER } },
        how: { actedAt: { kind: "column", key: OTHER }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
    expect(plan(into(C3, NOTES), s)).toEqual([])
  })

  test("a note moves one place in its column with ↑ and ↓, as a queued card does", () => {
    const n = (id: typeof C1, order: string) =>
      card(id, { kind: "note", column: NOTES, order })
    const s = state({ cards: [n(C1, "a"), n(C3, "b")] })
    expect(
      plan(
        inColumn(
          { kind: "reorder", card: C3, among: [C1, C3], step: -1 },
          NOTES_COLUMN,
        ),
        s,
      ),
    ).toEqual([
      {
        kind: "reorder-card",
        reorder: {
          card: C3,
          at: { kind: "note", column: NOTES },
          after: null,
          before: C1,
        },
        how: { actedAt: { kind: "column", key: NOTES }, slot: null },
      },
    ])
  })
})

describe("pin and unpin", () => {
  test("pin: your message to the top of the same thread's column, a move said in the column", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(plan(inColumn({ kind: "pin", card: C1 }, TRUNK_COLUMN), s)).toEqual([
      {
        kind: "move-card",
        move: { card: C1, from: atEnd, to: pinnedKey },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
  })

  test("unpin: a note where it was pinned", () => {
    const s = state({ cards: [card(C1, pinnedAtA)] })
    expect(
      plan(inColumn({ kind: "unpin", card: C1 }, TRUNK_COLUMN), s)[0],
    ).toMatchObject({
      kind: "move-card",
      move: { card: C1, from: pinnedKey, to: toNote },
    })
  })

  test("an unpin of a card not pinned is nothing", () => {
    const s = state({ cards: [card(C2, atEnd)] })
    expect(
      plan(inColumn({ kind: "unpin", card: C2 }, TRUNK_COLUMN), s),
    ).toEqual([])
  })

  test("pin to the canvas: the canvas it is in, else the one you are on; unpinned, to its notes", () => {
    const pinnedToCanvas = {
      kind: "canvas-pinned",
      canvas: TEST_CANVAS,
      order: "a",
    } as const
    const s = state({ cards: [card(C1, atEnd), card(C2, pinnedToCanvas)] })
    expect(
      plan(inColumn({ kind: "pin-to-canvas", card: C1 }, TRUNK_COLUMN), s),
    ).toEqual([
      {
        kind: "move-card",
        move: {
          card: C1,
          from: atEnd,
          to: { kind: "canvas-pinned", canvas: TEST_CANVAS },
        },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
    // Pinned to it already: nothing.
    expect(plan(inColumn({ kind: "pin-to-canvas", card: C2 }), s)).toEqual([])
    expect(plan(inColumn({ kind: "unpin", card: C2 }), s)[0]).toMatchObject({
      move: {
        card: C2,
        from: { kind: "canvas-pinned", canvas: TEST_CANVAS },
        to: { kind: "notes", near: "canvas", canvas: TEST_CANVAS },
      },
    })
    // A drop on the canvas column's pins pins there.
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "canvas-pinned", canvas: TEST_CANVAS },
        },
        state({ cards: [card(C1, inventory)], slots: { "3": C1 } }),
      )[0],
    ).toMatchObject({
      move: { card: C1, to: { kind: "canvas-pinned", canvas: TEST_CANVAS } },
      how: { actedAt: { kind: "column", key: TEST_CANVAS } },
    })
  })

  test("a drop on a column's pinned strip pins", () => {
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "pinned", key: threadKey },
        },
        s,
      )[0],
    ).toMatchObject({
      kind: "move-card",
      move: { card: C1, from: inventory, to: pinnedKey },
    })
  })
})

test("afterKeep closes only when the keep was accepted", () => {
  const close = [{ kind: "reload" }] as const
  expect(afterKeep({ kind: "accepted", rev: 1 }, close)).toBe(close)
  expect(afterKeep({ kind: "refused", refusal: null }, close)).toEqual([])
})

describe("undo and redo of moves", () => {
  const undo: Intent = { kind: "undo-move", direction: "undo", inPanel: false }

  test("on a canvas: that canvas's history", () => {
    expect(plan(undo, state({}, onR1))).toEqual([
      { kind: "undo-moves", canvas: TEST_CANVAS, direction: "undo" },
    ])
  })

  test("with the inventory panel focused: this tab's swaps", () => {
    expect(plan({ ...undo, inPanel: true } as Intent, state())).toEqual([
      { kind: "undo-swap", direction: "undo" },
    ])
  })

  test("on no canvas: your history outside any canvas", () => {
    const nothing = layoutReducer(onR1, {
      kind: "show",
      here: { kind: "nothing" },
    })
    expect(plan(undo, state({}, nothing))).toEqual([
      { kind: "undo-moves", canvas: null, direction: "undo" },
    ])
  })
})

describe("afterUndo: what an undo's answer brings into view", () => {
  const answered = (outcome: Outcome, s: IntentState = state({}, onR1)) =>
    plan({ kind: "undo-answered", outcome }, s)

  test("a card back at a thread's end: shown as open-at shows it", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: atEnd }] }),
    ).toContainEqual({ kind: "reveal", entry: A })
  })

  test("two cards back in one place: it is shown once, as for one card", () => {
    expect(
      answered({
        kind: "undone",
        cards: [
          { card: C1, place: atEnd },
          { card: C2, place: atEnd },
        ],
      }),
    ).toEqual(answered({ kind: "undone", cards: [{ card: C1, place: atEnd }] }))
  })

  test("an undone pin: shown at its thread's end, as a note is", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: pinnedKey }] }),
    ).toContainEqual({ kind: "reveal", entry: A })
  })

  test("a trashed queued card back in its queue: its thread shown, and the card scrolled to in the dock", () => {
    const effects = answered({
      kind: "undone",
      cards: [
        {
          card: C1,
          place: { kind: "queued", thread: TEST_THREAD, seen: "" },
        },
      ],
    })
    expect(effects).toContainEqual({ kind: "reveal", entry: A })
    expect(effects.at(-1)).toEqual({ kind: "reveal-card", card: C1 })
  })

  test("back in your inventory: the panel", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: inventory }] }),
    ).toEqual([{ kind: "inventory", act: { kind: "show", how: "held" } }])
  })

  test("your message back at a thread not yet started: its card unfolded in its canvas", () => {
    const base = canvasesFor(index, [TEST_CANVAS, R1])
    const opened: IntentState = {
      ...state({}, onR1),
      canvases: {
        ...base,
        index: {
          ...base.index,
          canvasOfCard: new Map([
            ...base.index.canvasOfCard,
            [F1, TEST_CANVAS],
          ]),
        },
      },
    }
    expect(
      answered(
        { kind: "undone", cards: [{ card: C1, place: unstartedF1 }] },
        opened,
      ),
    ).toEqual([
      {
        kind: "layout",
        moves: false,
        action: { kind: "show", here: { kind: "canvas", canvas: TEST_CANVAS } },
      },
      { kind: "list", act: { kind: "ensure", canvas: TEST_CANVAS } },
      {
        kind: "layout",
        moves: false,
        action: {
          kind: "view",
          canvas: TEST_CANVAS,
          first: threadOfEntry("1-r1"),
          change: { kind: "fold", card: F1, unfolded: true },
        },
      },
    ])
  })

  test("refused: the card shown where it is now, and who moved it said there", () => {
    const effects = answered(
      {
        kind: "unmoved",
        code: "moved",
        place: unstartedF1,
        by: writerId("bea@x.io"),
      },
      state({}, withUnstarted),
    )
    expect(effects.at(-1)).toEqual({
      kind: "refuse",
      refusal: {
        card: null,
        actedAt: { kind: "column", key: F1 },
        code: "moved",
        by: writerId("bea@x.io"),
        fromQueue: false,
      },
    })
  })

  test("a canvas's card back on the board: the board, open", () => {
    expect(
      answered({
        kind: "undone",
        cards: [
          {
            card: TEST_CANVAS,
            place: { kind: "board", state: workflowStateIdFor("open") },
          },
        ],
      }),
    ).toEqual([
      { kind: "layout", moves: false, action: { kind: "board", open: true } },
    ])
  })

  test("nothing to undo: nothing", () => {
    expect(answered({ kind: "nothing" })).toEqual([])
  })
})

describe("open-trace: where a trace leads", () => {
  const BEA = writerId("bea@x.io")
  const trace = (message: ReturnType<typeof entryId> | null) =>
    ({
      id: "t-1",
      for: ADA,
      card: C1,
      by: BEA,
      from: pinnedKey,
      to: null,
      message,
      at: 1,
    }) as const
  const follow = (s: IntentState, message: ReturnType<typeof entryId> | null) =>
    plan({ kind: "open-trace", trace: trace(message) }, s)

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

describe("a card made a thread", () => {
  const STATE1 = workflowStateIdFor("s-1")
  // The host names the move's history: the page names none.
  const spun = { kind: "trash" } as const
  test.each([
    [
      "a note dropped on a state: its thread there, sent with the canvas you are on",
      card(C1, note),
      { kind: "state", state: STATE1 },
      { from: noteKey, state: STATE1, sidebar: null, here: TEST_CANVAS },
    ],
    [
      "an inventory card dropped in the sidebar: placed before the canvas it was dropped on, sent with the new canvas, which you will be on",
      card(C1, { kind: "inventory", holder: ADA }),
      { kind: "sidebar", before: TEST_CANVAS },
      {
        from: inventory,
        state: null,
        sidebar: { before: TEST_CANVAS },
        here: NEW_CANVAS,
      },
    ],
    [
      "an inventory card dropped on a state, sent with the canvas you are on",
      card(C1, { kind: "inventory", holder: ADA }),
      { kind: "state", state: STATE1 },
      { from: inventory, state: STATE1, sidebar: null, here: TEST_CANVAS },
    ],
  ] as const)("%s", (_, c, target, want) => {
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target,
        },
        state({ cards: [c] }),
      ),
    ).toEqual([
      {
        kind: "spin-off",
        request: {
          kind: "spin-off",
          move: { card: C1, from: want.from, to: spun },
          root: NEW_ROOT,
          thread: NEW_THREAD,
          canvas: NEW_CANVAS,
          state: want.state,
          here: want.here,
        },
        sidebar: want.sidebar,
      },
    ])
  })

  test("a note's ⋯ Move to a new thread in a state is the same as its drop there", () => {
    const s = state({ cards: [card(C1, note)] })
    expect(
      plan(
        inColumn({ kind: "spin-off", card: C1, state: STATE1 }, TRUNK_COLUMN),
        s,
      ),
    ).toEqual(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "state", state: STATE1 },
        },
        s,
      ),
    )
  })

  test("nothing for someone else's inventory card", () => {
    const theirs = card(C1, { kind: "inventory", holder: writerId("bea@x.io") })
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: C1 },
          how: "move",
          target: { kind: "state", state: STATE1 },
        },
        state({ cards: [theirs] }),
      ),
    ).toEqual([])
  })

  test("afterSpinOff: a sidebar drop shows the new canvas once its first message is written", () => {
    const sidebar = { before: TEST_CANVAS }
    expect(
      afterSpinOff(
        { kind: "appended", id: entryId("t-1") },
        NEW_CANVAS,
        sidebar,
      ),
    ).toEqual([
      {
        kind: "list",
        act: { kind: "place", canvas: NEW_CANVAS, before: TEST_CANVAS },
      },
      {
        kind: "layout",
        moves: false,
        action: { kind: "show", here: { kind: "canvas", canvas: NEW_CANVAS } },
      },
    ])
    expect(
      afterSpinOff({ kind: "appended", id: entryId("t-1") }, NEW_CANVAS, null),
    ).toEqual([])
    expect(
      afterSpinOff(
        { kind: "refused", code: "refused", message: "no" },
        NEW_CANVAS,
        sidebar,
      ),
    ).toEqual([])
  })
})

describe("a new card", () => {
  const content = { command: null, unsent: null, origin: null }
  const made = (
    place: TextCard["place"],
    text: string,
    key: string,
  ): Effect => ({
    kind: "create-card",
    card: { kind: "text", id: C1, owner: ADA, placer: ADA, place, content },
    text,
    how: { actedAt: { kind: "column", key }, slot: null },
  })
  test.each([
    [
      "a note",
      { kind: "note", column: NOTES },
      NOTES_COLUMN,
      { kind: "note", column: NOTES, order: LAST_ORDER },
    ],
    [
      "a pinned card",
      { kind: "pinned", thread: TEST_THREAD },
      { kind: "card", card: TEST_THREAD },
      { kind: "pinned", thread: TEST_THREAD, order: LAST_ORDER },
    ],
    [
      "a comment",
      { kind: "margin", on: entryMargin(TEST_THREAD, A), seen: "" },
      { kind: "card", card: TEST_THREAD },
      {
        kind: "margin",
        on: entryMargin(TEST_THREAD, A),
        order: LAST_ORDER,
        seen: "",
      },
    ],
  ] as const)(
    "%s is made at its list's end with its text, said in its column",
    (_, to, column, place) => {
      expect(
        plan(
          inColumn({ kind: "new-card", card: C1, to, text: "j" }, column),
          state(),
        ),
      ).toEqual([made(place, "j", keyText(column))])
    },
  )

  test("a comment is an empty note at its margin's end, its box armed to take focus", () => {
    expect(
      plan(
        inColumn(
          { kind: "comment", card: C1, entry: A, thread: TEST_THREAD },
          { kind: "card", card: TEST_THREAD },
        ),
        state(),
      ),
    ).toEqual([
      made(
        {
          kind: "margin",
          on: entryMargin(TEST_THREAD, A),
          order: LAST_ORDER,
          seen: "",
        },
        "",
        TEST_THREAD,
      ),
      { kind: "arm-focus", key: { kind: "card", card: C1 } },
    ])
  })
})

describe("landing a copy", () => {
  const entryAddress = { kind: "entry", thread: TEST_THREAD, entry: A } as const
  const past: Clip = {
    kind: "past",
    taken: { address: entryAddress, markdown: "two" },
  }
  const selection: Clip = { kind: "text", text: "tw", origin: entryAddress }
  const textCard: Clip = {
    kind: "card",
    of: { kind: "text", card: C1, text: "hi" },
    cut: false,
  }
  const land = (
    clip: Clip,
    target: PutTarget,
    s: IntentState = state(),
  ): Landing => putLanding({ kind: "clip", clip }, target, "copy", s)
  const column: PutTarget = { kind: "column", key: threadKey }

  test("into a text box: text as itself, anything else as a link", () => {
    expect(land(selection, { kind: "text-box" })).toEqual({
      kind: "insert",
      text: "tw",
    })
    expect(land(past, { kind: "text-box" })).toEqual({
      kind: "insert",
      text: addressLink(entryAddress, "a message"),
    })
  })

  test("on a surface: the past lands as a reference, a selection as a text card keeping its origin", () => {
    expect(land(past, column)).toEqual({
      kind: "reference",
      address: entryAddress,
      quote: { kind: "markdown", text: "two" },
      to: column,
    })
    expect(land(selection, column)).toEqual({
      kind: "text",
      text: "tw",
      origin: entryAddress,
      to: column,
    })
    expect(land(textCard, column)).toMatchObject({
      kind: "text",
      text: "hi",
      origin: { kind: "card", card: C1 },
    })
  })

  test("an Alt-drag's copy of a card in place lands as a copy of its clip (`cardClip`), never a move", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(
      putLanding({ kind: "card", card: C1 }, column, "copy", s),
    ).toMatchObject({ kind: "text", text: "copied text" })
  })

  test("a cut card still in your trash comes out of it; anywhere else it lands as its copy", () => {
    const cut: Clip = { ...textCard, cut: true }
    const atCard = card(C1, atEnd)
    const trashed = {
      ...atCard,
      placer: ADA,
      place: { kind: "trash", left: livePlace(atCard.place) },
    } as const
    expect(land(cut, column, state({ cards: [trashed] }))).toEqual({
      kind: "uncut",
      card: C1,
      to: column,
    })
    expect(
      land(cut, column, state({ cards: [card(C1, atEnd)] })),
    ).toMatchObject({ kind: "text" })
  })

  test("a thread's copy lands just after its source; Copy to this canvas too", () => {
    const thread: Clip = {
      kind: "card",
      of: { kind: "thread", card: TEST_THREAD, end: A, text: "" },
      cut: false,
    }
    const effects = planPut(
      { kind: "clip", clip: thread },
      { kind: "canvas", canvas: TEST_CANVAS, after: TEST_THREAD },
      "copy",
      state(),
      MINTED,
    )
    expect(effects).toMatchObject([
      {
        kind: "request",
        intent: {
          kind: "copy-thread",
          source: TEST_THREAD,
          end: A,
          move: {
            to: { kind: "canvas-at", canvas: TEST_CANVAS, after: TEST_THREAD },
          },
        },
      },
    ])
  })

  test("a column dropped on a sidebar canvas goes to its canvas's end; between canvases, to a new canvas", () => {
    const thread: CardRecord = {
      kind: "thread",
      id: F1,
      owner: ADA,
      placer: ADA,
      place: {
        kind: "canvas",
        canvas: R1_CANVAS_FOR_DROP,
        order: "a",
        width: 1,
      },
      content: UNTICKED,
    }
    const s = state({ cards: [thread] })
    const onto = planPut(
      { kind: "card", card: F1 },
      { kind: "item", canvas: TEST_CANVAS },
      "move",
      s,
      MINTED,
    )
    expect(onto[0]).toMatchObject({
      kind: "move-card",
      move: { card: F1, to: { kind: "canvas-at", canvas: TEST_CANVAS } },
    })
    const between = planPut(
      { kind: "card", card: F1 },
      { kind: "sidebar", before: TEST_CANVAS },
      "move",
      s,
      MINTED,
    )
    expect(between).toEqual([
      {
        kind: "move-cards",
        moves: [
          {
            move: {
              card: F1,
              from: { kind: "canvas", canvas: R1_CANVAS_FOR_DROP },
              to: { kind: "new-canvas", canvas: NEW_CANVAS },
            },
            slot: null,
          },
        ],
        actedAt: { kind: "inventory" },
        close: [
          {
            kind: "list",
            act: { kind: "place", canvas: NEW_CANVAS, before: TEST_CANVAS },
          },
        ],
        here: NEW_CANVAS,
      },
    ])
  })

  test("the past dropped with move is still a copy", () => {
    expect(
      putLanding({ kind: "clip", clip: past }, column, "move", state()),
    ).toMatchObject({ kind: "reference" })
  })

  test("a slot: aimed, there, its card replaced; unaimed, the first free, else refused full", () => {
    const filled = state({ cards: [card(C2, inventory)], slots: { "4": C2 } })
    expect(land(past, { kind: "inventory", slot: 2 }, filled)).toMatchObject({
      kind: "reference",
      to: { kind: "inventory", slot: 2 },
    })
    expect(land(past, { kind: "inventory", slot: 4 }, filled)).toMatchObject({
      kind: "replace",
      old: C2,
      landing: { kind: "reference", to: { kind: "inventory", slot: 4 } },
    })
    const full = state({
      slots: Object.fromEntries(
        Array.from({ length: INVENTORY_SLOTS }, (_, n) => [
          String(n),
          cardIdFor(`s${n}`),
        ]),
      ),
    })
    expect(land(past, { kind: "inventory", slot: null }, full)).toEqual({
      kind: "refused",
      code: "full",
      card: null,
    })
  })

  test("an unaimed take is refused full at 12 held, though a slot among them is empty", () => {
    const held = Array.from({ length: INVENTORY_SLOTS }, (_, n) =>
      card(cardIdFor(`h${n}`), inventory),
    )
    const s = state({
      cards: held,
      slots: Object.fromEntries(
        held.map((c, n) => [String(n === 3 ? INVENTORY_SLOTS : n), c.id]),
      ),
    })
    expect(land(past, { kind: "inventory", slot: null }, s)).toEqual({
      kind: "refused",
      code: "full",
      card: null,
    })
  })

  test("a replaced slot's card goes to your trash first: a drop's move set, a paste's `replacing`", () => {
    const s = state({
      cards: [card(C1, atEnd), card(C2, inventory)],
      slots: { "4": C2 },
    })
    const target = { kind: "inventory", slot: 4 } as const
    expect(
      planPut({ kind: "card", card: C1 }, target, "move", s, MINTED),
    ).toMatchObject([
      { kind: "inventory" },
      {
        kind: "move-cards",
        moves: [
          { move: { card: C2, to: TRASH_PLACE } },
          { move: { card: C1, to: inventory }, slot: 4 },
        ],
      },
    ])
    expect(
      planPut({ kind: "clip", clip: past }, target, "copy", s, MINTED),
    ).toMatchObject([
      { kind: "inventory" },
      {
        kind: "paste",
        to: inventory,
        replacing: { card: C2, from: inventory },
        how: { slot: 4 },
      },
    ])
  })

  test("a slot is replaced only when its card is yours to trash, and never by a thread's copy", () => {
    const canvas = {
      kind: "canvas",
      id: TEST_CANVAS,
      owner: ADA,
      placer: ADA,
      place: inventory,
      content: {},
    } as unknown as CardRecord
    const s = state({ cards: [canvas], slots: { "4": TEST_CANVAS } })
    expect(land(past, { kind: "inventory", slot: 4 }, s)).toEqual({
      kind: "refused",
      code: "not-replaced",
      card: TEST_CANVAS,
    })
    const thread: Clip = {
      kind: "card",
      of: { kind: "thread", card: TEST_THREAD, end: A, text: "" },
      cut: false,
    }
    const filled = state({ cards: [card(C2, inventory)], slots: { "4": C2 } })
    expect(land(thread, { kind: "inventory", slot: 4 }, filled)).toEqual({
      kind: "refused",
      code: "slot-taken",
      card: C2,
    })
  })

  test("a card in your inventory dropped on another's slot swaps", () => {
    const s = state({
      cards: [card(C1, inventory), card(C2, inventory)],
      slots: { "3": C1, "4": C2 },
    })
    expect(
      putLanding(
        { kind: "card", card: C1 },
        { kind: "inventory", slot: 4 },
        "move",
        s,
      ),
    ).toEqual({ kind: "swap", a: 3, b: 4 })
  })

  test("Edit as text is a paste of its quote replacing the reference, in its place and slot", () => {
    const ref = cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e3",
    )
    const reference: CardRecord = {
      kind: "reference",
      id: ref,
      owner: ADA,
      placer: ADA,
      place: inventory,
      content: { address: entryAddress, quote: "a".repeat(64) as Sha256 },
    }
    const s = state({ cards: [reference], slots: { "6": ref } })
    expect(
      plan(
        { kind: "edit-as-text", reference: ref, card: NEW_TEXT, text: "q" },
        s,
      ),
    ).toEqual([
      {
        kind: "paste",
        paste: {
          kind: "text",
          card: NEW_TEXT,
          origin: entryAddress,
          text: "q",
        },
        to: inventory,
        replacing: { card: ref, from: inventory },
        how: { actedAt: { kind: "inventory" }, slot: 6 },
        here: TEST_CANVAS,
      },
    ])
  })
})

describe("images in media columns", () => {
  const M1 = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000d1")
  const M2 = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000d2")
  const image = (n: number, column: typeof M1, order: string): CardRecord =>
    makeCard(
      "image",
      newImage(n),
      { kind: "image", column, order },
      {
        versions: [
          {
            sha256: "a".repeat(64) as Sha256,
            original: "a".repeat(64) as Sha256,
            mimeType: "image/png",
            width: 4,
            height: 3,
            by: ADA,
            at: 1,
          },
        ],
      },
      ADA,
    )
  const cards = [image(1, M1, "a"), image(2, M1, "b"), image(3, M1, "c")]
  const put = (card: CardId, target: PutTarget) =>
    plan(
      { kind: "put", source: { kind: "card", card }, target, how: "move" },
      state({ cards }),
    )

  test("an image dropped onto another of its column moves before it; onto the column, to its end", () => {
    expect(
      put(newImage(3), {
        kind: "images",
        column: M1,
        on: { image: newImage(1), edge: "onto" },
      }),
    ).toMatchObject([
      {
        kind: "reorder-card",
        reorder: {
          card: newImage(3),
          at: { kind: "image", column: M1 },
          after: null,
          before: newImage(1),
        },
      },
    ])
    expect(
      put(newImage(1), { kind: "images", column: M1, on: null }),
    ).toMatchObject([
      { kind: "reorder-card", reorder: { after: newImage(3), before: null } },
    ])
  })

  test("an image dropped where it already is moves nothing", () => {
    expect(
      put(newImage(2), {
        kind: "images",
        column: M1,
        on: { image: newImage(3), edge: "onto" },
      }),
    ).toEqual([])
    expect(put(newImage(3), { kind: "images", column: M1, on: null })).toEqual(
      [],
    )
  })

  test("an image dropped on another media column moves to its end; a text card is refused there", () => {
    expect(
      put(newImage(1), { kind: "images", column: M2, on: null }),
    ).toMatchObject([
      {
        kind: "move-card",
        move: {
          card: newImage(1),
          to: { kind: "image-at", column: M2, before: null },
        },
      },
    ])
    const s = state({ cards: [card(C1, atEnd)] })
    expect(
      putLanding(
        { kind: "card", card: C1 },
        { kind: "images", column: M2, on: null },
        "move",
        s,
      ),
    ).toEqual({ kind: "refused", code: "no-place", card: C1 })
  })

  test("an image dropped after another lands just before the next; in another column, at that spot", () => {
    expect(
      put(newImage(1), {
        kind: "images",
        column: M1,
        on: { image: newImage(2), edge: "after" },
      }),
    ).toMatchObject([
      {
        kind: "reorder-card",
        reorder: { after: newImage(2), before: newImage(3) },
      },
    ])
    const s = state({ cards: [...cards, image(4, M2, "a"), image(5, M2, "b")] })
    expect(
      plan(
        {
          kind: "put",
          source: { kind: "card", card: newImage(1) },
          target: {
            kind: "images",
            column: M2,
            on: { image: newImage(4), edge: "after" },
          },
          how: "move",
        },
        s,
      ),
    ).toMatchObject([
      {
        kind: "move-card",
        move: { to: { kind: "image-at", column: M2, before: newImage(5) } },
      },
    ])
  })

  test("an image dropped at a spot on a canvas goes there, in a media column made for it", () => {
    expect(
      put(newImage(1), { kind: "canvas", canvas: TEST_CANVAS, after: null }),
    ).toMatchObject([
      {
        kind: "move-card",
        move: { to: { kind: "canvas-at", canvas: TEST_CANVAS, after: null } },
      },
    ])
  })
})
