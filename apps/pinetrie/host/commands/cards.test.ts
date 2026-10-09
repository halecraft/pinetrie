import {
  atEntry,
  type CardCommand,
  type CardId,
  entryId,
  isTextCard,
  type MoveDirection,
  noteColumnIdFor,
  type QueueHoldChange,
  type QueueMove,
  type Reorder,
  ROOT,
  rootIdFor,
  runId,
  type TaskId,
  type TextCard,
  type ThreadId,
  taskIdFor,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readBoardPlaces,
  readCardHistories,
  readPlaces,
  readPlacesRev,
  readQueueHolds,
  readRoots,
  readTraces,
} from "@pinetrie/reads"
import {
  BOARD,
  QUEUE_HOLD,
  ROOT as ROOT_RECORD,
  setRecord,
  type UndoResult,
} from "@pinetrie/rules"
import { newPresenceDoc, readingKey, seatKey } from "@pinetrie/schema"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import {
  applyWrites,
  basics,
  NO_BLANK_CARDS,
  putNoteColumn,
  putTask,
  record,
  row,
  threadRow,
} from "../fakes.ts"
import { applyPlaceSteps } from "../places.ts"
import { createProvenance } from "../provenance.ts"
import { popNextQueuedCard } from "../queued-card-pop.ts"
import { tasksNow } from "../tasks.ts"
import { type CardCommandDeps, createCardCommands } from "./cards.ts"

const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = threadIdFor("0123456789abcdef")
const E1 = entryId("e-1")
const C1 = cardIdFor("c1")
/** A note column on the lane's task's canvas (`putNoteColumn`, ADR-0116). */
const NOTES = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
/** A note in it: a shared place, in the lane's task. */
const atEnd = { kind: "note", column: NOTES, order: "a" } as const
const noteKey = { kind: "note", column: NOTES } as const
/** Texts the host holds whole. */
const held = { textNow: () => "x", holds: () => true }
/** An idle lane, its queue not held, nobody typing. */
const idle = { running: false, held: false, typing: new Set<CardId>() }
const queuedKey = {
  kind: "queued",
  at: atEntry(E1),
  thread: LANE,
  seen: "",
} as const

/** The places' text cards: a task's thread card is the fixture's (`putTask`). */
const textsIn = (places: ReturnType<typeof setUp>["b"]["places"]) =>
  readPlaces(places).filter(isTextCard)

function setUp() {
  const b = basics()
  writeEntry(b.root, threadRow(E1, null, LANE))
  writeLaneTip(b.root, LANE, E1)
  // The lane's thread's card, on the task a move's history is in (ADR-0116).
  putTask(b, LANE, TEST_TASK)
  putNoteColumn(b, NOTES, TEST_TASK)
  // Each card's text as the host holds it.
  const texts = new Map<string, string>()
  const cards = record<CardCommandDeps["cards"]>({
    destroy: async () => {},
    hydrate: async () => {},
    blankQueued: NO_BLANK_CARDS.blankQueued,
    textNow: id => texts.get(id) ?? "",
  })
  const drains: string[] = []
  // Which history each move was recorded in; an undo answers `undoing`.
  let undoing: UndoResult = { kind: "none" }
  // What an undo writes before it answers, as Kyneta writes its revert.
  let reverting = () => {}
  const recorded: [string, string][] = []
  const histories = record<CardCommandDeps["histories"]>({
    gestureOf: async (writer, root) => write => {
      recorded.push([writer, root])
      return write()
    },
    step: async () => {
      reverting()
      return undoing as never
    },
    // The step an undo would try: the one it answers with.
    top: async () =>
      (undoing.kind === "none" ? undefined : undoing.step) as never,
    unloadTask: async () => {},
  })
  const presence = newPresenceDoc()
  const provenance = createProvenance({
    basics: b,
    presence,
    records: { writeValues: async writes => applyWrites(b, writes) },
  })
  const raw = createCardCommands({
    basics: b,
    cards: cards.port,
    drain: lane => void drains.push(lane),
    histories: histories.port,
    provenance,
    records: { writeValues: async writes => applyWrites(b, writes) },
  })
  // Each command gathers the task index once, as the dispatcher does.
  type Raw = typeof raw
  const commands = {
    ...raw,
    move: (w: WriterId, m: Parameters<Raw["move"]>[1], h: TaskId | null) =>
      raw.move(w, m, h, tasksNow(b)),
    queueCard: (
      w: WriterId,
      m: QueueMove,
      h: QueueHoldChange,
      c: CardCommand | null,
    ) => raw.queueCard(w, m, h, c, tasksNow(b)),
    reorder: (w: WriterId, r: Reorder) => raw.reorder(w, r, tasksNow(b)),
    unqueueAll: (w: WriterId, l: ThreadId) => raw.unqueueAll(w, l, tasksNow(b)),
    undoMove: (w: WriterId, t: TaskId, d: MoveDirection) =>
      raw.undoMove(w, t, d, tasksNow(b)),
    spinOff: (
      w: WriterId,
      r: Parameters<Raw["spinOff"]>[1],
      start: Parameters<Raw["spinOff"]>[2],
    ) => raw.spinOff(w, r, start, tasksNow(b)),
  }
  const undoes = (result: UndoResult, revert: () => void = () => {}) => {
    undoing = result
    reverting = revert
  }
  const put = (over: Partial<TextCard> = {}) =>
    applyPlaceSteps(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: C1,
          owner: ADA,
          placer: ADA,
          place: atEnd,
          carries: { kind: "message", command: null },
          unsent: null,
          ...over,
        },
      },
    ])
  return {
    b,
    cards,
    texts,
    drains,
    commands,
    put,
    histories,
    undoes,
    recorded,
    presence,
  }
}

describe("moves on the documents' keeper: the next queued card's pop and an unqueue in either order (ADR-0059)", () => {
  test("a queue on an idle lane asks for its drain, and answers with the rev of its write", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    const done = await commands.move(
      BEA,
      [
        {
          card: C1,
          from: atEnd,
          to: queuedKey,
        },
      ],
      null,
    )
    expect(done).toEqual({ outcome: { kind: "moved" }, rev: 4 })
    expect(drains).toEqual([LANE])
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      by: BEA,
    })
  })

  test("the pop, then an unqueue: answered gone, with the current rev", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    const top = popNextQueuedCard(b.places, LANE, idle, held)
    expect(top.kind === "popped" ? top.popped.card.id : top.kind).toBe(C1)
    const done = await commands.move(
      ADA,
      [
        {
          card: C1,
          from: queuedKey,
          to: atEnd,
        },
      ],
      null,
    )
    expect(done).toEqual({
      outcome: { kind: "unmoved", code: "gone", place: null, by: null },
      rev: readPlacesRev(b.places),
    })
  })

  test("an unqueue, then the pop: nothing is popped", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    await commands.move(ADA, [{ card: C1, from: queuedKey, to: atEnd }], null)
    expect(popNextQueuedCard(b.places, LANE, idle, held).kind).toBe("idle")
  })

  test("a move someone else made first: answered moved, naming them", async () => {
    const { commands, put } = setUp()
    put({ place: { ...queuedKey, order: "a", by: BEA }, placer: BEA })
    const done = await commands.move(
      ADA,
      [
        {
          card: C1,
          from: atEnd,
          to: queuedKey,
        },
      ],
      null,
    )
    expect(done.outcome).toEqual({
      kind: "unmoved",
      code: "moved",
      place: queuedKey,
      by: BEA,
    })
  })

  test("the host names a discard's history: from your inventory, the task you are on, whatever task you are on when it leaves a thread (ADR-0116)", async () => {
    const elsewhere = taskIdFor("01a0ffd2-0000-7000-8000-0000000000ee")
    const gone = { kind: "gone", why: { kind: "discarded" } } as const
    const mine = { kind: "inventory", holder: ADA } as const
    const held = setUp()
    held.put({ place: mine })
    await held.commands.move(
      ADA,
      [{ card: C1, from: mine, to: gone }],
      elsewhere,
    )
    expect(textsIn(held.b.places)[0]?.place).toMatchObject({ task: elsewhere })
    expect(held.recorded).toEqual([[ADA, elsewhere]])
    const atThread = setUp()
    atThread.put()
    await atThread.commands.move(
      ADA,
      [{ card: C1, from: atEnd, to: gone }],
      elsewhere,
    )
    expect(textsIn(atThread.b.places)[0]?.place).toMatchObject({
      task: TEST_TASK,
    })
    expect(atThread.recorded).toEqual([[ADA, TEST_TASK]])
  })

  test("a discard keeps the card, gone, in the discarder's history of its task: no text is destroyed, and its placer gets a trace", async () => {
    const { b, cards, commands, put, recorded } = setUp()
    put({ placer: BEA })
    const gone = { kind: "gone", why: { kind: "discarded" } } as const
    expect(
      (await commands.move(ADA, [{ card: C1, from: atEnd, to: gone }], null))
        .outcome,
    ).toEqual({ kind: "moved" })
    expect(textsIn(b.places).map(c => c.place)).toEqual([
      { ...gone, task: TEST_TASK, by: ADA },
    ])
    expect(cards.calls).toEqual([])
    expect(recorded).toEqual([[ADA, TEST_TASK]])
    expect([...readTraces(b.session).values()]).toMatchObject([
      { for: BEA, by: ADA, from: noteKey },
    ])
  })
})

describe("queue-card (ADR-0113)", () => {
  test("release: the card queued last and the hold gone in one step, then the lane drained", async () => {
    const { b, commands, put, drains, recorded } = setUp()
    put()
    applyWrites(b, [setRecord(QUEUE_HOLD, { lane: LANE, by: BEA, at: 1 })])
    const done = await commands.queueCard(
      ADA,
      { card: C1, from: atEnd, to: queuedKey },
      "release",
      null,
    )
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readQueueHolds(b.session).has(LANE)).toBe(false)
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      by: ADA,
    })
    expect(drains).toEqual([LANE])
    expect(recorded).toEqual([[ADA, TEST_TASK]])
  })

  test("hold-if-idle holds an idle queue before the drain; a refused move changes no hold", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.queueCard(
      ADA,
      { card: C1, from: atEnd, to: queuedKey },
      "hold-if-idle",
      null,
    )
    expect(readQueueHolds(b.session).get(LANE)?.by).toBe(ADA)
    const other = setUp()
    const refused = await other.commands.queueCard(
      ADA,
      { card: C1, from: atEnd, to: queuedKey },
      "hold-if-idle",
      null,
    )
    expect(refused.outcome).toMatchObject({ kind: "unmoved", code: "gone" })
    expect(readQueueHolds(other.b.session).size).toBe(0)
  })
})

test("a card made in the queue is written there with its command, never in another place, and drains", async () => {
  const { b, commands, drains, recorded } = setUp()
  const done = await commands.queueCard(
    ADA,
    { card: C1, from: null, to: queuedKey },
    "keep",
    "bring-up-to-date",
  )
  expect(done.outcome).toEqual({ kind: "moved" })
  expect(textsIn(b.places)).toMatchObject([
    {
      kind: "text" as const,
      id: C1,
      place: { kind: "queued", by: ADA },
      carries: { kind: "message", command: "bring-up-to-date" },
    },
  ])
  expect(drains).toEqual([LANE])
  expect(recorded).toEqual([])
})

describe("moves' history (ADR-0066)", () => {
  const inventory = { kind: "inventory", holder: ADA } as const

  test("a take into the inventory is one step of the taker's history in the root it left; a creation is in none", async () => {
    const { commands, put, recorded } = setUp()
    put()
    await commands.move(ADA, [{ card: C1, from: atEnd, to: inventory }], null)
    await commands.move(
      ADA,
      [
        {
          card: cardIdFor("c2"),
          from: null,
          to: inventory,
        },
      ],
      null,
    )
    expect(recorded).toEqual([[ADA, TEST_TASK]])
  })

  test("several moves are one, refused whole: nothing written when one has moved", async () => {
    const { b, commands, put } = setUp()
    const fresh = {
      kind: "fresh",
      column: "k",
      root: TEST_ROOT,
      task: TEST_TASK,
      at: ROOT,
    } as const
    put({ place: fresh })
    const before = textsIn(b.places)
    const done = await commands.move(
      ADA,
      [
        { card: C1, from: fresh, to: inventory },
        {
          card: cardIdFor("c9"),
          from: fresh,
          to: inventory,
        },
      ],
      null,
    )
    expect(done.outcome).toMatchObject({ kind: "unmoved", code: "gone" })
    expect(textsIn(b.places)).toEqual(before)
  })

  test("an undo answers each card it moved and where it is now, with a rev raised after it", async () => {
    const { b, commands, put, histories, undoes } = setUp()
    put()
    const rev = readPlacesRev(b.places)
    undoes({
      kind: "undone",
      step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
    })
    const done = await commands.undoMove(ADA, TEST_TASK, "undo")
    expect(done).toEqual({
      outcome: { kind: "undone", cards: [{ card: C1, place: noteKey }] },
      rev: rev + 1,
    })
    expect(histories.calls.at(-1)?.args).toEqual([ADA, TEST_TASK, "undo"])
  })

  test("a refused undo names who moved the card; one with nothing to undo is nothing", async () => {
    const { commands, put, undoes } = setUp()
    put({ placer: BEA })
    const part = { docId: PLACES_DOC_ID, footprint: [["cards", C1]] }
    undoes({ kind: "refused", step: { parts: [part] }, stale: [part] })
    expect((await commands.undoMove(ADA, TEST_TASK, "undo")).outcome).toEqual({
      kind: "unmoved",
      code: "moved",
      place: noteKey,
      by: BEA,
    })
    undoes({ kind: "none" })
    expect(await commands.undoMove(ADA, TEST_TASK, "redo")).toEqual({
      outcome: { kind: "nothing" },
      rev: null,
    })
  })
})

describe("reorders and unqueue all (ADR-0048 step 7)", () => {
  const queuedAt = (order: string) => ({ ...queuedKey, order, by: BEA })

  test("a reorder writes only the card's order, in the sender's history of its root, with the rev; it drains nothing", async () => {
    const { b, commands, put, recorded, drains } = setUp()
    put({ place: queuedAt("0000000100"), placer: BEA })
    applyPlaceSteps(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: cardIdFor("c2"),
          owner: ADA,
          placer: ADA,
          place: queuedAt("0000000300"),
          carries: { kind: "message", command: null },
          unsent: null,
        },
      },
    ])
    const done = await commands.reorder(ADA, {
      card: cardIdFor("c2"),
      at: queuedKey,
      after: null,
      before: C1,
    })
    expect(done).toEqual({
      outcome: { kind: "moved" },
      rev: readPlacesRev(b.places),
    })
    expect(recorded).toEqual([[ADA, TEST_TASK]])
    expect(drains).toEqual([])
    const order = textsIn(b.places).map(c => c.id)
    const queue = textsIn(b.places)
      .filter(c => c.place.kind === "queued")
      .sort((x, y) =>
        (x.place as { order: string }).order <
        (y.place as { order: string }).order
          ? -1
          : 1,
      )
      .map(c => c.id)
    expect(order).toHaveLength(2)
    expect(queue).toEqual([cardIdFor("c2"), C1])
  })

  test("unqueue all: every queued card below the line in one step of the sender's history; with none queued, nothing", async () => {
    const { b, commands, put, recorded } = setUp()
    expect(await commands.unqueueAll(ADA, LANE)).toEqual({
      outcome: { kind: "nothing" },
      rev: null,
    })
    put({ place: queuedAt("a") })
    applyPlaceSteps(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: cardIdFor("c2"),
          owner: BEA,
          placer: BEA,
          place: queuedAt("b"),
          carries: { kind: "message", command: null },
          unsent: null,
        },
      },
    ])
    const done = await commands.unqueueAll(ADA, LANE)
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(textsIn(b.places).map(c => c.place.kind)).toEqual(["note", "note"])
    expect(recorded).toEqual([[ADA, TEST_TASK]])
  })
})

describe("a chat from a card that found its lane busy", () => {
  const chat = {
    text: "@bob look",
    root: TEST_ROOT,
    at: { kind: "end", thread: LANE, seen: E1 },
    asksAgent: false,
    mentions: [],
    card: { id: C1, seen: "" },
    pinned: [],
    base: null,
    state: null,
  } as const

  test("its card is queued behind the others in the same step, and answered queued with the rev", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    beginRun(b.live, LANE, runId("r-1"))
    const done = await commands.queueBusy(ADA, chat)
    expect(done).toEqual({ outcome: { kind: "queued" }, rev: 4 })
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      thread: LANE,
      by: ADA,
    })
    // The lane runs: its end drains it.
    expect(drains).toEqual([])
  })

  test("a card the host does not hold stays a busy answer", async () => {
    const { b, commands } = setUp()
    beginRun(b.live, LANE, runId("r-1"))
    expect(await commands.queueBusy(ADA, chat)).toBeNull()
  })
})

test("setCommand: the command set, its place and placer kept", async () => {
  const { b, commands, put } = setUp()
  put({ placer: BEA })
  const done = await commands.setCommand(C1, "bring-up-to-date")
  expect(done).toEqual({ outcome: { kind: "moved" }, rev: 4 })
  expect(textsIn(b.places)[0]).toMatchObject({
    carries: { kind: "message", command: "bring-up-to-date" },
    placer: BEA,
    place: atEnd,
  })
})

const sentChat = {
  text: "hi",
  root: TEST_ROOT,
  at: { kind: "end", thread: LANE, seen: E1 },
  asksAgent: false,
  mentions: [],
  card: { id: C1, seen: "" },
  pinned: [],
  base: null,
  state: null,
} as const

test("spend: the record goes, then its text; a card already gone answers the current rev", async () => {
  const { b, cards, commands, put } = setUp()
  put()
  const sent = { sendId: "s-1", chat: sentChat }
  expect(await commands.spend(ADA, C1, sent)).toBe(4)
  expect(await commands.spend(ADA, C1, sent)).toBe(4)
  expect(textsIn(b.places)).toEqual([])
  expect(cards.calls.map(c => c.method)).toEqual(["destroy", "destroy"])
})

test("spend: a fresh column's first send leaves its other cards notes at the new message, in one step", async () => {
  const { b, commands, put } = setUp()
  const fresh = {
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    task: TEST_TASK,
    at: ROOT,
  } as const
  put({ place: fresh })
  const C2 = cardIdFor("c2")
  const C3 = cardIdFor("c3")
  put({ id: C2, owner: BEA, placer: BEA, place: fresh })
  put({
    id: C3,
    place: {
      kind: "fresh",
      column: "other",
      root: TEST_ROOT,
      task: TEST_TASK,
      at: ROOT,
    } as const,
  })
  const sent = entryId("e-2")
  writeEntry(
    b.root,
    row(sent, E1, { role: "user", content: "hi", sendId: "s-1" }),
  )
  // A fresh column's first send starts its thread: a branch, with no lane,
  // its card on the task's canvas, after the note column.
  putTask(b, threadIdFor("new"), TEST_TASK)
  const rev = await commands.spend(ADA, C1, {
    sendId: "s-1",
    chat: {
      ...sentChat,
      at: {
        kind: "branch",
        thread: threadIdFor("new"),
        at: E1,
        task: TEST_TASK,
      },
    },
  })
  expect(rev).toBe(readPlacesRev(b.places))
  expect(textsIn(b.places)).toEqual([
    expect.objectContaining({
      id: C2,
      placer: BEA,
      place: expect.objectContaining({ kind: "note", column: NOTES }),
    }),
    expect.objectContaining({
      id: C3,
      place: {
        kind: "fresh",
        column: "other",
        root: TEST_ROOT,
        task: TEST_TASK,
        at: ROOT,
      } as const,
    }),
  ])
})

describe("every command that moves a card records it (ADR-0048 step 6)", () => {
  const eventsOf = (b: ReturnType<typeof setUp>["b"]) =>
    (readCardHistories(b.session).get(C1)?.events ?? []).map(e => [
      e.kind,
      e.by,
      e.to.kind,
    ])
  const tracesOf = (b: ReturnType<typeof setUp>["b"]) => [
    ...readTraces(b.session).values(),
  ]
  const reading = (s: ReturnType<typeof setUp>, writer: string) =>
    s.presence.reading.set(readingKey(seatKey(writer, "s1"), "k"), E1)

  test("a move: an event; and a trace for the card's placer, who was not reading its thread", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    expect(eventsOf(b)).toEqual([["moved", BEA, "queued"]])
    expect(tracesOf(b)).toMatchObject([{ for: ADA, by: BEA, card: C1 }])
  })

  test("no trace while the placer reads the card's thread end", async () => {
    const s = setUp()
    const pinned = { ...queuedKey, kind: "pinned", order: "a" } as const
    s.put({ place: pinned })
    reading(s, ADA)
    await s.commands.move(
      BEA,
      [
        {
          card: C1,
          from: { kind: "pinned", at: pinned.at, thread: LANE },
          to: queuedKey,
        },
      ],
      null,
    )
    expect(tracesOf(s.b)).toEqual([])
  })

  test("an undo, whose revert Kyneta writes: an event, and the trace it makes moot goes", async () => {
    const { b, commands, put, undoes } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    undoes(
      {
        kind: "undone",
        step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
      },
      () => void put(),
    )
    await commands.undoMove(BEA, TEST_TASK, "undo")
    expect(eventsOf(b).at(-1)).toEqual(["undone", BEA, "note"])
    expect(tracesOf(b)).toEqual([])
  })

  test("a spend: the history goes with the card, and the trace carries the message", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(ADA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    await commands.move(ADA, [{ card: C1, from: queuedKey, to: atEnd }], null)
    expect(eventsOf(b)).toHaveLength(2)
    const sent = entryId("e-2")
    writeEntry(
      b.root,
      row(sent, E1, { role: "user", content: "hi", sendId: "s-1" }),
    )
    await commands.spend(BEA, C1, { sendId: "s-1", chat: sentChat })
    expect(readCardHistories(b.session).has(C1)).toBe(false)
    expect(tracesOf(b)).toMatchObject([
      { for: ADA, by: BEA, to: null, message: sent },
    ])
  })

  test("a busy chat's queue: an event", async () => {
    const { b, commands, put } = setUp()
    put()
    beginRun(b.live, LANE, runId("r-1"))
    await commands.queueBusy(ADA, { ...sentChat, card: { id: C1, seen: "" } })
    expect(eventsOf(b)).toEqual([["moved", ADA, "queued"]])
  })

  test("traces seen: only the sender's go", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    const [trace] = tracesOf(b)
    await commands.tracesSeen(BEA, [trace?.id ?? ""])
    expect(tracesOf(b)).toHaveLength(1)
    expect(await commands.tracesSeen(ADA, [trace?.id ?? ""])).toEqual({
      outcome: { kind: "seen" },
      rev: null,
    })
    expect(tracesOf(b)).toEqual([])
  })
})

describe("a card made a thread, and lifted back (ADR-0111, S139)", () => {
  const THREAD = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const STARTS = threadIdFor("spun")
  /** The task the thread was spun into: a new one. */
  const SPUN_TASK = taskIdFor("01a0ffd2-0000-7000-8000-0000000000fe")
  const spun = {
    kind: "gone",
    why: { kind: "spun", into: THREAD, thread: STARTS },
  } as const
  const spinMove = { card: C1, from: atEnd, to: spun }
  /** The thread as the directory names it, with `writers`' messages in it. */
  const thread = async (
    b: ReturnType<typeof setUp>["b"],
    writers: readonly (typeof ADA)[],
  ) => {
    applyWrites(b, [
      setRecord(ROOT_RECORD, {
        root: THREAD,
        entry: entryId("t-1"),
        first: entryId("t-1"),
        firstLine: "plan",
        messages: writers.length,
        newest: null,
        writers: [...writers],
        threads: {},
        mentions: [],
        images: [],
      }),
      setRecord(BOARD, {
        task: SPUN_TASK,
        state: "s-1" as never,
        rank: "m",
        by: ADA,
        at: 1,
      }),
    ])
    putTask(b, STARTS, SPUN_TASK, THREAD)
    const doc = await b.docs.root(THREAD)
    for (const [i, w] of writers.entries())
      writeEntry(
        doc,
        row(`t-${i + 1}`, i === 0 ? null : `t-${i}`, {
          role: "chat",
          content: "x",
          writer: w,
        }),
      )
  }

  test("the thread is started with the card's text, never asking the agent; the card goes gone, spun, in the history of the task it leaves", async () => {
    const { b, commands, put, texts, recorded } = setUp()
    put()
    texts.set(C1, "  plan this @agent with @Bea ")
    const chats: unknown[] = []
    const done = await commands.spinOff(
      ADA,
      { move: spinMove, task: SPUN_TASK, state: null, here: null },
      async chat => {
        chats.push(chat)
        return { kind: "appended", id: entryId("t-1") }
      },
    )
    expect(done.outcome).toEqual({ kind: "appended", id: entryId("t-1") })
    expect(chats).toMatchObject([
      {
        text: "plan this @agent with @Bea",
        root: THREAD,
        at: { kind: "branch", thread: STARTS, at: null, task: SPUN_TASK },
        asksAgent: false,
        mentions: [{ kind: "person", name: "Bea" }],
        card: { id: C1 },
        state: null,
      },
    ])
    expect(textsIn(b.places)[0]?.place).toEqual({
      ...spun,
      task: TEST_TASK,
      by: ADA,
    })
    expect(recorded).toEqual([[ADA, TEST_TASK]])
  })

  test("a thread that is not started leaves the card where it was; a blank card starts none", async () => {
    const { b, commands, put, texts } = setUp()
    put()
    texts.set(C1, "plan")
    const refused = await commands.spinOff(
      ADA,
      { move: spinMove, task: SPUN_TASK, state: null, here: null },
      async () => ({ kind: "refused", code: "refused", message: "no" }),
    )
    expect(refused.outcome.kind).toBe("refused")
    expect(textsIn(b.places)[0]?.place).toEqual(atEnd)
    texts.set(C1, " ")
    let started = false
    const blank = await commands.spinOff(
      ADA,
      { move: spinMove, task: SPUN_TASK, state: null, here: null },
      async () => {
        started = true
        return { kind: "appended", id: entryId("t-1") }
      },
    )
    expect(blank.outcome.kind).toBe("refused")
    expect(started).toBe(false)
  })

  const spunStep = {
    kind: "undone",
    step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
  } as const

  test("an undo while the thread holds its first message alone lifts it back: the card where it was, the thread deleted", async () => {
    const { b, commands, put, undoes } = setUp()
    put({ place: { ...spun, task: TEST_TASK, by: ADA } })
    await thread(b, [ADA])
    undoes(spunStep, () => put())
    const done = await commands.undoMove(ADA, TEST_TASK, "undo")
    expect(done.outcome).toEqual({
      kind: "undone",
      cards: [{ card: C1, place: noteKey }],
    })
    expect(readRoots(b.session).has(THREAD)).toBe(false)
    expect(readBoardPlaces(b.session).has(SPUN_TASK)).toBe(false)
    expect(readPlaces(b.places).some(c => c.id === STARTS)).toBe(false)
    expect(b.docs.loaded()).not.toContain(THREAD)
  })

  test("once someone replied, the undo is refused, naming them, and nothing is reverted", async () => {
    const { b, commands, put, undoes } = setUp()
    put({ place: { ...spun, task: TEST_TASK, by: ADA } })
    await thread(b, [ADA, BEA])
    let reverted = false
    undoes(spunStep, () => {
      reverted = true
    })
    expect((await commands.undoMove(ADA, TEST_TASK, "undo")).outcome).toEqual({
      kind: "unmoved",
      code: "replied",
      place: null,
      by: BEA,
    })
    expect(reverted).toBe(false)
    expect(readRoots(b.session).has(THREAD)).toBe(true)
  })
})
