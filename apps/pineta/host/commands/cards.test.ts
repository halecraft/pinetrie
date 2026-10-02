import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  runId,
  writerId,
} from "@pineta/core"
import { readPlaces, readPlacesRev } from "@pineta/reads"
import { beginRun, writeEntry, writeLaneTip } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { basics, record, row } from "../fakes.ts"
import { applyPlaceStep } from "../places.ts"
import { takeTop } from "../take.ts"
import { createCardCommands } from "./cards.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = laneNameForThread("0123456789abcdef")
const E1 = entryId("e-1")
const C1 = cardId("c-1")
const drafting = { kind: "drafting", at: atEntry(E1), lane: LANE } as const
/** Texts the host holds whole. */
const held = { textNow: () => "x", holds: () => true }
const queuedKey = {
  kind: "queued",
  at: atEntry(E1),
  lane: LANE,
  seen: "",
} as const

function setUp() {
  const b = basics()
  writeEntry(b.doc, row(E1, null))
  writeLaneTip(b.doc, LANE, E1)
  const cards = record<{ destroy: (id: string) => Promise<void> }>({
    destroy: async () => {},
  })
  const drains: string[] = []
  const commands = createCardCommands({
    basics: b,
    cards: cards.port,
    drain: lane => void drains.push(lane),
  })
  const put = (over: Partial<CardRecord> = {}) =>
    applyPlaceStep(b.places, {
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
    })
  return { b, cards, drains, commands, put }
}

describe("moves on the host's Serial: the take and an unqueue in either order (ADR-0059)", () => {
  test("a queue on an idle lane asks for its drain, and answers with the rev of its write", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    const done = await commands.move(BEA, {
      card: C1,
      from: drafting,
      to: queuedKey,
    })
    expect(done).toEqual({ outcome: { kind: "moved" }, rev: 2 })
    expect(drains).toEqual([LANE])
    expect(readPlaces(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      by: BEA,
    })
  })

  test("the take, then an unqueue: answered gone, with the current rev", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, { card: C1, from: drafting, to: queuedKey })
    const top = takeTop(b.places, LANE, false, held)
    expect(top.kind === "taken" ? top.taken.card.id : top.kind).toBe(C1)
    const done = await commands.move(ADA, {
      card: C1,
      from: queuedKey,
      to: drafting,
    })
    expect(done).toEqual({
      outcome: { kind: "unmoved", code: "gone", place: null, by: null },
      rev: readPlacesRev(b.places),
    })
  })

  test("an unqueue, then the take: nothing is taken", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, { card: C1, from: drafting, to: queuedKey })
    await commands.move(ADA, { card: C1, from: queuedKey, to: drafting })
    expect(takeTop(b.places, LANE, false, held).kind).toBe("idle")
  })

  test("a move someone else made first: answered moved, naming them", async () => {
    const { commands, put } = setUp()
    put({ place: { ...queuedKey, order: "a", by: BEA }, placer: BEA })
    const done = await commands.move(ADA, {
      card: C1,
      from: drafting,
      to: queuedKey,
    })
    expect(done.outcome).toEqual({
      kind: "unmoved",
      code: "moved",
      place: queuedKey,
      by: BEA,
    })
  })

  test("a removal destroys the text after the record", async () => {
    const { b, cards, commands, put } = setUp()
    put({ place: { kind: "fresh", column: "k" } })
    await commands.move(ADA, {
      card: C1,
      from: { kind: "fresh", column: "k" },
      to: null,
    })
    expect(readPlaces(b.places)).toEqual([])
    expect(cards.calls.map(c => [c.method, ...c.args])).toEqual([
      ["destroy", C1],
    ])
  })
})

describe("a chat from a card that found its lane busy", () => {
  const chat = {
    text: "@bob look",
    at: atEntry(E1),
    mode: "reply",
    lane: LANE,
    asksAgent: false,
    mentions: [],
    work: null,
    card: { id: C1, seen: "" },
    reserved: null,
    base: null,
  } as const

  test("its card is queued behind the others in the same step, and answered queued with the rev", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    beginRun(b.doc, LANE, runId("r-1"))
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
    beginRun(b.doc, LANE, runId("r-1"))
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

test("spend: the record goes, then its text; a card already gone answers the current rev", async () => {
  const { b, cards, commands, put } = setUp()
  put()
  expect(await commands.spend(C1)).toBe(2)
  expect(await commands.spend(C1)).toBe(2)
  expect(readPlaces(b.places)).toEqual([])
  expect(cards.calls.map(c => c.method)).toEqual(["destroy", "destroy"])
})
