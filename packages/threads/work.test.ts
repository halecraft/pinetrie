import {
  atEntry,
  type EntryId,
  entryId,
  pointId,
  type RevisionRecord,
  ROOT,
  snapshotId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  entriesById,
  entry,
  lineMessage,
  personMessage,
  toolResultMessage,
} from "./fixtures.ts"
import {
  forkParent,
  indexTree,
  isBusy,
  laneFirstPrompt,
  nearestKeptSnapshot,
  nearestRevision,
  pointConflicts,
  runPrompt,
  sendWaits,
  turnEntry,
} from "./index.ts"

/** An entry with a role, under `parent`, saying its id; an agent's or a result's call `call`. */
const at = (
  id: string,
  parentId: string | null,
  role: "person" | "assistant" | "toolResult" | "land",
  call?: string,
) =>
  entry(
    id,
    parentId,
    role === "person"
      ? personMessage(id)
      : role === "toolResult"
        ? toolResultMessage({ content: id, toolCallId: call })
        : role === "land"
          ? lineMessage("land", id)
          : {
              role,
              content:
                call === undefined
                  ? id
                  : [
                      {
                        type: "toolCall",
                        id: call,
                        name: "write",
                        arguments: {},
                      },
                    ],
            },
  )

const A = threadIdFor("a")

const B = threadIdFor("b")

const D = threadIdFor("d")

const E = threadIdFor("e")

const C1 = pointId("c1")

const C2 = pointId("c2")

const CB = pointId("cb")

const SNAP1 = snapshotId("1-p1")

const SNAP2 = snapshotId("2-m1")

const SNAP4 = snapshotId("4-m2")

const SB = snapshotId("6-pb")

// Lane A: a person's prompt p1, an assistant message m1 whose tool call wrote
// tracked files (its result r1), then m2, whose calls changed only ignored
// files. Its revision records: the prompt (the disk it started with), m1 (a
// commit and a snapshot) and m2 (a snapshot only).
// Below m1: a chat (x1), and lane B's prompt pb with its answer mb.
// Below mb: lane D, working directly, with its prompt pd and answer md.

const entries = entriesById([
  at("1-p1", null, "person"),
  at("2-m1", "1-p1", "assistant", "call-1"),
  at("3-r1", "2-m1", "toolResult", "call-1"),
  at("4-m2", "3-r1", "assistant"),
  at("5-x1", "3-r1", "person"),
  at("6-pb", "3-r1", "person"),
  at("7-mb", "6-pb", "assistant"),
  at("8-pd", "7-mb", "person"),
  at("9-md", "8-pd", "assistant"),
  at("a-ld", "9-md", "land"),
  at("b-pe", "9-md", "person"),
])

const index = indexTree(entries)

const revisions: ReadonlyMap<EntryId, RevisionRecord> = new Map(
  [
    {
      entry: entryId("1-p1"),
      lane: A,
      point: C1,
      snapshot: SNAP1,
      paths: [],
      conflicts: [],
      disk: null,
    },
    {
      entry: entryId("2-m1"),
      lane: A,
      point: C2,
      snapshot: SNAP2,
      paths: [],
      conflicts: [],
      disk: null,
    },
    {
      entry: entryId("4-m2"),
      lane: A,
      point: null,
      snapshot: SNAP4,
      paths: [],
      conflicts: [],
      disk: null,
    },
    {
      entry: entryId("6-pb"),
      lane: B,
      point: CB,
      snapshot: SB,
      paths: [],
      conflicts: [],
      disk: null,
    },
    {
      entry: entryId("8-pd"),
      lane: D,
      point: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      disk: null,
    },
    {
      entry: entryId("b-pe"),
      lane: E,
      point: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      disk: null,
    },
  ].map(r => [r.entry, r]),
)

const near = (id: string) =>
  nearestRevision(index, revisions, atEntry(entryId(id)))

test("nearestRevision: a thread's chat below where it forks finds what that entry finds", () => {
  expect(near("5-x1")).toEqual(near("3-r1"))
  expect(near("5-x1")).toMatchObject({ point: C2, snapshot: SNAP2 })
})

describe("nearestKeptSnapshot: the nearest snapshot above not gone", () => {
  const kept = (id: string, gone: readonly string[]) =>
    nearestKeptSnapshot(
      index,
      revisions,
      atEntry(entryId(id)),
      new Set(gone.map(snapshotId)),
    )
  test("with none gone, the nearest", () => {
    expect(kept("4-m2", [])).toBe(SNAP4)
  })
  test("each gone one passed over, to the next above", () => {
    expect(kept("4-m2", [SNAP4])).toBe(SNAP2)
    expect(kept("4-m2", [SNAP4, SNAP2])).toBe(SNAP1)
  })
  test("none left above, or at the root: none", () => {
    expect(kept("4-m2", [SNAP4, SNAP2, SNAP1])).toBeNull()
    expect(nearestKeptSnapshot(index, revisions, ROOT, new Set())).toBeNull()
  })
})

describe("laneFirstPrompt: a lane's own first prompt", () => {
  test("a branch's first prompt is its own, below its parent's", () => {
    expect(laneFirstPrompt(index, revisions, B, entryId("7-mb"))).toBe("6-pb")
    expect(laneFirstPrompt(index, revisions, D, entryId("a-ld"))).toBe("8-pd")
  })
  test("the root lane's first prompt is the root's", () => {
    expect(laneFirstPrompt(index, revisions, A, entryId("4-m2"))).toBe("1-p1")
  })
  test("no run of the lane on the path, or no tip: none", () => {
    expect(laneFirstPrompt(index, revisions, B, entryId("4-m2"))).toBeNull()
    expect(laneFirstPrompt(index, revisions, B, null)).toBeNull()
  })
})

describe("nearestRevision: the lane, commit and disk above an entry", () => {
  test("an assistant message's own record gives its commit and disk", () => {
    expect(near("2-m1")).toEqual({
      lane: A,
      point: C2,
      pointLane: A,
      snapshot: SNAP2,
      snapshotLane: A,
    })
  })
  test("a tool result has the record above it", () => {
    expect(near("3-r1")).toEqual({
      lane: A,
      point: C2,
      pointLane: A,
      snapshot: SNAP2,
      snapshotLane: A,
    })
  })
  test("a turn that changed only ignored files: its disk, and the commit above", () => {
    expect(near("4-m2")).toEqual({
      lane: A,
      point: C2,
      pointLane: A,
      snapshot: SNAP4,
      snapshotLane: A,
    })
  })
  test("a chat below a lane's message belongs to that lane", () => {
    expect(near("5-x1")).toEqual({
      lane: A,
      point: C2,
      pointLane: A,
      snapshot: SNAP2,
      snapshotLane: A,
    })
  })
  test("a person's prompt gives the disk from before the answer", () => {
    expect(near("1-p1")).toEqual({
      lane: A,
      point: C1,
      pointLane: A,
      snapshot: SNAP1,
      snapshotLane: A,
    })
  })
  test("a branch lane's prompt claims its own entries, never its parent's", () => {
    expect(near("7-mb")).toEqual({
      lane: B,
      point: CB,
      pointLane: B,
      snapshot: SB,
      snapshotLane: B,
    })
    expect(near("3-r1").lane).toBe(A)
  })
  test("a lane working directly is the lane above, but passed over for commit and disk", () => {
    // The commit is B's: the copy a fork here clones.
    expect(near("9-md")).toEqual({
      lane: D,
      point: CB,
      pointLane: B,
      snapshot: SB,
      snapshotLane: B,
    })
  })
  test("a record from before lane containers has a commit and no disk", () => {
    const old = new Map([
      [
        entryId("1-p1"),
        {
          entry: entryId("1-p1"),
          lane: A,
          point: C1,
          snapshot: null,
          paths: [],
          conflicts: [],
          disk: null,
        },
      ],
    ])
    expect(nearestRevision(index, old, atEntry(entryId("3-r1")))).toEqual({
      lane: A,
      point: C1,
      pointLane: A,
      snapshot: null,
      snapshotLane: null,
    })
  })
  test("nothing above the root, or a chat no run has reached", () => {
    const none = {
      lane: null,
      point: null,
      pointLane: null,
      snapshot: null,
      snapshotLane: null,
    }
    expect(nearestRevision(index, revisions, ROOT)).toEqual(none)
    expect(nearestRevision(index, new Map(), atEntry(entryId("5-x1")))).toEqual(
      none,
    )
  })
})

describe("forkParent and pointConflicts: what a lane's copy was cloned from", () => {
  test("a branch's parent is the lane whose commit is above its first prompt", () => {
    expect(forkParent(index, revisions, B, entryId("7-mb"))).toEqual({
      lane: A,
      point: C2,
    })
  })
  test("a lane working directly records no commit: a fork below it is cloned from the lane above", () => {
    expect(forkParent(index, revisions, D, entryId("a-ld"))).toEqual({
      lane: B,
      point: CB,
    })
    expect(forkParent(index, revisions, E, entryId("b-pe"))).toEqual({
      lane: B,
      point: CB,
    })
  })
  test("a lane that began at its base has none; nor a lane with no tip", () => {
    expect(forkParent(index, revisions, A, entryId("4-m2"))).toBeNull()
    expect(forkParent(index, revisions, B, null)).toBeNull()
  })
  test("pointConflicts unions what every record naming a commit says", () => {
    const rec = (entry: string, point: typeof C1, conflicts: string[]) =>
      [
        entryId(entry),
        {
          entry: entryId(entry),
          lane: A,
          point,
          snapshot: null,
          paths: [],
          conflicts,
          disk: null,
        },
      ] as const
    const records = new Map([
      rec("1-p1", C1, ["b.txt"]),
      rec("2-m1", C1, ["a.txt", "b.txt"]),
      rec("4-m2", C2, ["c.txt"]),
    ])
    expect(pointConflicts(records, C1)).toEqual(["a.txt", "b.txt"])
    expect(pointConflicts(records, CB)).toEqual([])
  })
})

describe("a turn's entry, and a run's prompt", () => {
  test("turnEntry: from a tool result, the message that made the call; else the entry", () => {
    expect(turnEntry(index, entryId("3-r1"))).toBe("2-m1")
    expect(turnEntry(index, entryId("1-p1"))).toBe("1-p1")
    expect(turnEntry(index, entryId("4-m2"))).toBe("4-m2")
  })
  test("runPrompt: the nearest person's, user or land message at or above", () => {
    expect(runPrompt(index, entryId("4-m2"))).toBe("1-p1")
    expect(runPrompt(index, entryId("9-md"))).toBe("8-pd")
    expect(runPrompt(index, entryId("a-ld"))).toBe("a-ld")
    expect(runPrompt(index, null)).toBeNull()
  })
})

test("isBusy: running, or with cards queued", () => {
  const view = {
    name: A,
    tip: null,
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  }
  expect(isBusy(view)).toBe(false)
  expect(isBusy({ ...view, running: true })).toBe(true)
  expect(isBusy({ ...view, waiting: 1 })).toBe(true)
  // A held queue is not busy: nothing waits, and the agent is idle.
  expect(isBusy({ ...view, heldBy: writerId("ada") })).toBe(false)
  // But a send there waits in it.
  expect(sendWaits({ ...view, heldBy: writerId("ada") })).toBe(true)
  expect(sendWaits(view)).toBe(false)
  expect(sendWaits({ ...view, waiting: 1 })).toBe(true)
})
