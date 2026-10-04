import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  ROOT,
  rootIdFor,
  runId,
  writerId,
} from "@pineta/core"
import { PLACES_DOC_ID } from "@pineta/protocol/messages"
import {
  readCardHistories,
  readPlaces,
  readPlacesRev,
  readTraces,
} from "@pineta/reads"
import type { UndoResult } from "@pineta/rules"
import {
  beginRun,
  newPresenceDoc,
  readingKey,
  seatKey,
  writeEntry,
  writeLaneTip,
} from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { applyWrites, basics, record, row } from "../fakes.ts"
import { applyPlaceSteps } from "../places.ts"
import { createProvenance } from "../provenance.ts"
import { popNextQueuedCard } from "../queued-card-pop.ts"
import { type CardCommandDeps, createCardCommands } from "./cards.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = laneNameForThread("0123456789abcdef")
const E1 = entryId("e-1")
const C1 = cardId("c-1")
const drafting = {
  kind: "drafting",
  root: TEST_ROOT,
  at: atEntry(E1),
  lane: LANE,
} as const
/** Texts the host holds whole. */
const held = { textNow: () => "x", holds: () => true }
const queuedKey = {
  kind: "queued",
  root: TEST_ROOT,
  at: atEntry(E1),
  lane: LANE,
  seen: "",
} as const

function setUp() {
  const b = basics()
  writeEntry(b.root, row(E1, null))
  writeLaneTip(b.root, LANE, E1)
  const cards = record<{ destroy: (id: string) => Promise<void> }>({
    destroy: async () => {},
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
  })
  const presence = newPresenceDoc()
  const provenance = createProvenance({
    basics: b,
    presence,
    agent: () => ({ writeValues: async writes => applyWrites(b, writes) }),
  })
  const commands = createCardCommands({
    basics: b,
    cards: cards.port,
    drain: lane => void drains.push(lane),
    histories: histories.port,
    provenance,
  })
  const undoes = (result: UndoResult, revert: () => void = () => {}) => {
    undoing = result
    reverting = revert
  }
  const put = (over: Partial<CardRecord> = {}) =>
    applyPlaceSteps(b.places, [
      {
        kind: "write",
        record: {
          id: C1,
          owner: ADA,
          placer: ADA,
          place: drafting,
          command: null,
          unsent: null,
          ...over,
        },
      },
    ])
  return {
    b,
    cards,
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
    const done = await commands.move(BEA, [
      {
        card: C1,
        from: drafting,
        to: queuedKey,
      },
    ])
    expect(done).toEqual({ outcome: { kind: "moved" }, rev: 2 })
    expect(drains).toEqual([LANE])
    expect(readPlaces(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      by: BEA,
    })
  })

  test("the pop, then an unqueue: answered gone, with the current rev", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: drafting, to: queuedKey }])
    const top = popNextQueuedCard(b.places, LANE, false, held)
    expect(top.kind === "popped" ? top.popped.card.id : top.kind).toBe(C1)
    const done = await commands.move(ADA, [
      {
        card: C1,
        from: queuedKey,
        to: drafting,
      },
    ])
    expect(done).toEqual({
      outcome: { kind: "unmoved", code: "gone", place: null, by: null },
      rev: readPlacesRev(b.places),
    })
  })

  test("an unqueue, then the pop: nothing is popped", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: drafting, to: queuedKey }])
    await commands.move(ADA, [{ card: C1, from: queuedKey, to: drafting }])
    expect(popNextQueuedCard(b.places, LANE, false, held).kind).toBe("idle")
  })

  test("a move someone else made first: answered moved, naming them", async () => {
    const { commands, put } = setUp()
    put({ place: { ...queuedKey, order: "a", by: BEA }, placer: BEA })
    const done = await commands.move(ADA, [
      {
        card: C1,
        from: drafting,
        to: queuedKey,
      },
    ])
    expect(done.outcome).toEqual({
      kind: "unmoved",
      code: "moved",
      place: queuedKey,
      by: BEA,
    })
  })

  test("a removal destroys the text after the record", async () => {
    const { b, cards, commands, put } = setUp()
    put({
      place: { kind: "fresh", column: "k", root: TEST_ROOT, at: ROOT } as const,
    })
    await commands.move(ADA, [
      {
        card: C1,
        from: {
          kind: "fresh",
          column: "k",
          root: TEST_ROOT,
          at: ROOT,
        } as const,
        to: null,
      },
    ])
    expect(readPlaces(b.places)).toEqual([])
    expect(cards.calls.map(c => [c.method, ...c.args])).toEqual([
      ["destroy", C1],
    ])
  })
})

describe("moves' history (ADR-0066)", () => {
  const inventory = { kind: "inventory", holder: ADA } as const

  test("a take into the inventory is one step of the taker's history in the root it left; a creation is in none", async () => {
    const { commands, put, recorded } = setUp()
    put()
    await commands.move(ADA, [{ card: C1, from: drafting, to: inventory }])
    await commands.move(ADA, [
      { card: cardId("c-2"), from: null, to: inventory },
    ])
    expect(recorded).toEqual([[ADA, TEST_ROOT]])
  })

  test("several moves are one, refused whole: nothing written when one has moved", async () => {
    const { b, commands, put } = setUp()
    const fresh = {
      kind: "fresh",
      column: "k",
      root: TEST_ROOT,
      at: ROOT,
    } as const
    put({ place: fresh })
    const before = readPlaces(b.places)
    const done = await commands.move(ADA, [
      { card: C1, from: fresh, to: inventory },
      { card: cardId("c-9"), from: fresh, to: inventory },
    ])
    expect(done.outcome).toMatchObject({ kind: "unmoved", code: "gone" })
    expect(readPlaces(b.places)).toEqual(before)
  })

  test("an undo answers each card it moved and where it is now, with a rev raised after it", async () => {
    const { b, commands, put, histories, undoes } = setUp()
    put()
    const rev = readPlacesRev(b.places)
    undoes({
      kind: "undone",
      step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
    })
    const done = await commands.undoMove(ADA, TEST_ROOT, "undo")
    expect(done).toEqual({
      outcome: { kind: "undone", cards: [{ card: C1, place: drafting }] },
      rev: rev + 1,
    })
    expect(histories.calls.at(-1)?.args).toEqual([ADA, TEST_ROOT, "undo"])
  })

  test("a refused undo names who moved the card; one with nothing to undo is nothing", async () => {
    const { commands, put, undoes } = setUp()
    put({ placer: BEA })
    const part = { docId: PLACES_DOC_ID, footprint: [["cards", C1]] }
    undoes({ kind: "refused", step: { parts: [part] }, stale: [part] })
    expect((await commands.undoMove(ADA, TEST_ROOT, "undo")).outcome).toEqual({
      kind: "unmoved",
      code: "moved",
      place: drafting,
      by: BEA,
    })
    undoes({ kind: "none" })
    expect(await commands.undoMove(ADA, TEST_ROOT, "redo")).toEqual({
      outcome: { kind: "nothing" },
      rev: null,
    })
  })
})

describe("a chat from a card that found its lane busy", () => {
  const chat = {
    text: "@bob look",
    root: TEST_ROOT,
    at: atEntry(E1),
    mode: "reply",
    lane: LANE,
    asksAgent: false,
    mentions: [],
    work: null,
    card: { id: C1, seen: "" },
    pinned: [],
    reserved: null,
    base: null,
  } as const

  test("its card is queued behind the others in the same step, and answered queued with the rev", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    beginRun(b.live, LANE, runId("r-1"))
    const done = await commands.queueBusy(ADA, chat)
    expect(done).toEqual({ outcome: { kind: "queued" }, rev: 2 })
    expect(readPlaces(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      lane: LANE,
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
  expect(done).toEqual({ outcome: { kind: "moved" }, rev: 2 })
  expect(readPlaces(b.places)[0]).toMatchObject({
    command: "bring-up-to-date",
    placer: BEA,
    place: drafting,
  })
})

const sentChat = {
  text: "hi",
  root: TEST_ROOT,
  at: atEntry(E1),
  mode: "reply",
  lane: null,
  asksAgent: false,
  mentions: [],
  work: null,
  card: { id: C1, seen: "" },
  pinned: [],
  reserved: null,
  base: null,
} as const

test("spend: the record goes, then its text; a card already gone answers the current rev", async () => {
  const { b, cards, commands, put } = setUp()
  put()
  const sent = { sendId: "s-1", chat: sentChat }
  expect(await commands.spend(ADA, C1, sent)).toBe(2)
  expect(await commands.spend(ADA, C1, sent)).toBe(2)
  expect(readPlaces(b.places)).toEqual([])
  expect(cards.calls.map(c => c.method)).toEqual(["destroy", "destroy"])
})

test("spend: a fresh column's first send leaves its other cards drafting at the new message, in one step", async () => {
  const { b, commands, put } = setUp()
  const fresh = {
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    at: ROOT,
  } as const
  put({ place: fresh })
  const C2 = cardId("c-2")
  const C3 = cardId("c-3")
  put({ id: C2, owner: BEA, placer: BEA, place: fresh })
  put({
    id: C3,
    place: {
      kind: "fresh",
      column: "other",
      root: TEST_ROOT,
      at: ROOT,
    } as const,
  })
  const sent = entryId("e-2")
  writeEntry(
    b.root,
    row(sent, E1, { role: "user", content: "hi", sendId: "s-1" }),
  )
  const rev = await commands.spend(ADA, C1, { sendId: "s-1", chat: sentChat })
  expect(rev).toBe(readPlacesRev(b.places))
  expect(readPlaces(b.places)).toEqual([
    expect.objectContaining({
      id: C2,
      placer: BEA,
      place: {
        kind: "drafting",
        root: TEST_ROOT,
        at: atEntry(sent),
        lane: null,
      },
    }),
    expect.objectContaining({
      id: C3,
      place: {
        kind: "fresh",
        column: "other",
        root: TEST_ROOT,
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
    await commands.move(BEA, [{ card: C1, from: drafting, to: queuedKey }])
    expect(eventsOf(b)).toEqual([["moved", BEA, "queued"]])
    expect(tracesOf(b)).toMatchObject([{ for: ADA, by: BEA, card: C1 }])
  })

  test("no trace while the placer reads the card's thread end", async () => {
    const s = setUp()
    s.put()
    reading(s, ADA)
    await s.commands.move(BEA, [{ card: C1, from: drafting, to: queuedKey }])
    expect(tracesOf(s.b)).toEqual([])
  })

  test("an undo, whose revert Kyneta writes: an event, and the trace it makes moot goes", async () => {
    const { b, commands, put, undoes } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: drafting, to: queuedKey }])
    undoes(
      {
        kind: "undone",
        step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
      },
      () => void put(),
    )
    await commands.undoMove(BEA, TEST_ROOT, "undo")
    expect(eventsOf(b).at(-1)).toEqual(["undone", BEA, "drafting"])
    expect(tracesOf(b)).toEqual([])
  })

  test("a spend: the history goes with the card, and the trace carries the message", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(ADA, [{ card: C1, from: drafting, to: queuedKey }])
    await commands.move(ADA, [{ card: C1, from: queuedKey, to: drafting }])
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
    await commands.move(BEA, [{ card: C1, from: drafting, to: queuedKey }])
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
