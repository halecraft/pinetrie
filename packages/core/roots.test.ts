import { describe, expect, test } from "vitest"
import { entriesOf, entry } from "./fixtures.ts"
import {
  entryId,
  indexTree,
  type LaneView,
  laneNameForThread,
  projectRail,
  rootWork,
  summarizeRoots,
  type WriterId,
  writerId,
} from "./index.ts"

const ADA = writerId("ada")
const BEA = writerId("bea")

/** A chat by `writer` at `parent`; "c" entries are not messages. */
const chat = (id: string, parentId: string | null, writer: WriterId) =>
  entry(id, parentId, { role: "chat", content: id, author: "A", writer })

// Two roots: r1 (Bea replies, then Ada branches) and r2 (a compaction only
// between two messages); and a root with no message at all.
const entries = entriesOf([
  chat("1-r1", null, ADA),
  chat("2-a", "1-r1", BEA),
  chat("4-b", "1-r1", ADA),
  chat("3-r2", null, BEA),
  entry("5-c", "3-r2", undefined, { type: "compaction" }),
  chat("6-d", "5-c", BEA),
  entry("0-empty", null, undefined, { type: "compaction" }),
])
const index = indexTree(entries)

const lane = (tip: string | null, over: Partial<LaneView> = {}): LaneView => ({
  name: laneNameForThread(tip ?? "none"),
  tip: tip === null ? null : entryId(tip),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
  ...over,
})

describe("summarizeRoots", () => {
  const summaries = summarizeRoots(index)
  test("one per root with a message, ascending; a root with none is skipped", () => {
    expect(summaries.map(s => s.root)).toEqual(["1-r1", "3-r2"])
  })
  test("first and messages agree with the root's rail rows", () => {
    for (const s of summaries) {
      const rows = projectRail(index, s.root)
      expect([s.first, s.messages]).toEqual([rows[0]?.id, rows.length])
    }
  })
  test("writers in order of first message, and newest is the largest id", () => {
    expect(summaries[0]).toMatchObject({ writers: [ADA, BEA], newest: "4-b" })
    expect(summaries[1]).toMatchObject({ writers: [BEA], newest: "6-d" })
  })
})

describe("rootWork", () => {
  test("running and waiting lanes resolve to their roots; running wins", () => {
    const work = rootWork(index, [
      lane("2-a", { waiting: 1 }),
      lane("4-b", { running: true }),
      lane("6-d", { waiting: 2 }),
    ])
    expect([...work]).toEqual([
      ["1-r1", "running"],
      ["3-r2", "waiting"],
    ])
  })
  test("cards behind a held queue are held, below waiting and running in the same root", () => {
    const held = { waiting: 2, heldBy: ADA }
    expect([...rootWork(index, [lane("2-a", held)])]).toEqual([
      ["1-r1", "held"],
    ])
    expect([
      ...rootWork(index, [lane("2-a", held), lane("4-b", { waiting: 1 })]),
    ]).toEqual([["1-r1", "waiting"]])
    expect([
      ...rootWork(index, [
        lane("2-a", { ...held, running: true }),
        lane("4-b", held),
      ]),
    ]).toEqual([["1-r1", "running"]])
  })
  test("a held queue with nothing in it is no work", () => {
    expect([...rootWork(index, [lane("2-a", { heldBy: ADA })])]).toEqual([])
  })
  test("an idle lane is no work, and a lane with no tip is in no root", () => {
    expect([
      ...rootWork(index, [lane("2-a"), lane(null, { running: true })]),
    ]).toEqual([])
  })
})
