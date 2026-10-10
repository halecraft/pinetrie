import {
  atEntry,
  type CardPlace,
  type CardRecord,
  cardIdOfKind,
  DISCARDED,
  entryId,
  fitsPlace,
  indexAsks,
  KINDS,
  type PlacedKind,
  rootIdFor,
  type Sha256,
  type TextCard,
  type TextPlace,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { Outcome } from "@pinetrie/protocol/codec"
import { LAST_ORDER } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { afterKeep } from "./card-intents.ts"
import type { ColumnKey } from "./columns.ts"
import type { CardFacts, IntentState } from "./effects.ts"
import {
  NEW_NOTE_COLUMN,
  NEW_ROOT,
  NEW_TASK,
  NEW_THREAD,
  TEST_TASK,
  tasksFor,
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
import type { ComposerSpot } from "./put-target.ts"
import { afterSpinOff } from "./spin-off.ts"

/** The thread `index` is: its first entry names it (`withThreads`). */
const TEST_THREAD = threadIdFor("1-r1")
const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

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
/** The note column the fixtures' notes are in (ADR-0116). */
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
/** A branch's thread, and its column's key (ADR-0116). */
const F1 = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const freshF1 = {
  kind: "fresh",
  column: F1,
  root: TEST_ROOT,
  task: TEST_TASK,
  at: atEntry(A),
} as const
const onR1: Layout = resolveLayout(
  layoutReducer(initialLayout(), {
    kind: "show",
    here: { kind: "task", task: TEST_TASK },
  }),
  {
    index,
    lanes: [],
    archived: new Set(),
    list: [TEST_TASK],
    canvases: tasksFor(index, [TEST_TASK, R1]).index.canvases,
    forks: new Map(),
    holders: new Map(),
  },
)
const withFresh: Layout = layoutReducer(onR1, {
  kind: "view",
  task: TEST_TASK,
  first: null,
  change: { kind: "openFresh", thread: F1, at: A },
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
  laneRecords: new Map(),
  me: ADA,
  filled: new Set(),
  slots: {},
  selected: 0,
  composers: new Map<string, ComposerSpot>([
    [threadKey, { place: atEnd, message: null }],
    [F1, { place: freshF1, message: null }],
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
  tasks: tasksFor(index, [TEST_TASK, R1]),
  listWidth: "full",
  page: null,
})
const plan = (intent: Intent, s: IntentState) =>
  planIntent(intent, s, {
    key: "new-k",
    root: NEW_ROOT,
    task: NEW_TASK,
    thread: NEW_THREAD,
    noteColumn: NEW_NOTE_COLUMN,
    reference: cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e1",
    ),
  })
/** The trunk's column and the note column, as keys an intent names. */
const TRUNK_COLUMN: ColumnKey = { kind: "card", card: threadOfEntry("1-r1") }
const NOTES_COLUMN: ColumnKey = { kind: "card", card: NOTES }
const inColumn = (
  act: Extract<Intent, { kind: "column" }>["act"],
  column: ColumnKey = { kind: "fresh", thread: F1 },
): Intent => ({ kind: "column", column, act })

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
        here: null,
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
      Array.from({ length: 18 }, (_, n) => [String(n), textCardId(`h-${n}`)]),
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

  test("a take from the past is a reference in your inventory, its markdown on the clipboard too (ADR-0126)", () => {
    const address = { kind: "entry", thread: TEST_THREAD, entry: A } as const
    const ref = cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e2",
    )
    expect(
      plan(
        inColumn({
          kind: "takeReference",
          card: ref,
          address,
          markdown: "hello",
        }),
        state(),
      ),
    ).toEqual([
      { kind: "copyText", text: "hello" },
      { kind: "showInventory", brief: true },
      {
        kind: "takeReference",
        card: ref,
        address,
        markdown: "hello",
        to: inventory,
        how: { actedAt: { kind: "inventory" }, slot: 0 },
      },
    ])
  })
})

/** A card of each kind with records, at the first of its places that is no inventory. */
const ofEveryKind = (): readonly CardRecord[] => {
  const at: Partial<Record<CardPlace["kind"], CardPlace>> = {
    composing: atEnd,
    note,
    canvas: { kind: "canvas", task: TEST_TASK, order: "a", width: 1 },
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
      const take = plan({ kind: "takeIntoInventory", card: c.id }, s)
      const put = plan(
        { kind: "put", card: c.id, target: { kind: "inventory", slot: 7 } },
        s,
      )
      expect([c.kind, take.length > 0, put.length > 0]).toEqual([
        c.kind,
        holds,
        holds,
      ])
    }
  })

  test("a kind no person moves is put nowhere (KINDS' moves)", () => {
    for (const c of ofEveryKind().filter(c => !KINDS[c.kind].moves))
      expect(
        plan(
          {
            kind: "put",
            card: c.id,
            target: { kind: "column", key: threadKey },
          },
          state({ cards: [c] }),
        ),
      ).toEqual([])
  })
})

describe("a queued reference (ADR-0126)", () => {
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
        kind: "moveCard",
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
    expect(plan(inColumn({ kind: "discard", card: id }, column), s)).toEqual([
      {
        kind: "moveCard",
        move: { card: id, from, to: DISCARDED },
        how,
        queuedBy: null,
        fly: false,
        here: TEST_TASK,
      },
    ])
  })
})

describe("comments (ADR-0126)", () => {
  test("a comment is a new, empty note made at the end of its entry's margin; a reference to it is queued on its thread, its quote the comment", () => {
    const card = textCardId("01a0ffd2-0000-7000-8000-0000000000d1")
    expect(
      plan(
        inColumn(
          { kind: "comment", card, entry: A, thread: TEST_THREAD },
          { kind: "card", card: TEST_THREAD },
        ),
        state(),
      ),
    ).toEqual([
      {
        kind: "createCard",
        card: {
          kind: "text",
          id: card,
          owner: ADA,
          placer: ADA,
          place: {
            kind: "margin",
            entry: A,
            thread: TEST_THREAD,
            order: LAST_ORDER,
          },
          content: { command: null, unsent: null, origin: null },
        },
        text: "",
        how: { actedAt: { kind: "column", key: TEST_THREAD }, slot: null },
      },
    ])
    expect(
      plan(
        inColumn(
          { kind: "queueReference", card, entry: A, thread: TEST_THREAD },
          { kind: "card", card: TEST_THREAD },
        ),
        state(),
      ),
    ).toEqual([
      {
        kind: "queueComment",
        card: cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1"),
        comment: card,
        entry: { kind: "entry", thread: TEST_THREAD, entry: A },
        to: { kind: "queued", thread: TEST_THREAD, seen: "" },
        how: { actedAt: { kind: "column", key: TEST_THREAD }, slot: null },
      },
    ])
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
        here: null,
      },
    ])
  })

  test("to a spot on a canvas: a text card goes there for the host to make it a note column (WRAPS, ADR-0126)", () => {
    const target = {
      kind: "canvas",
      task: TEST_TASK,
      after: TEST_THREAD,
    } as const
    const s = state({ cards: [card(C1, inventory)], slots: { "3": C1 } })
    expect(plan({ kind: "put", card: C1, target }, s)).toEqual([
      {
        kind: "moveCard",
        move: {
          card: C1,
          from: inventory,
          to: { kind: "canvas-at", task: TEST_TASK, after: TEST_THREAD },
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
        { kind: "put", card: C1, target: { kind: "notes", column: NOTES } },
        s,
      ),
    ).toEqual([])
  })
})

describe("your message (ADR-0113)", () => {
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
    card: C1,
    target: { kind: "composer", key },
  })

  test("a drop on the composer with no message there makes the card your message", () => {
    const s = state({ cards: [card(C1, note)] })
    expect(plan(toComposer(), s)).toEqual([
      {
        kind: "moveCard",
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
        kind: "keep",
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
    const s = withMessage(true, [card(C1, note)], F1, freshF1)
    expect(plan(toComposer(F1), s)).toEqual([
      {
        kind: "refuse",
        refusal: {
          card: C1,
          actedAt: { kind: "column", key: F1 },
          code: "message-holds-text",
        },
      },
    ])
    const fromInventory = withMessage(true, [card(C1, inventory)], F1, freshF1)
    expect(plan(toComposer(F1), fromInventory)[0]).toMatchObject({
      kind: "keep",
    })
  })

  test("Move to ▸ notes: your message goes to the note column nearest its thread", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(
      plan(inColumn({ kind: "toNote", card: C1 }, TRUNK_COLUMN), s),
    ).toEqual([
      {
        kind: "moveCard",
        move: { card: C1, from: atEnd, to: toNote },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
  })
})

describe("a note column (ADR-0116)", () => {
  const C3 = cardIdFor("c3")
  const OTHER = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a2",
  )
  const into = (card: typeof C1, column = OTHER): Intent => ({
    kind: "put",
    card,
    target: { kind: "notes", column },
  })

  test("a drop on a note column makes the card a note at its end, said there", () => {
    const s = state({ cards: [card(C1, atEnd), card(C3, note)] })
    expect(plan(into(C1), s)).toEqual([
      {
        kind: "moveCard",
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
        kind: "reorderCard",
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

describe("pin and unpin (ADR-0048 step 5)", () => {
  test("pin: your message to the top of the same thread's column, a move said in the column", () => {
    const s = state({ cards: [card(C1, atEnd)] })
    expect(plan(inColumn({ kind: "pin", card: C1 }, TRUNK_COLUMN), s)).toEqual([
      {
        kind: "moveCard",
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
      kind: "moveCard",
      move: { card: C1, from: pinnedKey, to: toNote },
    })
  })

  test("a fresh card has no thread to pin to; an unpin of a card not pinned is nothing", () => {
    const s = state({ cards: [card(C1, freshF1), card(C2, atEnd)] })
    expect(plan(inColumn({ kind: "pin", card: C1 }), s)).toEqual([])
    expect(
      plan(inColumn({ kind: "unpin", card: C2 }, TRUNK_COLUMN), s),
    ).toEqual([])
  })

  test("pin to the task: to the pins of the task it is in, else the one you are on; unpinned, to the notes nearest the task column (ADR-0116)", () => {
    const pinnedToTask = {
      kind: "task-pinned",
      task: TEST_TASK,
      order: "a",
    } as const
    const s = state({ cards: [card(C1, atEnd), card(C2, pinnedToTask)] })
    expect(
      plan(inColumn({ kind: "pinToTask", card: C1 }, TRUNK_COLUMN), s),
    ).toEqual([
      {
        kind: "moveCard",
        move: {
          card: C1,
          from: atEnd,
          to: { kind: "task-pinned", task: TEST_TASK },
        },
        how: { actedAt: { kind: "column", key: threadKey }, slot: null },
        queuedBy: null,
        fly: true,
        here: null,
      },
    ])
    // Pinned to it already: nothing.
    expect(plan(inColumn({ kind: "pinToTask", card: C2 }), s)).toEqual([])
    expect(plan(inColumn({ kind: "unpin", card: C2 }), s)[0]).toMatchObject({
      move: {
        card: C2,
        from: { kind: "task-pinned", task: TEST_TASK },
        to: { kind: "notes", near: "task", task: TEST_TASK },
      },
    })
    // A drop on the task column's pins pins there.
    expect(
      plan(
        {
          kind: "put",
          card: C1,
          target: { kind: "taskPinned", task: TEST_TASK },
        },
        state({ cards: [card(C1, inventory)], slots: { "3": C1 } }),
      )[0],
    ).toMatchObject({
      move: { card: C1, to: { kind: "task-pinned", task: TEST_TASK } },
      how: { actedAt: { kind: "column", key: TEST_TASK } },
    })
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
      slots: { "0": textCardId("x") },
    })
    const [keep] = plan(
      {
        kind: "keepFresh",
        column: { kind: "fresh", thread: F1 },
        cards: [C1, C2],
      },
      s,
    )
    expect(keep).toMatchObject({
      kind: "keep",
      moves: [
        { move: { card: C1, from: freshF1, to: inventory }, slot: 1 },
        { move: { card: C2, from: freshF1, to: inventory }, slot: 2 },
      ],
      actedAt: { kind: "column", key: F1 },
      close: [
        {
          kind: "layout",
          action: {
            kind: "view",
            change: { kind: "closeFresh", thread: F1 },
          },
        },
      ],
      here: null,
    })
  })

  test("a keep whose cards have all gone closes its column and sends no move", () => {
    const s = state({ cards: [], slots: {} })
    const effects = plan(
      {
        kind: "keepFresh",
        column: { kind: "fresh", thread: F1 },
        cards: [C1, C2],
      },
      s,
    )
    expect(effects).toHaveLength(1)
    expect(effects).toMatchObject([
      {
        kind: "layout",
        action: { kind: "view", change: { kind: "closeFresh", thread: F1 } },
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

  test("on a task: that task's history", () => {
    expect(plan(undo, state({}, onR1))).toEqual([
      { kind: "undoMoves", task: TEST_TASK, direction: "undo" },
    ])
  })

  test("in a new tab: the task it minted as it opened", () => {
    const newTab = layoutReducer(onR1, {
      kind: "newTab",
      key: NEW_THREAD,
      root: NEW_ROOT,
      task: NEW_TASK,
      asksAgent: false,
    })
    expect(
      plan({ ...undo, direction: "redo" } as Intent, state({}, newTab)),
    ).toEqual([{ kind: "undoMoves", task: NEW_TASK, direction: "redo" }])
  })

  test("with the inventory panel focused: this tab's swaps", () => {
    expect(plan({ ...undo, inPanel: true } as Intent, state())).toEqual([
      { kind: "undoSwap", direction: "undo" },
    ])
  })

  test("on nothing: nothing", () => {
    const nothing = layoutReducer(onR1, {
      kind: "show",
      here: { kind: "nothing" },
    })
    expect(plan(undo, state({}, nothing))).toEqual([])
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
          place: { kind: "queued", thread: TEST_THREAD, seen: "" },
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

  test("back in a fresh column the layout holds: its task shown, once for a keep's cards", () => {
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
        action: { kind: "show", here: { kind: "task", task: TEST_TASK } },
      },
      { kind: "list", act: { kind: "ensure", task: TEST_TASK } },
    ])
  })

  test("back in a fresh column it no longer holds: opened again, under the thread it minted, after the thread it forks from", () => {
    expect(
      answered({ kind: "undone", cards: [{ card: C1, place: freshF1 }] }),
    ).toEqual([
      {
        kind: "layout",
        action: { kind: "show", here: { kind: "task", task: TEST_TASK } },
      },
      { kind: "list", act: { kind: "ensure", task: TEST_TASK } },
      {
        kind: "layout",
        action: {
          kind: "view",
          task: TEST_TASK,
          first: threadOfEntry("1-r1"),
          change: { kind: "openFresh", thread: F1, at: A },
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
        actedAt: { kind: "column", key: F1 },
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
      from: pinnedKey,
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
  // The host names the move's history (ADR-0116): the page names none.
  const spun = {
    kind: "gone",
    why: { kind: "spun", into: NEW_ROOT, thread: NEW_THREAD },
  } as const
  test.each([
    [
      "a note dropped on a state: its thread there, sent with the task you are on",
      card(C1, note),
      { kind: "state", state: S1 },
      { from: noteKey, state: S1, sidebar: null, here: TEST_TASK },
    ],
    [
      "an inventory card dropped in the sidebar: placed before the task it was dropped on, sent with the new task, which you will be on",
      card(C1, { kind: "inventory", holder: ADA }),
      { kind: "sidebar", before: TEST_TASK },
      {
        from: inventory,
        state: null,
        sidebar: { before: TEST_TASK },
        here: NEW_TASK,
      },
    ],
    [
      "an inventory card dropped on a state, sent with the task you are on",
      card(C1, { kind: "inventory", holder: ADA }),
      { kind: "state", state: S1 },
      { from: inventory, state: S1, sidebar: null, here: TEST_TASK },
    ],
  ] as const)("%s", (_, c, target, want) => {
    expect(
      plan({ kind: "put", card: C1, target }, state({ cards: [c] })),
    ).toEqual([
      {
        kind: "spinOff",
        request: {
          kind: "spin-off",
          move: { card: C1, from: want.from, to: spun },
          task: NEW_TASK,
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
      plan(inColumn({ kind: "spinOff", card: C1, state: S1 }, TRUNK_COLUMN), s),
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

  test("afterSpinOff: a sidebar drop places and shows the new task once its first message is written; nothing else", () => {
    const sidebar = { before: TEST_TASK }
    expect(
      afterSpinOff({ kind: "appended", id: entryId("t-1") }, NEW_TASK, sidebar),
    ).toEqual([
      {
        kind: "list",
        act: { kind: "place", task: NEW_TASK, before: TEST_TASK },
      },
      {
        kind: "layout",
        action: { kind: "show", here: { kind: "task", task: NEW_TASK } },
      },
    ])
    expect(
      afterSpinOff({ kind: "appended", id: entryId("t-1") }, NEW_TASK, null),
    ).toEqual([])
    expect(
      afterSpinOff(
        { kind: "refused", code: "refused", message: "no" },
        NEW_TASK,
        sidebar,
      ),
    ).toEqual([])
  })
})

describe("a new note (ADR-0116)", () => {
  test("+ add a note makes an empty note at the end of its note column, said there", () => {
    expect(
      plan(
        inColumn({ kind: "newNote", card: C1, column: NOTES }, NOTES_COLUMN),
        state(),
      ),
    ).toEqual([
      {
        kind: "createCard",
        card: {
          kind: "text" as const,
          id: C1,
          owner: ADA,
          placer: ADA,
          place: { kind: "note", column: NOTES, order: LAST_ORDER },
          content: { command: null, unsent: null, origin: null },
        },
        text: "",
        how: { actedAt: { kind: "column", key: NOTES }, slot: null },
      },
    ])
  })
})
