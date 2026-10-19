import {
  BACK,
  type CanvasId,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  cardTextSource,
  DISCARDED,
  type EntryLike,
  entryId,
  entryMargin,
  type FactCard,
  fitsPlace,
  historyScope,
  INVENTORY_SLOTS,
  indexTree,
  KINDS,
  type Move,
  movesDocId,
  NO_CONTENT,
  type NoteColumnId,
  type Paste,
  PERSON_HISTORY,
  type PlacedKind,
  type ProposedChangesFact,
  placeKey,
  REORDER_PLACES,
  type ReferenceCard,
  type Replacing,
  type ResolvedMove,
  rootIdFor,
  type Sha256,
  type TextCard,
  type TextCardId,
  type TextPlace,
  type ThreadId,
  type TreeIndex,
  textCardId,
  threadIdFor,
  type WorkflowStateId,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import {
  cardIdFor,
  entriesById,
  FIXTURE_THREAD,
  withThreads,
} from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  cardsOnCanvas,
  indexCanvases,
  NO_CANVAS_INDEX,
} from "./canvas-index.ts"
import {
  cardEnd,
  decodeCard,
  encodeCard,
  pinnedCardsAtEnd,
  placeEnd,
  planCardSweep,
  yourCard,
} from "./card.ts"
import { sourceWords } from "./card-words.ts"
import type { Container, ContainerKind, MintContainer } from "./containers.ts"
import { factLine } from "./fact.ts"
import { landedThreadCard } from "./fixtures.ts"
import { planReorder, planSetCommand, planWidth, REORDERS } from "./in-place.ts"
import {
  crossesArchive,
  movesHistory,
  planHistorySweep,
  undoAnswer,
} from "./move-history.ts"
import {
  planFromTrash,
  planMove,
  planMoveCommand,
  planMoveRequest,
  planMoves,
  planMoveTargets,
  planPaste,
} from "./moves.ts"
import { nearestNoteColumn, notesNear, toNotes } from "./notes.ts"
import { orderAfter, orderKeys } from "./order.ts"
import { ownsPlace } from "./place-steps.ts"
import {
  blankQueued,
  canvasPinnedCards,
  isBlankMessage,
  planCarry,
  planFactCard,
  planNextQueuedCardPop,
  planUnqueueAll,
  planUnsent,
  type QueuedCard,
  type QueuedText,
  queuedOn,
} from "./queue.ts"

/** A minter whose note columns are `next`'s; a media column is "made". */
const noteMint =
  (next: () => NoteColumnId): MintContainer =>
  <K extends ContainerKind>(kind: K) =>
    (kind === "note-column"
      ? { kind: "note-column", id: next() }
      : { kind: "media", id: cardIdOfKind("media", "made") }) as Extract<
      Container,
      { readonly kind: K }
    >

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const _E1 = entryId("e1")
const E2 = entryId("e2")
const F1 = entryId("f1")
/** An entry of another margin than e2's. */
const E2_OTHER = entryId("e2-other")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  thread: FIXTURE_THREAD,
  type: "message",
  message: { role: "user", content: `text of ${id}` },
})
/**
 * e1 -> e2, with a branch e1 -> f1: thread `t-e1` is e1 and e2, thread `t-f1`
 * is f1, and each entry `more` adds that is no oldest child starts a thread
 * (`withThreads`).
 */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexTree(
    withThreads(
      entriesById([
        entry("e1", null),
        entry("e2", "e1"),
        entry("f1", "e1"),
        ...more,
      ]),
    ),
  )
/** The thread at e1 and e2 (`withThreads`): every fixture card's, unless it says. */
const T_E = threadIdFor("e1")
/** The canvas every fixture card's thread is in. */
const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const card = (over: Partial<TextCard> = {}): TextCard => ({
  kind: "text",
  id: cardIdFor("c1"),
  owner: ADA,
  placer: ADA,
  place: { kind: "composing", thread: T_E },
  content: { command: null, unsent: null, origin: null },
  ...over,
})
/** The note column the fixtures' notes are in. */
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)
/** A note in `NOTES`, as `card` is your message at e2. */
const note = (over: Partial<TextCard> = {}): TextCard =>
  card({ place: { kind: "note", column: NOTES, order: "a" }, ...over })
const LANE = threadIdFor("x")
const queuedPlace = {
  kind: "queued",
  thread: LANE,
  order: "m",
  by: ADA,
  seen: "",
} as const
const ACCEPTED: ProposedChangesFact = {
  kind: "accepted",
  lane: LANE,
  by: ADA,
  as: "kabcdefg",
  bookmark: "pinetrie-accepted",
  to: { kind: "accepted" },
}
const FACT_ID = cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f1")
/** A fact's card, queued as `queuedPlace` is, unless `over` says. */
const factCard = (over: Partial<FactCard> = {}): FactCard => ({
  kind: "fact",
  id: FACT_ID,
  owner: ADA,
  placer: ADA,
  place: queuedPlace,
  content: { fact: ACCEPTED },
  ...over,
})

describe("planCarry", () => {
  const queued = (command: CardCommand | null): QueuedText => ({
    ...card({ content: { command, unsent: null, origin: null } }),
    place: queuedPlace,
  })
  test.each([
    [
      "a catch-up with text",
      queued("get-latest"),
      "then test",
      { kind: "get-latest", command: "get-latest", after: "send" },
    ],
    [
      "a catch-up with none",
      queued("get-latest-from-parent"),
      "  ",
      {
        kind: "get-latest",
        command: "get-latest-from-parent",
        after: "discard",
      },
    ],
    [
      "a split, its text the brief",
      queued("split"),
      " tests apart ",
      { kind: "split", intent: "tests apart" },
    ],
    ["a message", queued(null), "hi", { kind: "send" }],
  ] as const)("%s", (_, c, text, plan) => {
    expect(planCarry(c, text)).toEqual({ ...plan, card: c })
  })

  test("a reference's quote is sent; one with none is skipped, not sent empty", () => {
    const reference: QueuedCard = {
      kind: "reference",
      id: cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e9"),
      owner: ADA,
      placer: ADA,
      place: queuedPlace,
      content: {
        address: { kind: "thread", thread: LANE },
        quote: "0".repeat(64) as Sha256,
      },
    }
    expect(planCarry(reference, "> said")).toEqual({
      kind: "send",
      card: reference,
    })
    expect(planCarry(reference, "  ")).toEqual({
      kind: "skip",
      card: reference,
    })
  })

  test("a fact is appended", () => {
    expect(planCarry(factCard(), "")).toEqual({ kind: "fact", fact: ACCEPTED })
  })

  test("a fact's move is refused as any card's to a place its kind is never in; it has no command to set", () => {
    const fact = factCard()
    expect(
      planMove(
        [fact],
        { card: fact.id, from: placeKey(fact.place), to: DISCARDED },
        ADA,
      ),
    ).toEqual({ kind: "refused", code: "no-place", now: fact })
    expect(
      planMove(
        [fact],
        {
          card: fact.id,
          from: placeKey(fact.place),
          to: { kind: "queued", thread: T_E, seen: "" },
        },
        ADA,
      ),
    ).toEqual({ kind: "refused", code: "no-place", now: fact })
    expect(planSetCommand([fact], fact.id, "get-latest")).toEqual({
      kind: "refused",
      code: "no-place",
      now: fact,
    })
  })

  test("planFactCard: a fact card, queued after the lane's last card, made by whoever acted, with no text to wait for", () => {
    const before = card({
      id: textCardId("ffffffff-0000-7000-8000-000000000000"),
      place: { ...queuedPlace, order: orderAfter([]) },
    })
    const [step] = planFactCard({
      cards: [before],
      id: FACT_ID,
      fact: ACCEPTED,
    }) ?? [undefined]
    expect(step?.kind === "write" && step.record).toEqual({
      kind: "fact",
      id: FACT_ID,
      owner: ADA,
      placer: ADA,
      place: {
        kind: "queued",
        thread: LANE,
        order: expect.any(String),
        by: ADA,
        seen: "",
      },
      content: { fact: ACCEPTED },
    })
    // After it, by its order: a tie would put it first by id.
    const order = (c: CardRecord | undefined) =>
      c !== undefined && "order" in c.place ? c.place.order : ""
    expect(
      order(step?.kind === "write" ? step.record : undefined) > order(before),
    ).toBe(true)
  })

  test("sourceWords: a text card's words are its document's, a fact's its line, a thread's none", () => {
    const docs = {
      doc: (id: TextCardId) => `text of ${id}`,
      blob: (sha: Sha256) => `quote ${sha}`,
    }
    expect(sourceWords(cardTextSource(card()), docs)).toBe(
      `text of ${card().id}`,
    )
    expect(sourceWords(cardTextSource(factCard()), docs)).toBe(
      factLine(ACCEPTED),
    )
    expect(
      sourceWords(
        cardTextSource(
          landedThreadCard({
            thread: LANE,
            canvas: TEST_CANVAS,
            by: ADA,
            cards: [],
          }),
        ),
        docs,
      ),
    ).toBe("")
  })

  test("sourceWords: a reference's words are its quote's blob", () => {
    const quote = "a".repeat(64) as Sha256
    expect(
      sourceWords(
        { kind: "blob", sha: quote },
        { doc: () => "", blob: sha => `quote ${sha}` },
      ),
    ).toBe(`quote ${quote}`)
  })

  test("the sweep keeps an empty fact card: its words are no document", () => {
    expect(
      planCardSweep({
        cards: [factCard()],
        texts: new Map(),
        stored: [],
        cardOfDoc: () => undefined,
      }).records,
    ).toEqual([])
  })
})
/** Your message at a thread not yet started: a thread with no entry. */
const unstartedPlace = (thread: string) =>
  ({ kind: "composing", thread: threadIdFor(thread) }) as const
const queued = (id: string, order: string, lane = LANE): QueuedText => ({
  ...card({ id: textCardId(id) }),
  place: {
    kind: "queued",
    thread: lane,
    order,
    by: BEA,
    seen: "",
  },
})
const pinned = (
  id: string,
  order: string,
  thread = T_E,
): TextCard & { readonly place: Extract<CardPlace, { kind: "pinned" }> } => ({
  ...card({ id: textCardId(id) }),
  place: { kind: "pinned", thread, order },
})

describe("where a card sits", () => {
  test("placeEnd: a queued, pinned or composing place is its thread's end", () => {
    expect(placeEnd({ thread: T_E }, tree())).toBe(E2)
    expect(placeEnd({ thread: threadIdFor("f1") }, tree())).toBe(F1)
    expect(placeEnd({ thread: threadIdFor("none") }, tree())).toBeNull()
    for (const place of [
      { kind: "composing", thread: T_E },
      { kind: "pinned", thread: T_E, order: "a" },
      { ...queuedPlace, thread: T_E },
    ] as const)
      expect(placeEnd(place, tree())).toBe(E2)
  })

  test("cardEnd follows its thread as the thread grows", () => {
    const grown = tree(entry("e3", "e2"), entry("e4", "e3"))
    expect(cardEnd(card(), grown)).toBe("e4")
  })

  test("cardEnd: a card follows its thread past a branch at its old end", () => {
    const onLane = card({
      place: {
        kind: "composing",
        thread: threadIdFor("e1"),
      },
    })
    // e3 continues the thread; g1, newer, is a branch.
    const forked = tree(entry("e3", "e2"), entry("g1", "e2"))
    expect(cardEnd(onLane, forked)).toBe("e3")
  })

  test("cardEnd: null for your message at a thread not yet started, and at a thread this index holds no entry of", () => {
    expect(cardEnd(card({ place: unstartedPlace("k-1") }), tree())).toBeNull()
    expect(
      cardEnd(
        card({ place: { kind: "composing", thread: threadIdFor("gone") } }),
        tree(),
      ),
    ).toBeNull()
  })

  test("yourCard: your message only, never a note of yours at the same end", () => {
    const mine = note({
      id: cardIdFor("c9"),
    })
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [card(), mine], tree())?.id,
    ).toBe(cardIdFor("c1"))
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [mine], tree()),
    ).toBeUndefined()
  })

  test("yourCard: by thread end, or by its thread before it starts, never another writer's", () => {
    const beas = card({
      id: cardIdFor("c2"),
      owner: BEA,
    })
    const unstarted = card({
      id: cardIdFor("c3"),
      place: unstartedPlace("k-1"),
    })
    const cards = [beas, card(), unstarted]
    const at = (where: Parameters<typeof yourCard>[1], me = ADA) =>
      yourCard(me, where, cards, tree())?.id
    expect(at({ kind: "end", end: entryId("e2") })).toBe(cardIdFor("c1"))
    expect(at({ kind: "end", end: entryId("e2") }, BEA)).toBe(cardIdFor("c2"))
    expect(at({ kind: "thread", thread: threadIdFor("k-1") })).toBe(
      cardIdFor("c3"),
    )
    expect(
      at({ kind: "thread", thread: threadIdFor("k-1") }, BEA),
    ).toBeUndefined()
    expect(at({ kind: "end", end: entryId("f1") })).toBeUndefined()
  })

  test("yourCard: of two of yours at one end, the newest, so an unqueued one does not take the composer", () => {
    const older = card({
      id: cardIdFor("c1"),
    })
    const newer = card({
      id: cardIdFor("c9"),
    })
    expect(
      yourCard(ADA, { kind: "end", end: entryId("e2") }, [newer, older], tree())
        ?.id,
    ).toBe(cardIdFor("c9"))
    expect(
      yourCard(ADA, { kind: "end", end: entryId("e2") }, [older, newer], tree())
        ?.id,
    ).toBe(cardIdFor("c9"))
  })

  test("cardEnd sees your message alone: a queued card is above the line", () => {
    const q = queued(cardIdFor("c2"), "a")
    // Its lane ends at e2, where it was queued: it is still no message there.
    expect(cardEnd(q, tree())).toBeNull()
    expect(cardEnd(note(), tree())).toBeNull()
  })
})

describe("note columns", () => {
  const T2 = threadIdFor("two")
  const keys = orderKeys(7)
  const K = (n: number) => keys[n] ?? ""
  const thread = (t: ThreadId, order: string) => ({
    ...landedThreadCard({ thread: t, canvas: TEST_CANVAS, by: ADA, cards: [] }),
    place: { kind: "canvas", canvas: TEST_CANVAS, order, width: 1 } as const,
  })
  const column = (id: string, order: string): CardRecord => ({
    kind: "note-column",
    id: cardIdOfKind("note-column", id),
    owner: ADA,
    placer: ADA,
    place: { kind: "canvas", canvas: TEST_CANVAS, order, width: 1 },
    content: NO_CONTENT,
  })
  const nearest = (cards: readonly CardRecord[], t = LANE) =>
    nearestNoteColumn(cardsOnCanvas(cards, TEST_CANVAS), t)
  const MADE = cardIdOfKind("note-column", "made")
  const C1 = cardIdFor("c1")

  test("nearestNoteColumn: the closest in the canvas's order, left or right; on a tie, the one after", () => {
    const left = column("l", K(1))
    const right = column("r", K(4))
    expect(
      nearest([left, thread(LANE, K(2)), thread(T2, K(3)), right]),
    ).toEqual({ kind: "column", column: left.id })
    expect(
      nearest([left, thread(T2, K(2)), thread(LANE, K(3)), right]),
    ).toEqual({ kind: "column", column: right.id })
    expect(nearest([left, thread(LANE, K(2)), right])).toEqual({
      kind: "column",
      column: right.id,
    })
  })

  test("nearestNoteColumn: with none, one is made just after the thread; a thread not on the canvas has none", () => {
    expect(nearest([thread(LANE, K(2)), thread(T2, K(4))])).toEqual({
      kind: "make",
      after: 0,
    })
    expect(nearest([thread(T2, K(2)), thread(LANE, K(4))])).toEqual({
      kind: "make",
      after: 1,
    })
    expect(nearest([thread(T2, K(2))])).toEqual({ kind: "none" })
  })

  test("notesNear decides, minting nothing: a column, one to make there, or the holder's inventory", () => {
    const cards = [thread(LANE, K(2)), column("l", K(3))]
    expect(
      notesNear(cards, { kind: "notes", near: "thread", thread: LANE }),
    ).toEqual({
      kind: "column",
      column: cardIdOfKind("note-column", "l"),
    })
    expect(
      notesNear([thread(LANE, K(2))], {
        kind: "notes",
        near: "thread",
        thread: LANE,
      }),
    ).toMatchObject({
      kind: "make",
      canvas: TEST_CANVAS,
      renumbered: [],
    })
    const held = {
      ...thread(LANE, K(2)),
      place: { kind: "inventory", holder: BEA } as const,
    }
    expect(
      notesNear([held], { kind: "notes", near: "thread", thread: LANE }),
    ).toEqual({
      kind: "inventory",
      holder: BEA,
    })
    expect(
      notesNear([], { kind: "notes", near: "thread", thread: LANE }),
    ).toBeNull()
  })

  test("a canvas's own nearest notes: its first note column, or one made before every card", () => {
    const toCanvas = {
      kind: "notes",
      near: "canvas",
      canvas: TEST_CANVAS,
    } as const
    expect(
      notesNear(
        [thread(LANE, K(2)), column("l", K(3)), column("r", K(5))],
        toCanvas,
      ),
    ).toEqual({ kind: "column", column: cardIdOfKind("note-column", "l") })
    const made = notesNear([thread(LANE, K(2)), thread(T2, K(4))], toCanvas)
    expect(made?.kind === "make" && made.order < K(2)).toBe(true)
    expect(nearestNoteColumn(cardsOnCanvas([], TEST_CANVAS), null)).toEqual({
      kind: "make",
      after: -1,
    })
  })

  test("notesNear: with no room after the thread's card, the crowded canvas cards are renumbered", () => {
    const tight = (Number.parseInt(K(2), 36) + 1).toString(36).padStart(10, "0")
    const near = notesNear([thread(LANE, K(2)), thread(T2, tight)], {
      kind: "notes",
      near: "thread",
      thread: LANE,
    })
    if (near?.kind !== "make") throw new Error(`not made: ${near?.kind}`)
    const order = (id: string) => {
      const moved = near.renumbered.find(c => c.id === id)?.place
      return moved?.kind === "canvas" ? moved.order : id === LANE ? K(2) : tight
    }
    expect(near.renumbered.length).toBeGreaterThan(0)
    expect(order(LANE) < near.order && near.order < order(T2)).toBe(true)
  })

  test("toNotes: where the canvas has no column, one is written first, its id minted then alone", () => {
    const n1 = card({
      id: cardIdFor("c5"),
      place: {
        kind: "note",
        column: cardIdOfKind("note-column", "l"),
        order: K(5),
      },
    })
    let minted = 0
    const newColumn = () => {
      minted++
      return MADE
    }
    const there = toNotes({
      cards: [thread(LANE, K(2)), column("l", K(3)), n1],
      to: { kind: "notes", near: "thread", thread: LANE },
      newContainer: noteMint(newColumn),
      by: BEA,
    })
    expect(there?.first).toEqual([])
    const order = there?.place.kind === "note" ? there.place.order : ""
    expect(order > K(5)).toBe(true)
    expect(minted).toBe(0)
    const made = toNotes({
      cards: [thread(LANE, K(2))],
      to: { kind: "notes", near: "thread", thread: LANE },
      newContainer: noteMint(newColumn),
      by: BEA,
    })
    expect(made?.first).toEqual([
      {
        kind: "write",
        record: {
          kind: "note-column",
          id: MADE,
          owner: BEA,
          placer: BEA,
          place: expect.objectContaining({
            kind: "canvas",
            canvas: TEST_CANVAS,
          }),
          content: NO_CONTENT,
        },
      },
    ])
    expect(made?.place).toMatchObject({ kind: "note", column: MADE })
    expect(minted).toBe(1)
  })

  test("planMoveTargets, notes: each move to a thread's notes to a column; a thread with no card, refused", () => {
    const cards = [
      thread(LANE, K(2)),
      queued(cardIdFor("c1"), "a"),
      queued(cardIdFor("c2"), "b"),
    ]
    let n = 0
    const resolved = planMoveTargets({
      cards,
      moves: planUnqueueAll(cards, LANE),
      sender: ADA,
      newContainer: noteMint(() => cardIdOfKind("note-column", `made-${++n}`)),
      entryThreads: new Map(),
    })
    if (resolved.kind !== "resolved") throw new Error(resolved.code)
    expect(
      resolved.first.map(s => (s.kind === "write" ? s.record.id : s.id)),
    ).toEqual([cardIdOfKind("note-column", "made-1")])
    expect(resolved.moves.map(m => m.to)).toEqual([
      { kind: "note", column: cardIdOfKind("note-column", "made-1") },
      { kind: "note", column: cardIdOfKind("note-column", "made-1") },
    ])
    const lost = queued(cardIdFor("c3"), "c")
    expect(
      planMoveTargets({
        cards: [lost],
        moves: planUnqueueAll([lost], LANE),
        sender: ADA,
        newContainer: noteMint(() => MADE),
        entryThreads: new Map(),
      }),
    ).toEqual({ kind: "refused", code: "no-place", now: lost })
  })

  test("planMoveTargets, a drop on a canvas: ranked just after the card it names", () => {
    const [x, y] = [thread(LANE, K(2)), thread(threadIdFor("y"), K(4))]
    const made = cardIdOfKind(
      "note-column",
      "01a0ffd2-0000-7000-8000-0000000000c1",
    )
    const drop = (after: CardId | null) => {
      const resolved = planMoveTargets({
        cards: [x, y],
        moves: [
          {
            card: made,
            from: null,
            to: { kind: "canvas-at", canvas: TEST_CANVAS, after },
          },
        ],
        sender: ADA,
        newContainer: noteMint(() => MADE),
        entryThreads: new Map(),
      })
      if (resolved.kind !== "resolved") throw new Error(resolved.code)
      return resolved.moves[0]?.to
    }
    const order = (to: ReturnType<typeof drop>) =>
      to?.kind === "canvas" ? to.order : ""
    const between = order(drop(LANE))
    expect(between > K(2) && between < K(4)).toBe(true)
    expect(order(drop(null)) < K(2)).toBe(true)
    expect(order(drop(threadIdFor("gone"))) > K(4)).toBe(true)
    // A canvas's key alone is ranked at its end: no card lands unranked.
    const plain = planMoveTargets({
      cards: [x, y],
      moves: [
        { card: made, from: null, to: { kind: "canvas", canvas: TEST_CANVAS } },
      ],
      sender: ADA,
      newContainer: noteMint(() => MADE),
      entryThreads: new Map(),
    })
    const atEnd =
      plain.kind === "resolved" && plain.moves[0]?.to.kind === "canvas"
        ? plain.moves[0].to.order
        : ""
    expect(atEnd > K(4)).toBe(true)
    planMove(
      [x],
      // @ts-expect-error: planMove takes a canvas only with its rank
      { card: made, from: null, to: { kind: "canvas", canvas: TEST_CANVAS } },
      ADA,
    )
    const { step } = planMoveRequest(
      [x, y],
      [
        {
          card: made,
          from: null,
          to: { kind: "canvas-at", canvas: TEST_CANVAS, after: LANE },
        },
      ],
      ADA,
      () => false,
      noteMint(() => MADE),
      new Map(),
    )
    expect(step).toMatchObject({
      kind: "steps",
      steps: [
        {
          kind: "write",
          record: {
            kind: "note-column",
            id: made,
            place: { kind: "canvas", canvas: TEST_CANVAS, order: between },
          },
        },
      ],
    })
  })

  test("planMoveRequest, a text card or a reference dropped on a canvas: the first note of a new column", () => {
    const [x, y] = [thread(LANE, K(2)), thread(threadIdFor("y"), K(4))]
    const inventory = { kind: "inventory", holder: ADA } as const
    const text = card({ place: inventory })
    const reference: ReferenceCard = {
      kind: "reference",
      id: cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000c2"),
      owner: ADA,
      placer: ADA,
      place: inventory,
      content: {
        address: { kind: "thread", thread: LANE },
        quote: "0".repeat(64) as Sha256,
      },
    }
    for (const c of [text, reference]) {
      const { step } = planMoveRequest(
        [x, y, c],
        [
          {
            card: c.id,
            from: inventory,
            to: { kind: "canvas-at", canvas: TEST_CANVAS, after: LANE },
          },
        ],
        ADA,
        () => false,
        noteMint(() => MADE),
        new Map(),
      )
      if (step.kind !== "steps") throw new Error(step.code)
      const [column, moved, ...rest] = step.steps.map(s =>
        s.kind === "write" ? s.record : null,
      )
      expect(rest).toEqual([])
      expect(column).toMatchObject({
        kind: "note-column",
        id: MADE,
        owner: ADA,
        place: { kind: "canvas", canvas: TEST_CANVAS },
      })
      const order = column?.place.kind === "canvas" ? column.place.order : ""
      expect(order > K(2) && order < K(4)).toBe(true)
      expect(moved).toMatchObject({
        id: c.id,
        placer: ADA,
        place: { kind: "note", column: MADE },
      })
    }
  })

  test("planMoveRequest: a column made for a move is written before the move, in one step", () => {
    const q = queued(cardIdFor("c1"), "a")
    const { step } = planMoveRequest(
      [thread(LANE, K(2)), q],
      planUnqueueAll([q], LANE),
      ADA,
      () => false,
      noteMint(() => MADE),
      new Map(),
    )
    expect(
      step.kind === "steps"
        ? step.steps.map(s => (s.kind === "write" ? s.record.place : null))
        : step,
    ).toEqual([
      expect.objectContaining({ kind: "canvas", canvas: TEST_CANVAS }),
      expect.objectContaining({ kind: "note", column: MADE }),
    ])
  })

  test("planMove takes no move to a thread's nearest notes: one is resolved first", () => {
    const unresolved = {
      card: C1,
      from: placeKey(note().place),
      to: { kind: "notes", near: "thread", thread: LANE },
    } as const
    // @ts-expect-error a thread's nearest notes are resolved before planning
    planMove([note()], unresolved, ADA)
  })

  test("a move into a note column lands at its end; a reorder moves a note among its column's own", () => {
    const n = (id: string, order: string, col = NOTES) =>
      card({
        id: cardIdFor(`c${id}`),
        place: { kind: "note", column: col, order },
      })
    const step = planMove(
      [
        card(),
        n("2", K(1)),
        n("3", K(6), cardIdOfKind("note-column", "other")),
      ],
      {
        card: C1,
        from: placeKey(card().place),
        to: { kind: "note", column: NOTES },
      },
      ADA,
    )
    const placed = step.kind === "write" ? step.record.place : null
    expect(placed?.kind === "note" && placed.order > K(1)).toBe(true)
    const notes = [n("1", K(0)), n("2", K(1)), n("3", K(2))]
    const moved = planReorder(notes, {
      card: cardIdFor("c3"),
      at: { kind: "note", column: NOTES },
      after: null,
      before: cardIdFor("c1"),
    })
    const order =
      moved.kind === "write" && moved.record.place.kind === "note"
        ? moved.record.place.order
        : ""
    expect(order < K(0)).toBe(true)
    // Not next to each other as its sender saw them: refused.
    expect(
      planReorder(notes, {
        card: cardIdFor("c3"),
        at: { kind: "note", column: NOTES },
        after: null,
        before: cardIdFor("c2"),
      }).kind,
    ).toBe("refused")
  })

  test("a comment goes to its margin's end, and reorders among that entry's comments alone", () => {
    const entry = entryId("e2")
    const at = {
      kind: "margin",
      on: entryMargin(LANE, entry),
      seen: "",
    } as const
    const c = (id: string, order: string, on = entry): TextCard =>
      card({
        id: cardIdFor(id),
        place: {
          kind: "margin",
          on: entryMargin(LANE, on),
          order,
          seen: "",
        },
      })
    const comments = [
      c("c1", K(0)),
      c("c2", K(1)),
      c("c3", K(2)),
      c("c4", K(6), E2_OTHER),
    ]
    const step = planMove(
      [card({ id: cardIdFor("c5") }), ...comments],
      { card: cardIdFor("c5"), from: placeKey(card().place), to: at },
      ADA,
    )
    const placed = step.kind === "write" ? step.record.place : null
    expect(
      placed?.kind === "margin" && placed.order > K(2) && placed.order < K(6),
    ).toBe(true)
    const moved = planReorder(comments, {
      card: cardIdFor("c3"),
      at,
      after: null,
      before: cardIdFor("c1"),
    })
    const order =
      moved.kind === "write" && moved.record.place.kind === "margin"
        ? moved.record.place.order
        : ""
    expect(order < K(0)).toBe(true)
    expect(
      planReorder(comments, {
        card: cardIdFor("c3"),
        at,
        after: null,
        before: cardIdFor("c2"),
      }).kind,
    ).toBe("refused")
    const into = (thread: ThreadId) =>
      planMoveTargets({
        cards: [card()],
        moves: [
          {
            card: C1,
            from: placeKey(card().place),
            to: { kind: "margin", on: entryMargin(thread, entry), seen: "" },
          },
        ],
        sender: ADA,
        newContainer: noteMint(() => MADE),
        entryThreads: new Map([[entry, LANE]]),
      }).kind
    expect(into(LANE)).toBe("resolved")
    expect(into(threadIdFor("y"))).toBe("refused")
  })

  test("a note column is made by a move onto a canvas, in its canvas's history; never into an inventory", () => {
    const id = cardIdOfKind(
      "note-column",
      "01a0ffd2-0000-7000-8000-0000000000c1",
    )
    const to = { kind: "canvas", canvas: TEST_CANVAS, order: "m" } as const
    expect(planMove([], { card: id, from: null, to }, ADA)).toMatchObject({
      kind: "write",
      record: { kind: "note-column", id, owner: ADA, place: to },
    })
    expect(
      planMove(
        [],
        { card: id, from: null, to: { kind: "inventory", holder: ADA } },
        ADA,
      ),
    ).toEqual({ kind: "refused", code: "no-place", now: null })
    // Moves from nowhere discard nothing: no canvas's index, and no canvas here.
    const none = { canvases: NO_CANVAS_INDEX, here: null }
    expect(
      movesHistory([{ card: id, from: null, to }], [], none, "move"),
    ).toEqual(historyScope(TEST_CANVAS))
    expect(
      movesHistory(
        [{ card: C1, from: null, to: { kind: "note", column: NOTES } }],
        [],
        none,
        "move",
      ),
    ).toBeNull()
  })

  test("a note and a note column round-trip through their stored form", () => {
    const n = note()
    expect(decodeCard(n.id, encodeCard(n))).toEqual(n)
    const col = column("01a0ffd2-0000-7000-8000-0000000000c2", K(1))
    expect(decodeCard(col.id, encodeCard(col))).toEqual(col)
    expect(
      decodeCard(col.id, {
        ...encodeCard(col),
        kind: "inventory",
        holder: ADA,
      }),
    ).toBeUndefined()
  })
})

describe("pinned cards", () => {
  test("pinnedCardsAtEnd: a thread's pinned cards by order, then id; not a sibling thread's, nor notes", () => {
    const cards = [
      pinned("p-3", "b"),
      pinned("p-1", "c"),
      pinned("p-2", "b"),
      pinned("p-4", "a", threadIdFor("f1")),
      card(),
    ]
    expect(pinnedCardsAtEnd(E2, cards, tree()).map(c => c.id)).toEqual([
      "p-2",
      "p-3",
      "p-1",
    ])
  })

  test("a pinned card follows its thread as the thread grows", () => {
    const grown = tree(entry("e3", "e2"))
    expect(
      pinnedCardsAtEnd(entryId("e3"), [pinned("p-1", "a")], grown).map(
        c => c.id,
      ),
    ).toEqual(["p-1"])
  })

  test("cardEnd and yourCard never return a pinned card at the same end", () => {
    const mine = pinned("p-9", "a")
    expect(cardEnd(mine, tree())).toBeNull()
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [card(), mine], tree())?.id,
    ).toBe(cardIdFor("c1"))
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [mine], tree()),
    ).toBeUndefined()
  })
})

describe("the queue", () => {
  test("queuedOn: a lane's queued cards by order key, then id; not another lane's, nor notes", () => {
    const other = threadIdFor("y")
    const cards = [
      queued(cardIdFor("c3"), "b"),
      queued(cardIdFor("c1"), "c"),
      queued(cardIdFor("c2"), "b"),
      queued(cardIdFor("c4"), "a", other),
      card({ id: cardIdFor("c5") }),
    ]
    expect(queuedOn(cards, LANE).map(c => c.id)).toEqual([
      cardIdFor("c2"),
      cardIdFor("c3"),
      cardIdFor("c1"),
    ])
  })

  test("queuedOn: a queued card of every kind KINDS queues", () => {
    const kinds = (Object.keys(KINDS) as PlacedKind[]).filter(k =>
      fitsPlace(k, "queued"),
    )
    const cards = kinds.map(
      (kind, n) =>
        ({
          kind,
          id: cardIdOfKind(kind, `01a0ffd2-0000-7000-8000-0000000000${n}8`),
          owner: ADA,
          placer: ADA,
          place: { ...queuedPlace, order: `a${n}` },
          content: {},
        }) as CardRecord,
    )
    expect(queuedOn(cards, LANE).map(c => c.kind)).toEqual(kinds)
  })

  test("orderAfter: fixed-width keys, each after every key in the queue", () => {
    const first = orderAfter([])
    const second = orderAfter([queued(cardIdFor("c1"), first)])
    const third = orderAfter([
      queued(cardIdFor("c2"), second),
      queued(cardIdFor("c1"), first),
    ])
    expect(first.length).toBe(second.length)
    expect(first < second && second < third).toBe(true)
  })

  const idle = {
    running: false,
    away: false,
    held: false,
    typing: new Set<CardId>(),
    blank: new Set<CardId>(),
  }

  test("planNextQueuedCardPop: nothing while the lane runs; else its top queued card", () => {
    const cards = [queued(cardIdFor("c2"), "b"), queued(cardIdFor("c1"), "a")]
    expect(
      planNextQueuedCardPop(cards, LANE, { ...idle, running: true }),
    ).toEqual({ kind: "idle" })
    expect(planNextQueuedCardPop(cards, LANE, idle)).toEqual({
      kind: "pop",
      card: cards[1],
    })
    expect(planNextQueuedCardPop(cards, threadIdFor("y"), idle)).toEqual({
      kind: "idle",
    })
  })

  test("planNextQueuedCardPop: a thread in an inventory pops no message, but a fact on top: it starts no run", () => {
    const top = queued(cardIdFor("c1"), "a")
    const away = { ...idle, away: true }
    expect(planNextQueuedCardPop([top], LANE, away)).toEqual({ kind: "idle" })
    const fact = factCard({ place: { ...queuedPlace, order: "0" } })
    expect(planNextQueuedCardPop([fact, top], LANE, away)).toEqual({
      kind: "pop",
      card: fact,
    })
    expect(
      planNextQueuedCardPop([fact, top], LANE, { ...away, running: true }),
    ).toEqual({ kind: "idle" })
  })

  test("planNextQueuedCardPop: a held queue pops no message, nor a card someone types in; a fact on top goes whatever", () => {
    const top = queued(cardIdFor("c1"), "a")
    const cards = [top, queued(cardIdFor("c2"), "b")]
    expect(planNextQueuedCardPop(cards, LANE, { ...idle, held: true })).toEqual(
      { kind: "held" },
    )
    expect(
      planNextQueuedCardPop(cards, LANE, {
        ...idle,
        typing: new Set([top.id]),
      }),
    ).toEqual({ kind: "typing", card: top })
    // Typing in the second card does not hold the first.
    expect(
      planNextQueuedCardPop(cards, LANE, {
        ...idle,
        typing: new Set([cardIdFor("c2")]),
      }),
    ).toEqual({ kind: "pop", card: top })
    const fact = factCard({ place: { ...queuedPlace, order: "0" } })
    expect(
      planNextQueuedCardPop([fact, ...cards], LANE, {
        ...idle,
        held: true,
        typing: new Set([fact.id]),
      }),
    ).toEqual({ kind: "pop", card: fact })
    expect(
      planNextQueuedCardPop([fact, ...cards], LANE, {
        ...idle,
        running: true,
      }),
    ).toEqual({ kind: "idle" })
  })

  describe("planNextQueuedCardPop passes over a blank message, which stays where it is", () => {
    const empty = queued(cardIdFor("c1"), "a")
    const next = queued(cardIdFor("c2"), "b")
    const fact = factCard({ place: { ...queuedPlace, order: "c" } })
    test.each([
      [
        "a blank top card with a card behind: the second pops",
        [empty, next],
        idle,
        { kind: "pop", card: next },
      ],
      [
        "blank alone: it waits to be written in",
        [empty],
        idle,
        { kind: "blank", card: empty },
      ],
      [
        "blank alone, held: held",
        [empty],
        { ...idle, held: true },
        { kind: "held" },
      ],
      [
        "a fact behind a blank card pops",
        [empty, fact],
        idle,
        { kind: "pop", card: fact },
      ],
      [
        "typing in the card behind a blank one: it waits for them",
        [empty, next],
        { ...idle, typing: new Set([next.id]) },
        { kind: "typing", card: next },
      ],
    ] as const)("%s", (_, cards, facts, step) => {
      expect(
        planNextQueuedCardPop(cards, LANE, {
          ...facts,
          blank: new Set([empty.id]),
        }),
      ).toEqual(step)
    })
    test.each([
      ["whitespace", null, " \n\t", true],
      ["text", null, "go", false],
      ["a command with no text", "split", "", false],
    ] as const)("isBlankMessage: %s is %s", (_, command, text, blank) => {
      expect(
        isBlankMessage(
          { ...empty, content: { command, unsent: null, origin: null } },
          text,
        ),
      ).toBe(blank)
    })
  })

  test("blankQueued: a queued message with no command and no text, as its queuer had it", () => {
    const empty = queued(cardIdFor("c1"), "a")
    const behind = {
      ...queued(cardIdFor("c2"), "b"),
      place: {
        ...queued(cardIdFor("c2"), "b").place,
        seen: "v-1",
      },
    }
    const command: QueuedCard = {
      ...queued(cardIdFor("c3"), "c"),
      content: { command: "split", unsent: null, origin: null },
    }
    const blank = blankQueued([empty, behind, command, card()], {
      holds: (_, seen) => seen === "",
      text: () => " ",
    })
    expect([...blank]).toEqual([empty.id])
  })

  test("planUnqueueAll: every message card queued on the lane, to the note column nearest its thread", () => {
    const fact = factCard({ place: { ...queuedPlace, order: "0" } })
    const cards = [
      queued(cardIdFor("c2"), "b"),
      fact,
      queued(cardIdFor("c1"), "a"),
      queued(cardIdFor("c3"), "c", threadIdFor("y")),
    ]
    expect(planUnqueueAll(cards, LANE)).toEqual(
      [cardIdFor("c1"), cardIdFor("c2")].map(id => ({
        card: textCardId(id),
        from: {
          kind: "queued",
          thread: LANE,
          seen: "",
        },
        to: { kind: "notes", near: "thread", thread: LANE },
      })),
    )
  })

  test("planUnsent: the whole record, a note in the column nearest its thread, saying why, its command and placer kept", () => {
    const q: QueuedCard = {
      ...queued(cardIdFor("c1"), "a"),
      placer: BEA,
      content: { command: "get-latest", unsent: null, origin: null },
    }
    const onCanvas = landedThreadCard({
      thread: LANE,
      canvas: TEST_CANVAS,
      by: ADA,
      cards: [],
    })
    const MADE = cardIdOfKind("note-column", "made")
    const plan = planUnsent({
      cards: [onCanvas, q],
      card: q,
      reason: "no such image",
      newContainer: noteMint(() => MADE),
    })
    expect(plan.hold).toBe(false)
    expect(plan.steps).toEqual([
      {
        kind: "write",
        record: expect.objectContaining({ kind: "note-column", id: MADE }),
      },
      {
        kind: "write",
        record: {
          ...q,
          place: { kind: "note", column: MADE, order: expect.any(String) },
          content: { ...q.content, unsent: "no such image" },
        },
      },
    ])
  })

  test("planUnsent: a thread in a full inventory keeps its card queued, saying why, and holds its queue", () => {
    const q = queued(cardIdFor("c1"), "a")
    const held = {
      ...landedThreadCard({
        thread: LANE,
        canvas: TEST_CANVAS,
        by: BEA,
        cards: [],
      }),
      place: { kind: "inventory", holder: BEA } as const,
    }
    const full = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, n) =>
      card({
        id: cardIdFor(`c1${String(n).padStart(2, "0")}`),
        place: { kind: "inventory", holder: BEA },
      }),
    )
    const newColumn = () => cardIdOfKind("note-column", "made")
    expect(
      planUnsent({
        cards: [held, q, ...full],
        card: q,
        reason: "r",
        newContainer: noteMint(newColumn),
      }),
    ).toEqual({
      steps: [
        {
          kind: "write",
          record: { ...q, content: { ...q.content, unsent: "r" } },
        },
      ],
      hold: true,
    })
    expect(
      planUnsent({
        cards: [held, q, ...full.slice(1)],
        card: q,
        reason: "r",
        newContainer: noteMint(newColumn),
      }).steps,
    ).toEqual([
      {
        kind: "write",
        record: {
          ...q,
          place: { kind: "inventory", holder: BEA },
          content: { ...q.content, unsent: "r" },
        },
      },
    ])
  })
})

describe("handoffs", () => {
  const C1 = cardIdFor("c1")
  const atEnd = {
    kind: "composing",
    thread: LANE,
  } as const
  const queuedKey = {
    kind: "queued",
    thread: LANE,
    seen: "",
  } as const

  test("a creation: the sender owns and placed it, with no command; refused when the id is in use", () => {
    expect(planMove([], { card: C1, from: null, to: atEnd }, BEA)).toEqual({
      kind: "write",
      record: {
        kind: "text",
        id: C1,
        owner: BEA,
        placer: BEA,
        place: atEnd,
        content: { command: null, unsent: null, origin: null },
      },
    })
    const taken = card()
    expect(planMove([taken], { card: C1, from: null, to: atEnd }, BEA)).toEqual(
      { kind: "refused", code: "exists", now: taken },
    )
  })

  test("the compare: gone when there is no record, moved when it is not where the sender saw it", () => {
    expect(planMove([], { card: C1, from: atEnd, to: queuedKey }, BEA)).toEqual(
      { kind: "refused", code: "gone", now: null },
    )
    const elsewhere = card({ place: unstartedPlace("k") })
    expect(
      planMove([elsewhere], { card: C1, from: atEnd, to: queuedKey }, BEA),
    ).toEqual({ kind: "refused", code: "moved", now: elsewhere })
  })

  test("queueing: after the lane's last card, queued and placed by the sender, why it was not sent cleared", () => {
    const before = queued(cardIdFor("c0"), orderAfter([]))
    const c = card({
      place: atEnd,
      content: { command: "get-latest", unsent: "refused", origin: null },
    })
    const step = planMove(
      [before, c],
      { card: C1, from: atEnd, to: queuedKey },
      BEA,
    )
    expect(step).toEqual({
      kind: "write",
      record: {
        ...c,
        place: { ...queuedKey, order: orderAfter([before]), by: BEA },
        placer: BEA,
        content: { ...c.content, unsent: null },
      },
    })
  })

  test("a reorder does not make another person's unqueue fail: the key leaves out the order", () => {
    const q = {
      ...queued(cardIdFor("c1"), "zz"),
      placer: ADA,
    }
    const step = planMove([q], { card: C1, from: queuedKey, to: atEnd }, BEA)
    expect(step).toEqual({
      kind: "write",
      record: { ...q, place: atEnd, placer: BEA },
    })
  })

  test("a move to where the card is is refused: a card changes its place in line by a reorder", () => {
    const q = {
      ...queued(cardIdFor("c1"), "a"),
      placer: ADA,
    }
    expect(
      planMove([q], { card: C1, from: queuedKey, to: queuedKey }, BEA),
    ).toEqual({ kind: "refused", code: "moved", now: q })
  })

  test("an unqueue keeps the command and why it was not sent", () => {
    const q = {
      ...queued(cardIdFor("c1"), "a"),
      content: { command: "get-latest", unsent: "x", origin: null },
    } as const
    const step = planMove([q], { card: C1, from: queuedKey, to: atEnd }, ADA)
    expect(step.kind === "write" && step.record).toMatchObject({
      content: { command: "get-latest", unsent: "x", origin: null },
    })
  })

  test("pinning: after every pinned card in the session, any thread's; placed by the sender, who need not own it", () => {
    const pinnedKey = {
      kind: "pinned",
      thread: LANE,
    } as const
    const elsewhere = pinned("p-1", orderAfter([]), threadIdFor("f1"))
    const c = card({ place: atEnd })
    expect(
      planMove([elsewhere, c], { card: C1, from: atEnd, to: pinnedKey }, BEA),
    ).toEqual({
      kind: "write",
      record: {
        ...c,
        place: { ...pinnedKey, order: orderAfter([elsewhere]) },
        placer: BEA,
      },
    })
  })

  test("unpinning goes below the line where it was pinned; a pinned card is not removed", () => {
    const p = card({
      place: {
        kind: "pinned",
        thread: LANE,
        order: "a",
      },
    })
    const from = {
      kind: "pinned",
      thread: LANE,
    } as const
    expect(planMove([p], { card: C1, from, to: atEnd }, BEA)).toEqual({
      kind: "write",
      record: { ...p, place: atEnd, placer: BEA },
    })
  })

  test.each([
    {
      name: "queued to pinned",
      place: queuedPlace,
      to: { kind: "pinned", thread: LANE },
      lands: { order: orderAfter([]) },
    },
    {
      name: "pinned to the queue",
      place: {
        kind: "pinned",
        thread: LANE,
        order: "a",
      },
      to: queuedKey,
      lands: { order: orderAfter([]), by: BEA },
    },
  ] as const)(
    "a card moves straight from $name (Move to ▸)",
    ({ place, to, lands }) => {
      const c = card({ place })
      expect(
        planMove([c], { card: C1, from: placeKey(place), to }, BEA),
      ).toEqual({
        kind: "write",
        record: { ...c, place: { ...to, ...lands }, placer: BEA },
      })
    },
  )

  describe("a discard", () => {
    const gone = (_: CardRecord["place"]) => DISCARDED
    test.each([
      ["your message", atEnd],
      [
        "a pinned card",
        {
          kind: "pinned",
          thread: LANE,
          order: "a",
        },
      ],
      [
        "a queued card",
        {
          kind: "queued",
          thread: LANE,
          order: "a",
          by: BEA,
          seen: "",
        },
      ],
    ] as const)(
      "of %s: in the trash, recording the place it left, its discarder its placer",
      (_, place) => {
        const c = card({ place })
        expect(
          planMove(
            [c],
            { card: C1, from: placeKey(place), to: gone(place) },
            ADA,
          ),
        ).toEqual({
          kind: "write",
          record: {
            ...c,
            place: { kind: "trash", left: place },
            placer: ADA,
          },
        })
      },
    )

    test("a gone card is moved by no handoff, and a popped one is gone", () => {
      const discarded = card({
        place: { kind: "trash", left: { kind: "inventory", holder: ADA } },
      })
      expect(
        planMove(
          [discarded],
          { card: C1, from: placeKey(discarded.place), to: atEnd },
          ADA,
        ),
      ).toEqual({ kind: "refused", code: "gone", now: null })
      expect(
        planMove([], { card: C1, from: atEnd, to: gone(card().place) }, ADA),
      ).toEqual({ kind: "refused", code: "gone", now: null })
    })
  })

  describe("inventories", () => {
    const mine = { kind: "inventory", holder: ADA } as const
    const beas = { kind: "inventory", holder: BEA } as const
    const full = (holder: typeof ADA) =>
      Array.from({ length: INVENTORY_SLOTS }, (_, n) =>
        card({
          id: textCardId(`held-${n}`),
          place: { kind: "inventory", holder },
        }),
      )

    test("a take into your own inventory keeps the card's owner, command and why it was not sent", () => {
      const c = card({
        owner: BEA,
        place: atEnd,
        content: { command: "get-latest", unsent: "x", origin: null },
      })
      expect(planMove([c], { card: C1, from: atEnd, to: mine }, ADA)).toEqual({
        kind: "write",
        record: { ...c, place: mine, placer: ADA },
      })
    })

    test("into or out of someone else's inventory is refused someone-elses", () => {
      const c = card({ place: atEnd })
      expect(planMove([c], { card: C1, from: atEnd, to: beas }, ADA)).toEqual({
        kind: "refused",
        code: "someone-elses",
        now: c,
      })
      const held = card({ place: beas })
      expect(
        planMove([held], { card: C1, from: beas, to: atEnd }, ADA),
      ).toEqual({ kind: "refused", code: "someone-elses", now: held })
      expect(planMove([], { card: C1, from: null, to: beas }, ADA)).toEqual({
        kind: "refused",
        code: "someone-elses",
        now: null,
      })
    })

    test("a card past the last slot is refused full, a creation too; another person's full inventory is not yours", () => {
      const c = card({ place: atEnd })
      expect(
        planMove([...full(ADA), c], { card: C1, from: atEnd, to: mine }, ADA),
      ).toEqual({ kind: "refused", code: "full", now: c })
      expect(
        planMove(full(ADA), { card: C1, from: null, to: mine }, ADA),
      ).toEqual({ kind: "refused", code: "full", now: null })
      expect(
        planMove([...full(BEA), c], { card: C1, from: atEnd, to: mine }, ADA)
          .kind,
      ).toBe("write")
      expect(
        planMove(full(ADA).slice(1), { card: C1, from: null, to: mine }, ADA)
          .kind,
      ).toBe("write")
    })

    test("a discard from your own inventory records that it left it; from someone else's, refused", () => {
      const held = card({ place: mine })
      const to = DISCARDED
      expect(planMove([held], { card: C1, from: mine, to }, ADA)).toMatchObject(
        {
          kind: "write",
          record: { place: { kind: "trash", left: mine } },
        },
      )
      expect(planMove([held], { card: C1, from: mine, to }, BEA)).toEqual({
        kind: "refused",
        code: "someone-elses",
        now: held,
      })
    })

    test("a key names its holder: Bea's inventory is not Ada's", () => {
      const held = card({ place: beas })
      expect(
        planMove([held], { card: C1, from: mine, to: atEnd }, ADA),
      ).toEqual({ kind: "refused", code: "moved", now: held })
    })

    test("ownsPlace: false only for someone else's inventory", () => {
      expect(ownsPlace(mine, ADA)).toBe(true)
      expect(ownsPlace(beas, ADA)).toBe(false)
      expect(ownsPlace(atEnd, ADA)).toBe(true)
      expect(ownsPlace(queuedKey, ADA)).toBe(true)
      expect(ownsPlace(unstartedPlace("k"), ADA)).toBe(true)
    })
  })

  test("planMoveCommand: the lanes to drain where a card ends queued on a lane not running", () => {
    const c = card({ place: atEnd })
    const move = { card: C1, from: atEnd, to: queuedKey } as const
    expect(planMoveCommand([c], [move], ADA, () => false).drain).toEqual([LANE])
    expect(planMoveCommand([c], [move], ADA, () => true).drain).toEqual([])
    expect(
      planMoveCommand([c], [{ ...move, to: atEnd }], ADA, () => false).drain,
    ).toEqual([])
    expect(planMoveCommand([], [move], ADA, () => false).drain).toEqual([])
  })

  describe("planMoves: several moves, accepted whole or refused", () => {
    const C2 = cardIdFor("c2")
    const C3 = cardIdFor("c3")
    const inv = { kind: "inventory", holder: ADA } as const
    const unstarted = unstartedPlace("k")
    const inUnstarted = (id: TextCardId) => card({ id, place: unstarted })

    test("two moves, the second refused: nothing written, the refusal naming its card", () => {
      const moved = card({ id: C2, place: atEnd })
      expect(
        planMoves(
          [inUnstarted(C1), moved],
          [
            { card: C1, from: unstarted, to: inv },
            { card: C2, from: unstarted, to: inv },
          ],
          ADA,
        ),
      ).toEqual({ kind: "refused", code: "moved", now: moved })
    })

    test("takes into an inventory with one free slot: full", () => {
      const held = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, n) =>
        card({ id: textCardId(`h-${n}`), place: inv }),
      )
      const step = planMoves(
        [...held, inUnstarted(C1), inUnstarted(C2)],
        [
          { card: C1, from: unstarted, to: inv },
          { card: C2, from: unstarted, to: inv },
        ],
        ADA,
      )
      expect(step).toMatchObject({ kind: "refused", code: "full" })
    })

    test("each move planned against the cards the earlier ones left", () => {
      // Created, then moved on: the second sees the first's card.
      const step = planMoves(
        [],
        [
          { card: C3, from: null, to: unstarted },
          { card: C3, from: unstarted, to: inv },
        ],
        ADA,
      )
      expect(step).toEqual({
        kind: "steps",
        steps: [
          { kind: "write", record: inUnstarted(C3) },
          { kind: "write", record: { ...inUnstarted(C3), place: inv } },
        ],
      })
    })
  })

  test("planSetCommand: sets it, the place and placer kept; gone when there is no record", () => {
    const c = card({ placer: BEA })
    expect(planSetCommand([c], C1, "get-latest")).toEqual({
      kind: "write",
      record: {
        ...c,
        content: { command: "get-latest", unsent: null, origin: null },
      },
    })
    expect(planSetCommand([], C1, null)).toEqual({
      kind: "refused",
      code: "gone",
      now: null,
    })
  })
})

test("planCardSweep: empty cards and documents with no record go; a card with text stays", () => {
  const empty = card({ id: cardIdFor("c2") })
  const ofDoc = (docId: string) =>
    docId.startsWith("card:") ? textCardId(docId.slice(5)) : undefined
  expect(
    planCardSweep({
      cards: [card(), empty],
      texts: new Map([
        [cardIdFor("c1"), "keep me"],
        [cardIdFor("c2"), ""],
      ]),
      stored: [
        `card:${cardIdFor("c1")}`,
        `card:${cardIdFor("c2")}`,
        "card:gone",
        "note:n-1",
      ],
      cardOfDoc: ofDoc,
    }),
  ).toEqual({
    records: [cardIdFor("c2")],
    docs: ["card:gone"],
  })
})

test("planCardSweep: a card with a command stays, whatever its text", () => {
  const command = card({
    content: { command: "get-latest", unsent: null, origin: null },
  })
  expect(
    planCardSweep({
      cards: [command],
      texts: new Map([[cardIdFor("c1"), ""]]),
      stored: [`card:${cardIdFor("c1")}`],
      cardOfDoc: d => textCardId(d.slice(5)),
    }),
  ).toEqual({ records: [], docs: [] })
})

describe("planReorder", () => {
  const key = (n: number) => n.toString(36).padStart(10, "0")
  const queuedAt = {
    kind: "queued",
    thread: LANE,
    seen: "",
  } as const
  const q = (id: string, n: number): QueuedText => ({
    ...queued(id, key(n)),
    placer: ADA,
    content: { command: null, unsent: "not sent: x", origin: null },
  })
  const orderIn = (step: ReturnType<typeof planReorder>, id: string) =>
    step.kind === "write" && step.record.id === id
      ? (step.record.place as { order: string }).order
      : null

  test("up and down: only the order changes, between the neighbours its sender saw", () => {
    const [a, b, c] = [
      q(cardIdFor("ca"), 100),
      q(cardIdFor("cb"), 200),
      q(cardIdFor("cc"), 300),
    ]
    const up = planReorder([a, b, c], {
      card: c.id,
      at: queuedAt,
      after: a.id,
      before: b.id,
    })
    expect(up).toEqual({
      kind: "write",
      record: { ...c, place: { ...c.place, order: key(150) } },
    })
    const down = planReorder([a, b, c], {
      card: a.id,
      at: queuedAt,
      after: c.id,
      before: null,
    })
    const order = orderIn(down, cardIdFor("ca"))
    expect(order !== null && order > key(300)).toBe(true)
    const first = planReorder([a, b, c], {
      card: b.id,
      at: queuedAt,
      after: null,
      before: a.id,
    })
    const top = orderIn(first, cardIdFor("cb"))
    expect(top !== null && top < key(100)).toBe(true)
  })

  test("refused: gone, a fact, moved, and neighbours no longer next to each other or out of order", () => {
    const [a, b, c] = [
      q(cardIdFor("ca"), 100),
      q(cardIdFor("cb"), 200),
      q(cardIdFor("cc"), 300),
    ]
    const at = queuedAt
    expect(
      planReorder([a, b], { card: c.id, at, after: null, before: a.id }),
    ).toEqual({ kind: "refused", code: "gone", now: null })
    const fact = factCard({ place: { ...queuedPlace, order: key(150) } })
    expect(
      planReorder([a, fact], { card: fact.id, at, after: null, before: a.id }),
    ).toMatchObject({ kind: "refused", code: "fact" })
    const drafted = card({
      id: c.id,
      place: {
        kind: "composing",
        thread: LANE,
      },
    })
    expect(
      planReorder([a, drafted], { card: c.id, at, after: null, before: a.id }),
    ).toEqual({ kind: "refused", code: "moved", now: drafted })
    // b sits between a and c now: the sender saw them next to each other.
    expect(
      planReorder([a, b, c, q(cardIdFor("cd"), 400)], {
        card: cardIdFor("cd") as CardId,
        at,
        after: a.id,
        before: c.id,
      }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    expect(
      planReorder([a, b, c], { card: c.id, at, after: b.id, before: a.id }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    expect(
      planReorder([a, c], { card: c.id, at, after: null, before: b.id }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    expect(
      planReorder([a, c], { card: c.id, at, after: null, before: null }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
  })

  test("a queued card never passes a fact, up or down", () => {
    const [a, c] = [q(cardIdFor("ca"), 100), q(cardIdFor("cc"), 300)]
    const fact = factCard({ place: { ...queuedPlace, order: key(200) } })
    expect(
      planReorder([a, fact, c], {
        card: c.id,
        at: queuedAt,
        after: null,
        before: a.id,
      }),
    ).toMatchObject({ kind: "refused", code: "fact" })
    expect(
      planReorder([a, fact, c], {
        card: a.id,
        at: queuedAt,
        after: c.id,
        before: null,
      }),
    ).toMatchObject({ kind: "refused", code: "fact" })
  })

  test("with no room, only the crowded siblings are written, and every card keeps its order", () => {
    const cards = [
      q(cardIdFor("ca"), 1000),
      q(cardIdFor("cb"), 1001),
      q(cardIdFor("cc"), 1002),
      q(cardIdFor("cd"), 9000),
    ]
    const step = planReorder(cards, {
      card: cardIdFor("cd"),
      at: queuedAt,
      after: cardIdFor("ca"),
      before: cardIdFor("cb"),
    })
    expect(step.kind).toBe("steps")
    const written = step.kind === "steps" ? step.steps : []
    const now = new Map<CardId, string>(
      cards.map(c => [c.id, (c.place as { order: string }).order] as const),
    )
    for (const w of written)
      if (w.kind === "write")
        now.set(w.record.id, (w.record.place as { order: string }).order)
    const ids = [...now].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(e => e[0])
    expect(ids).toEqual([
      cardIdFor("ca"),
      cardIdFor("cd"),
      cardIdFor("cb"),
      cardIdFor("cc"),
    ])
    expect(
      written.every(w => w.kind === "write" && w.record.placer === ADA),
    ).toBe(true)
  })

  test("pinned cards: neighbours among every pinned card, other threads' between them allowed", () => {
    const pinnedAt = {
      kind: "pinned",
      thread: T_E,
    } as const
    const [a, other, b, c] = [
      pinned("p-a", key(100)),
      pinned("p-o", key(200), threadIdFor("f1")),
      pinned("p-b", key(300)),
      pinned("p-c", key(400)),
    ]
    const step = planReorder([a, other, b, c], {
      card: c.id,
      at: pinnedAt,
      after: a.id,
      before: b.id,
    })
    expect(step).toEqual({
      kind: "write",
      record: { ...c, place: { ...c.place, order: key(200) } },
    })
  })
})

describe("a reorder on a canvas", () => {
  const key = (n: number) => n.toString(36).padStart(10, "0")
  const at = { kind: "canvas", canvas: TEST_CANVAS } as const
  const onCanvas = (
    id: string,
    n: number,
    width: 1 | 2 = 1,
    canvas = TEST_CANVAS,
  ): CardRecord => ({
    kind: "thread",
    id: threadIdFor(id),
    owner: ADA,
    placer: BEA,
    place: { kind: "canvas", canvas, order: key(n), width },
    content: NO_CONTENT,
  })
  const [a, b, c] = [
    onCanvas("a", 100),
    onCanvas("b", 200, 2),
    onCanvas("c", 300),
  ]

  test("a column's card moves among its canvas's cards: only its rank changes, its width and placer kept", () => {
    const moved = planReorder(
      [a, b, c, onCanvas("z", 150, 1, canvasIdFor("k-other"))],
      {
        card: b.id,
        at,
        after: c.id,
        before: null,
      },
    )
    expect(moved).toEqual({
      kind: "write",
      record: { ...b, place: { ...b.place, order: expect.any(String) } },
    })
    const order =
      moved.kind === "write" && "order" in moved.record.place
        ? moved.record.place.order
        : ""
    expect(order > key(300)).toBe(true)
    expect(moved.kind === "write" && moved.record.place).toMatchObject({
      width: 2,
    })
  })

  test("its neighbours must still be next to each other, as its sender saw them", () => {
    expect(
      planReorder([a, b, c], { card: c.id, at, after: null, before: b.id }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    // Another canvas's card is no neighbour here.
    expect(
      planReorder([a, b, c, onCanvas("z", 50, 1, canvasIdFor("k-other"))], {
        card: c.id,
        at,
        after: threadIdFor("z"),
        before: a.id,
      }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
  })

  test("planWidth: a card's width on its canvas, from where its sender saw it; its rank and placer kept", () => {
    expect(planWidth([a, b], { card: a.id, at, width: 2 })).toEqual({
      kind: "write",
      record: { ...a, place: { ...a.place, width: 2 } },
    })
    // The width it has: nothing to write.
    expect(planWidth([a, b], { card: b.id, at, width: 2 })).toBeNull()
    expect(planWidth([b], { card: a.id, at, width: 2 })).toEqual({
      kind: "refused",
      code: "gone",
      now: null,
    })
    // On another canvas than its sender saw, or on none.
    const elsewhere = onCanvas("a", 100, 1, canvasIdFor("k-other"))
    expect(planWidth([elsewhere], { card: a.id, at, width: 2 })).toMatchObject({
      kind: "refused",
      code: "moved",
    })
    const held: CardRecord = {
      ...a,
      kind: "thread",
      id: threadIdFor("a"),
      place: { kind: "inventory", holder: ADA },
    } as CardRecord
    expect(planWidth([held], { card: a.id, at, width: 2 })).toMatchObject({
      kind: "refused",
      code: "moved",
    })
  })

  test("every place a reorder moves among has its rule", () => {
    // @ts-expect-error: a place with no row does not compile
    const missing: typeof REORDERS = {
      queued: REORDERS.queued,
      pinned: REORDERS.pinned,
      note: REORDERS.note,
    }
    expect(Object.keys(REORDERS).sort()).toEqual([...REORDER_PLACES].sort())
    expect(missing).toBeDefined()
  })
})

describe("cards pinned to a canvas", () => {
  const key = (n: number) => n.toString(36).padStart(10, "0")
  const pinnedTo = (id: string, n: number, canvas = TEST_CANVAS): CardRecord =>
    card({
      id: cardIdFor(id),
      place: { kind: "canvas-pinned", canvas, order: key(n) },
    })
  const at = { kind: "canvas-pinned", canvas: TEST_CANVAS } as const

  test("a pin to the canvas goes after its other pins, and only its own", () => {
    const step = planMove(
      [
        card(),
        pinnedTo("c2", 100),
        pinnedTo("c3", 2 ** 30, canvasIdFor("k-other")),
      ],
      { card: cardIdFor("c1"), from: placeKey(card().place), to: at },
      BEA,
    )
    expect(step).toMatchObject({
      kind: "write",
      record: {
        placer: BEA,
        place: { kind: "canvas-pinned", canvas: TEST_CANVAS },
      },
    })
    const order =
      step.kind === "write" && step.record.place.kind === "canvas-pinned"
        ? step.record.place.order
        : ""
    expect(order > key(100) && order < key(2 ** 30)).toBe(true)
    expect(
      canvasPinnedCards(
        [pinnedTo("c3", 300), pinnedTo("c2", 100), card()],
        TEST_CANVAS,
      ).map(c => c.id),
    ).toEqual([cardIdFor("c2"), cardIdFor("c3")])
  })

  test("a reorder among the canvas's pins, the neighbours next to each other", () => {
    const [a, b, c] = [
      pinnedTo("ca", 100),
      pinnedTo("cb", 200),
      pinnedTo("cc", 300),
    ]
    const up = planReorder([a, b, c], {
      card: c.id,
      at,
      after: null,
      before: a.id,
    })
    expect(up.kind === "write" && up.record.place).toMatchObject({
      kind: "canvas-pinned",
    })
    expect(
      planReorder([a, b, c], { card: c.id, at, after: null, before: b.id }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
  })

  test("unpinned from the canvas, a card goes to its first note column, made first on the canvas when it has none", () => {
    const pin = pinnedTo("c1", 100)
    const onCanvas = landedThreadCard({
      thread: LANE,
      canvas: TEST_CANVAS,
      by: ADA,
      cards: [],
    })
    const made = cardIdOfKind(
      "note-column",
      "01a0ffd2-0000-7000-8000-0000000000c9",
    )
    const { step } = planMoveRequest(
      [pin, onCanvas],
      [
        {
          card: pin.id,
          from: at,
          to: { kind: "notes", near: "canvas", canvas: TEST_CANVAS },
        },
      ],
      ADA,
      () => false,
      noteMint(() => made),
      new Map(),
    )
    expect(step).toMatchObject({
      kind: "steps",
      steps: [
        { kind: "write", record: { kind: "note-column", id: made } },
        {
          kind: "write",
          record: { id: pin.id, place: { kind: "note", column: made } },
        },
      ],
    })
    const column =
      step.kind === "steps" && step.steps[0]?.kind === "write"
        ? step.steps[0].record.place
        : null
    const first = onCanvas.place.kind === "canvas" ? onCanvas.place.order : ""
    expect(column?.kind === "canvas" && column.order < first).toBe(true)
  })
})

describe("storage", () => {
  test("a record round-trips through its flat stored form", () => {
    const lane = threadIdFor("x")
    for (const c of [
      card(),
      card({
        place: {
          kind: "composing",
          thread: lane,
        },
      }),
      card({ place: unstartedPlace("k-1") }),
      card({ place: { kind: "inventory", holder: BEA } }),
      queued(cardIdFor("c2"), "k"),
      pinned(cardIdFor("c3"), "k"),
      card({
        place: {
          kind: "pinned",
          thread: lane,
          order: "m",
        },
      }),
      card({
        place: { kind: "canvas-pinned", canvas: TEST_CANVAS, order: "m" },
      }),
      card({
        content: {
          command: "get-latest",
          unsent: "refused",
          origin: null,
        },
      }),
      card({ placer: BEA }),
      factCard(),
    ])
      expect(
        decodeCard(c.id, JSON.parse(JSON.stringify(encodeCard(c)))),
      ).toEqual(c)
  })

  test("a malformed card is dropped, never thrown", () => {
    const C = cardIdFor("c1")
    const ok = encodeCard(card())
    // The id is a card's, so each case below fails for its own reason.
    expect(decodeCard(C, ok)).toEqual(card())
    // A pinned card needs its order.
    expect(decodeCard(C, { ...ok, kind: "pinned" })).toBeUndefined()
    // And its thread.
    expect(
      decodeCard(C, { ...ok, kind: "pinned", lane: "", order: "a" }),
    ).toBeUndefined()
    expect(decodeCard(C, { ...ok, kind: "fresh" })).toBeUndefined()
    expect(decodeCard(C, { ...ok, kind: "inventory" })).toBeUndefined()
    expect(decodeCard(C, { ...ok, owner: "" })).toBeUndefined()
    expect(decodeCard(C, { ...ok, placer: "" })).toBeUndefined()
    const { placer: _, ...noPlacer } = ok
    expect(decodeCard(C, noPlacer)).toBeUndefined()
    expect(decodeCard(C, null)).toBeUndefined()
    expect(decodeCard(C, { ...ok, command: "pull" })).toBeUndefined()
    // A fact on a text card's id, a fact this build cannot read, or a fact
    // with a command.
    const stored = encodeCard(factCard())
    expect(decodeCard(C, { ...ok, fact: stored.fact })).toBeUndefined()
    expect(decodeCard(FACT_ID, { ...stored, fact: "{" })).toBeUndefined()
    expect(
      decodeCard(FACT_ID, { ...stored, command: "get-latest" }),
    ).toBeUndefined()
    // A fact anywhere but a queue.
    expect(
      decodeCard(FACT_ID, {
        ...stored,
        ...encodeCard(card()),
        fact: stored.fact,
      }),
    ).toBeUndefined()
    expect(
      decodeCard(C, {
        ...ok,
        kind: "queued",
        thread: "lane:x",
        by: "p-bea",
        seen: "",
      }),
    ).toBeUndefined()
  })

  test("a card stored before facts is a message", () => {
    const { fact: _, ...before } = encodeCard(card())
    expect(decodeCard(cardIdFor("c1"), before)).toEqual(card())
  })

  test("a card at a thread's end must name its thread: one stored with no thread's id does not decode", () => {
    const id = cardIdFor("c1")
    expect(decodeCard(id, encodeCard(card()))).toEqual(card())
    const stored = { ...encodeCard(card()), at: "e2", lane: "main" }
    expect(decodeCard(id, stored)).toBeUndefined()
  })

  test("a card's kind is its id's: a thread's card decodes on a canvas, a text card there does not", () => {
    const onCanvas = landedThreadCard({
      thread: T_E,
      canvas: TEST_CANVAS,
      by: ADA,
      cards: [],
    })
    const stored = encodeCard(onCanvas)
    expect(decodeCard(T_E, stored)).toEqual(onCanvas)
    expect(decodeCard(cardIdFor("c1"), stored)).toBeUndefined()
    expect(decodeCard(T_E, encodeCard(card()))).toBeUndefined()
  })
})

describe("movesHistory: the canvas a move enters the sender's history in", () => {
  const C1 = cardIdFor("c1")
  const T_OTHER = threadIdFor("other")
  const OTHER_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000d")
  const inv = { kind: "inventory", holder: ADA } as const
  const draftingIn = (thread: ThreadId) =>
    ({ kind: "composing", thread }) as const
  const queuedIn = {
    kind: "queued",
    thread: T_E,
    seen: "",
  } as const
  // Thread `T_E` is on TEST_CANVAS, `T_OTHER` on OTHER_CANVAS.
  const threadCard = (thread: ThreadId, canvas: CanvasId): CardRecord =>
    landedThreadCard({ thread, canvas, by: ADA, cards: [] })
  const canvases = indexCanvases(
    [threadCard(T_E, TEST_CANVAS), threadCard(T_OTHER, OTHER_CANVAS)],
    new Map(),
  )
  const at = (place: TextPlace): CardRecord[] => [card({ place })]
  test.each<[string, Move[], CardRecord[], CanvasId | null]>([
    [
      "a take into the inventory: the canvas it left",
      [{ card: C1, from: draftingIn(T_E), to: inv }],
      at(draftingIn(T_E)),
      TEST_CANVAS,
    ],
    [
      "a put: the canvas it went to",
      [{ card: C1, from: inv, to: draftingIn(T_OTHER) }],
      at(inv),
      OTHER_CANVAS,
    ],
    [
      "a drag across canvases: the canvas it went to",
      [{ card: C1, from: draftingIn(T_E), to: draftingIn(T_OTHER) }],
      at(draftingIn(T_E)),
      OTHER_CANVAS,
    ],
    [
      "a queue: its thread's canvas",
      [{ card: C1, from: draftingIn(T_E), to: queuedIn }],
      at(draftingIn(T_E)),
      TEST_CANVAS,
    ],
    [
      "an unqueue: its thread's canvas",
      [{ card: C1, from: queuedIn, to: draftingIn(T_E) }],
      at({ ...queuedIn, order: "a", by: ADA }),
      TEST_CANVAS,
    ],
    [
      "a creation: none",
      [{ card: C1, from: null, to: draftingIn(T_E) }],
      [],
      null,
    ],
    [
      "a discard from an inventory: the canvas its sender is on",
      [{ card: C1, from: inv, to: DISCARDED }],
      at(inv),
      OTHER_CANVAS,
    ],
    [
      "a discard at a thread: the canvas it leaves, not its sender's",
      [{ card: C1, from: draftingIn(T_E), to: DISCARDED }],
      at(draftingIn(T_E)),
      TEST_CANVAS,
    ],
    [
      "between inventories: none",
      [{ card: C1, from: inv, to: inv }],
      at(inv),
      null,
    ],
    [
      "a card at a thread in no canvas: none",
      [{ card: C1, from: draftingIn(threadIdFor("nowhere")), to: inv }],
      at(draftingIn(threadIdFor("nowhere"))),
      null,
    ],
    // The start is the record's: the host accepts a move only from there.
    [
      "a take into the inventory, its start read from the record",
      [{ card: C1, from: inv, to: inv }],
      at(draftingIn(T_OTHER)),
      OTHER_CANVAS,
    ],
  ])("%s", (_, moves, cards, want) => {
    expect(
      movesHistory(moves, cards, { canvases, here: OTHER_CANVAS }, "move"),
    ).toEqual(want === null ? null : historyScope(want))
  })

  test("a discard from an inventory on no canvas: its sender's history outside any canvas", () => {
    const moves = [{ card: C1, from: inv, to: DISCARDED }]
    expect(
      movesHistory(moves, at(inv), { canvases, here: null }, "move"),
    ).toEqual(PERSON_HISTORY)
  })

  test("a paste's creation enters the history of the canvas it lands in; a move's enters none", () => {
    const made = (to: Move["to"]) => [{ card: C1, from: null, to }]
    const notes = { kind: "notes", near: "thread", thread: T_OTHER } as const
    expect(
      movesHistory(made(notes), [], { canvases, here: null }, "paste"),
    ).toEqual(historyScope(OTHER_CANVAS))
    expect(
      movesHistory(made(inv), [], { canvases, here: null }, "paste"),
    ).toEqual(PERSON_HISTORY)
    expect(
      movesHistory(made(notes), [], { canvases, here: null }, "move"),
    ).toBeNull()
  })
})

describe("undoAnswer", () => {
  const PLACES = "places"
  const part = (...ids: string[]) => ({
    docId: PLACES,
    footprint: ids.map(id => ["cards", id]),
  })
  const c1 = card()
  test("an undone step names each card it wrote and where it is now; a removed one has no place", () => {
    expect(
      undoAnswer(
        {
          kind: "undone",
          step: {
            parts: [
              part(cardIdFor("c1"), cardIdFor("c9")),
              { docId: "other", footprint: [["cards", "x"]] },
            ],
          },
        },
        [c1],
        PLACES,
      ),
    ).toEqual({
      kind: "undone",
      cards: [
        { card: c1.id, place: c1.place },
        {
          card: cardIdFor("c9"),
          place: null,
        },
      ],
    })
  })
  test("a refused step names the card that blocked it as it is now, and its placer; gone when it has none", () => {
    const moved = card({ placer: BEA })
    const refused = (stale: string) =>
      undoAnswer(
        {
          kind: "refused",
          step: { parts: [part(cardIdFor("c1"))] },
          stale: [part(stale)],
        },
        [moved],
        PLACES,
      )
    expect(refused(cardIdFor("c1"))).toEqual({
      kind: "refused",
      code: "moved",
      now: moved,
    })
    expect(refused(cardIdFor("c9"))).toEqual({
      kind: "refused",
      code: "gone",
      now: null,
    })
  })
  test("none is nothing", () => {
    expect(undoAnswer({ kind: "none" }, [c1], PLACES)).toEqual({
      kind: "nothing",
    })
  })
})

test("crossesArchive: a step whose canvas card last crossed the archive's edge is not undone", () => {
  const K = canvasIdFor("01a0ffd2-0000-7000-8000-000000000001")
  const [open, other, done] = ["o", "p", "x"].map(workflowStateIdFor) as [
    WorkflowStateId,
    WorkflowStateId,
    WorkflowStateId,
  ]
  const workflow = {
    open: [
      { id: open, name: "Open" },
      { id: other, name: "Other" },
    ],
    archive: { id: done, name: "Done" },
  }
  const moved = (from: WorkflowStateId, to: WorkflowStateId) =>
    new Map([
      [
        K,
        {
          card: K,
          events: [
            {
              kind: "moved" as const,
              by: ADA,
              from: { kind: "board" as const, state: from },
              to: { kind: "board" as const, state: to },
              at: 1,
            },
          ],
        },
      ],
    ])
  expect(crossesArchive([K], moved(open, done), workflow)).toBe(true)
  expect(crossesArchive([K], moved(done, open), workflow)).toBe(true)
  expect(crossesArchive([K], moved(open, other), workflow)).toBe(false)
  expect(crossesArchive([cardIdFor("c1")], moved(open, done), workflow)).toBe(
    false,
  )
  expect(crossesArchive([K], moved(open, done), null)).toBe(false)
})

describe("planHistorySweep", () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = 100 * DAY
  const K = (n: string) =>
    canvasIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`)
  const canvases = new Set([K("1"), K("2"), K("3"), K("4")])
  // A restored canvas (K3) and one never archived (K4) are in no state of it.
  const archived = new Map(
    (
      [
        [K("1"), 7 * DAY + 1000],
        [K("2"), 6 * DAY],
      ] as const
    ).map(
      ([canvas, ago]) => [canvas, { canvas, by: ADA, at: NOW - ago }] as const,
    ),
  )
  const doc = (canvas: CanvasId) => movesDocId(ADA, historyScope(canvas))
  const fromBefore = `moves:${ADA}:${TEST_ROOT}`
  const outside = movesDocId(ADA, PERSON_HISTORY)
  const stored = [K("1"), K("2"), K("3"), K("4"), K("5")].map(doc)
  const sweep = (startup: boolean) =>
    planHistorySweep({
      stored: [...stored, fromBefore, outside],
      canvases,
      archived,
      now: NOW,
      startup,
    })

  test("a canvas archived 7 days and a second ago is retired; one archived 6 days ago is not", () => {
    expect(sweep(false)).toEqual([doc(K("1"))])
  })
  test("at startup, a canvas the session does not hold is retired too", () => {
    expect(sweep(true)).toEqual([doc(K("1")), doc(K("5"))])
  })
})

describe("references", () => {
  const REF = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1")
  const NEW = textCardId("01a0ffd2-0000-7000-8000-0000000000e2")
  const address = {
    kind: "block",
    thread: T_E,
    entry: E2,
    block: { kind: "table", n: 0 },
  } as const
  const quote = "a".repeat(64) as Sha256
  const inv = { kind: "inventory", holder: ADA } as const
  const reference: ReferenceCard = {
    kind: "reference",
    id: REF,
    owner: ADA,
    placer: ADA,
    place: inv,
    content: { address, quote },
  }

  const paste = (
    cards: readonly CardRecord[],
    pasted: Paste,
    to: ResolvedMove["to"],
    replacing: Replacing | null = null,
    sender = ADA,
  ) =>
    planPaste(
      cards,
      pasted,
      {
        card: pasted.card,
        from: pasted.kind === "uncut" ? DISCARDED : null,
        to,
      },
      replacing,
      sender,
    )
  const asReference: Paste = { kind: "reference", card: REF, address, quote }
  const asText: Paste = { kind: "text", card: NEW, origin: address }
  /** `n` text cards in Ada's inventory, beside whatever else is there. */
  const filling = (n: number): readonly CardRecord[] =>
    Array.from({ length: n }, (_, i) =>
      card({
        id: textCardId(
          `01a0ffd2-0000-7000-8000-${String(i).padStart(12, "0")}`,
        ),
        place: inv,
      }),
    )

  test("planPaste makes a reference where it lands, through planMake; never on a canvas, never twice", () => {
    expect(paste([], asReference, inv)).toEqual({
      kind: "steps",
      steps: [{ kind: "write", record: reference }],
    })
    expect(
      paste([], asReference, {
        kind: "canvas",
        canvas: TEST_CANVAS,
        order: "a",
      }),
    ).toMatchObject({ kind: "refused", code: "no-place" })
    expect(paste([reference], asReference, inv)).toMatchObject({
      kind: "refused",
      code: "exists",
    })
  })

  test("planPaste makes a text card keeping its origin", () => {
    expect(paste([], asText, inv)).toEqual({
      kind: "steps",
      steps: [
        {
          kind: "write",
          record: {
            kind: "text",
            id: NEW,
            owner: ADA,
            placer: ADA,
            place: inv,
            content: { command: null, unsent: null, origin: address },
          },
        },
      ],
    })
  })

  test("an edit as text is a paste replacing its reference, in its very place", () => {
    const full = [reference, ...filling(INVENTORY_SLOTS - 1)]
    const step = paste(full, asText, inv, { card: REF, from: inv })
    expect(step).toMatchObject({
      kind: "steps",
      steps: [
        {
          kind: "write",
          record: { id: REF, place: { kind: "trash", left: inv } },
        },
        {
          kind: "write",
          record: { id: NEW, place: inv, content: { origin: address } },
        },
      ],
    })
    expect(
      paste([reference], asText, inv, {
        card: REF,
        from: { kind: "inventory", holder: BEA },
      }),
    ).toMatchObject({ kind: "refused" })
  })

  test("a paste into a full inventory with nothing replaced is refused full", () => {
    expect(paste(filling(INVENTORY_SLOTS), asReference, inv)).toMatchObject({
      kind: "refused",
      code: "full",
    })
  })

  test("a cut card moves out of its cutter's own trash; one in anyone else's is gone", () => {
    const trashed = (holder: WriterId) =>
      ({
        ...reference,
        placer: holder,
        place: { kind: "trash", left: { kind: "inventory", holder: BEA } },
      }) as const
    const uncut: Paste = { kind: "uncut", card: REF }
    expect(paste([trashed(ADA)], uncut, inv)).toMatchObject({
      kind: "steps",
      steps: [{ kind: "write", record: { id: REF, place: inv, placer: ADA } }],
    })
    expect(paste([trashed(BEA)], uncut, inv)).toMatchObject({
      kind: "refused",
      code: "gone",
    })
    expect(paste([reference], uncut, inv)).toMatchObject({
      kind: "refused",
      code: "gone",
    })
    expect(
      planMove([trashed(ADA)], { card: REF, from: DISCARDED, to: inv }, ADA),
    ).toMatchObject({ kind: "refused", code: "gone" })
  })

  test("a reference and a text card's origin round-trip through their stored form", () => {
    const edited: TextCard = card({
      content: { command: null, unsent: null, origin: address },
    })
    for (const c of [reference, edited] as const)
      expect(
        decodeCard(c.id, JSON.parse(JSON.stringify(encodeCard(c)))),
      ).toEqual(c)
    expect(
      decodeCard(REF, { ...encodeCard(reference), quote: "nope" }),
    ).toBeUndefined()
  })
})

describe("out of a trash: a restore back where the card was, and a new canvas", () => {
  const C1 = cardIdFor("c1")
  const COLUMN_PLACE = { kind: "note", column: NOTES, order: "q" } as const
  const columnCard: CardRecord = {
    kind: "note-column",
    id: NOTES,
    owner: ADA,
    placer: ADA,
    place: { kind: "canvas", canvas: TEST_CANVAS, order: "a", width: 1 },
    content: NO_CONTENT,
  }
  const trashed = (left: Parameters<typeof placeKey>[0], placer = ADA) =>
    card({
      placer,
      place: { kind: "trash", left: left as never },
    })
  const restore = (cards: readonly CardRecord[], sender = BEA) =>
    planMoveRequest(
      cards,
      [{ card: C1, from: DISCARDED, to: BACK }],
      sender,
      () => false,
      noteMint(() => NOTES),
      new Map(),
    ).step

  test("a note goes back to its column at its old rank, whoever trashed it", () => {
    expect(restore([columnCard, trashed(COLUMN_PLACE)])).toMatchObject({
      kind: "steps",
      steps: [
        {
          kind: "write",
          record: {
            id: C1,
            place: { kind: "note", column: NOTES },
            placer: BEA,
          },
        },
      ],
    })
  })

  test("refused: its column trashed or gone, someone else's message, or yours where you wrote anew", () => {
    const columnTrashed: CardRecord = {
      ...columnCard,
      place: {
        kind: "trash",
        left: { kind: "canvas", canvas: TEST_CANVAS, order: "a", width: 1 },
      },
    }
    expect(restore([columnTrashed, trashed(COLUMN_PLACE)])).toMatchObject({
      kind: "refused",
      code: "left-gone",
    })
    expect(restore([trashed(COLUMN_PLACE)])).toMatchObject({
      kind: "refused",
      code: "left-gone",
    })
    const mine = { kind: "composing", thread: T_E } as const
    const thread = landedThreadCard({
      thread: T_E,
      canvas: TEST_CANVAS,
      by: ADA,
      cards: [],
    })
    expect(restore([thread, trashed(mine)])).toMatchObject({
      kind: "refused",
      code: "someone-elses",
    })
    const newer = card({ id: cardIdFor("c2") })
    expect(restore([thread, trashed(mine), newer], ADA)).toMatchObject({
      kind: "refused",
      code: "left-taken",
    })
    expect(restore([thread, trashed(mine)], ADA)).toMatchObject({
      kind: "steps",
    })
  })

  test("a move from a trash anywhere but where it was is gone; an uncut goes anywhere, by its cutter alone", () => {
    const inBeas = trashed({ kind: "inventory", holder: BEA })
    expect(
      planMove(
        [inBeas],
        { card: C1, from: DISCARDED, to: { kind: "inventory", holder: ADA } },
        ADA,
      ),
    ).toMatchObject({ kind: "refused", code: "gone" })
    const to = { kind: "inventory", holder: ADA } as const
    expect(
      planFromTrash([inBeas], C1, ADA, { kind: "uncut", to }),
    ).toMatchObject({ kind: "write" })
    expect(
      planFromTrash([inBeas], C1, BEA, { kind: "uncut", to }),
    ).toMatchObject({ kind: "refused", code: "gone" })
  })

  test("a new canvas: its card at the end of the board's first state, first on its canvas, in one step", () => {
    const NEW = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000dd")
    const workflow = {
      open: [{ id: workflowStateIdFor("d"), name: "Doing" }],
      archive: { id: workflowStateIdFor("x"), name: "Done" },
    }
    const plan = (wf: typeof workflow | null) =>
      planMoveRequest(
        [columnCard],
        [
          {
            card: NOTES,
            from: { kind: "canvas", canvas: TEST_CANVAS },
            to: { kind: "new-canvas", canvas: NEW },
          },
        ],
        ADA,
        () => false,
        noteMint(() => NOTES),
        new Map(),
        wf,
      ).step
    expect(plan(workflow)).toMatchObject({
      kind: "steps",
      steps: [
        {
          kind: "write",
          record: { id: NEW, kind: "canvas", place: { kind: "board" } },
        },
        {
          kind: "write",
          record: { id: NOTES, place: { kind: "canvas", canvas: NEW } },
        },
      ],
    })
    expect(plan(null)).toMatchObject({ kind: "refused", code: "no-place" })
  })
})
