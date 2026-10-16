import { describe, expect, test } from "vitest"
import { entriesOf, entry } from "./fixtures.ts"
import {
  entryId,
  indexTree,
  type LaneView,
  projectRail,
  summarizeRoots,
  threadIdFor,
  threadsWork,
  type WriterId,
  writerId,
} from "./index.ts"

const ADA = writerId("ada")
const BEA = writerId("bea")

/** A chat by `writer` at `parent`; "c" entries are not messages. */
const said = (id: string, parentId: string | null, writer: WriterId) =>
  entry(id, parentId, { role: "person", content: id, author: "A", writer })

// Two roots: r1 (Bea replies, then Ada branches) and r2 (a compaction only
// between two messages); and a root with no message at all.
const entries = entriesOf([
  said("1-r1", null, ADA),
  said("2-a", "1-r1", BEA),
  said("4-b", "1-r1", ADA),
  said("3-r2", null, BEA),
  entry("5-c", "3-r2", undefined, { type: "compaction" }),
  said("6-d", "5-c", BEA),
  entry("0-empty", null, undefined, { type: "compaction" }),
])
const index = indexTree(entries)

const lane = (tip: string | null, over: Partial<LaneView> = {}): LaneView => ({
  name: threadIdFor(tip ?? "none"),
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

describe("threadsWork", () => {
  const threads = (...tips: string[]) => new Set(tips.map(t => threadIdFor(t)))
  test("running and waiting lanes of the threads are work; running wins, and other lanes count for nothing", () => {
    const lanes = [lane("2-a", { waiting: 1 }), lane("4-b", { running: true })]
    expect(threadsWork(lanes, threads("2-a", "4-b"))).toBe("running")
    expect(threadsWork(lanes, threads("2-a"))).toBe("waiting")
    expect(threadsWork(lanes, threads("6-d"))).toBeUndefined()
  })
  test("cards behind a held queue are held, below waiting and running", () => {
    const held = { waiting: 2, heldBy: ADA }
    expect(threadsWork([lane("2-a", held)], threads("2-a"))).toBe("held")
    expect(
      threadsWork(
        [lane("2-a", held), lane("4-b", { waiting: 1 })],
        threads("2-a", "4-b"),
      ),
    ).toBe("waiting")
    expect(
      threadsWork(
        [lane("2-a", { ...held, running: true }), lane("4-b", held)],
        threads("2-a", "4-b"),
      ),
    ).toBe("running")
  })
  test("a held queue with nothing in it is no work, nor is an idle lane", () => {
    expect(
      threadsWork(
        [lane("2-a", { heldBy: ADA }), lane("4-b")],
        threads("2-a", "4-b"),
      ),
    ).toBeUndefined()
  })
})
