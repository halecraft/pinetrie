import { describe, expect, test } from "vitest"
import { entriesOf, entry } from "./fixtures.ts"
import {
  atEntry,
  commitId,
  conflictsAt,
  type EntryId,
  entryId,
  firstLine,
  firstPromptOf,
  forkParent,
  hostPathInLane,
  indexTree,
  isBusy,
  nearestRevision,
  promptOf,
  type RevisionRecord,
  ROOT,
  sendWaits,
  snapshotId,
  threadIdFor,
  turnEntry,
  writerId,
} from "./index.ts"

/** An entry with a role, under `parent`. */
const at = (
  id: string,
  parentId: string | null,
  role: string,
  extra: object = {},
) => entry(id, parentId, { role, content: id, ...extra })

const A = threadIdFor("a")
const B = threadIdFor("b")
const D = threadIdFor("d")
const E = threadIdFor("e")
const C1 = commitId("c1")
const C2 = commitId("c2")
const CB = commitId("cb")
const SNAP1 = snapshotId("1-p1")
const SNAP2 = snapshotId("2-m1")
const SNAP4 = snapshotId("4-m2")
const SB = snapshotId("6-pb")

// Lane A: a person's prompt p1, an assistant message m1 whose tool call wrote
// tracked files (its result r1), then m2, whose calls changed only ignored
// files. Its revision records: the prompt (the disk it started with), m1 (a
// commit and a snapshot) and m2 (a snapshot only).
// Below m1: a conversation (x1), and lane B's prompt pb with its answer mb.
// Below mb: lane D, working directly, with its prompt pd and answer md.
const entries = entriesOf([
  at("1-p1", null, "chat"),
  at("2-m1", "1-p1", "assistant", {
    content: [{ type: "toolCall", id: "call-1", name: "write" }],
  }),
  at("3-r1", "2-m1", "toolResult", { toolCallId: "call-1" }),
  at("4-m2", "3-r1", "assistant"),
  at("5-x1", "3-r1", "chat"),
  at("6-pb", "3-r1", "chat"),
  at("7-mb", "6-pb", "assistant"),
  at("8-pd", "7-mb", "chat"),
  at("9-md", "8-pd", "assistant"),
  at("a-ld", "9-md", "land"),
  at("b-pe", "9-md", "chat"),
])
const index = indexTree(entries)
const revisions: ReadonlyMap<EntryId, RevisionRecord> = new Map(
  [
    {
      entry: entryId("1-p1"),
      lane: A,
      commit: C1,
      snapshot: SNAP1,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    },
    {
      entry: entryId("2-m1"),
      lane: A,
      commit: C2,
      snapshot: SNAP2,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    },
    {
      entry: entryId("4-m2"),
      lane: A,
      commit: null,
      snapshot: SNAP4,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    },
    {
      entry: entryId("6-pb"),
      lane: B,
      commit: CB,
      snapshot: SB,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    },
    {
      entry: entryId("8-pd"),
      lane: D,
      commit: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    },
    {
      entry: entryId("b-pe"),
      lane: E,
      commit: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    },
  ].map(r => [r.entry, r]),
)
const near = (id: string) =>
  nearestRevision(index, revisions, atEntry(entryId(id)))

describe("firstPromptOf: a lane's own first prompt", () => {
  test("a branch's first prompt is its own, below its parent's", () => {
    expect(firstPromptOf(index, revisions, B, entryId("7-mb"))).toBe("6-pb")
    expect(firstPromptOf(index, revisions, D, entryId("a-ld"))).toBe("8-pd")
  })
  test("the root lane's first prompt is the root's", () => {
    expect(firstPromptOf(index, revisions, A, entryId("4-m2"))).toBe("1-p1")
  })
  test("no run of the lane on the path, or no tip: none", () => {
    expect(firstPromptOf(index, revisions, B, entryId("4-m2"))).toBeNull()
    expect(firstPromptOf(index, revisions, B, null)).toBeNull()
  })
})

describe("nearestRevision: the lane, commit and disk above an entry", () => {
  test("an assistant message's own record gives its commit and disk", () => {
    expect(near("2-m1")).toEqual({
      lane: A,
      commit: C2,
      commitLane: A,
      snapshot: SNAP2,
    })
  })
  test("a tool result has the record above it", () => {
    expect(near("3-r1")).toEqual({
      lane: A,
      commit: C2,
      commitLane: A,
      snapshot: SNAP2,
    })
  })
  test("a turn that changed only ignored files: its disk, and the commit above", () => {
    expect(near("4-m2")).toEqual({
      lane: A,
      commit: C2,
      commitLane: A,
      snapshot: SNAP4,
    })
  })
  test("a conversation below a lane's message belongs to that lane", () => {
    expect(near("5-x1")).toEqual({
      lane: A,
      commit: C2,
      commitLane: A,
      snapshot: SNAP2,
    })
  })
  test("a person's prompt gives the disk from before the answer", () => {
    expect(near("1-p1")).toEqual({
      lane: A,
      commit: C1,
      commitLane: A,
      snapshot: SNAP1,
    })
  })
  test("a branch lane's prompt claims its own entries, never its parent's", () => {
    expect(near("7-mb")).toEqual({
      lane: B,
      commit: CB,
      commitLane: B,
      snapshot: SB,
    })
    expect(near("3-r1").lane).toBe(A)
  })
  test("a lane working directly is the lane above, but passed over for commit and disk", () => {
    // The commit is B's: the copy a fork here clones.
    expect(near("9-md")).toEqual({
      lane: D,
      commit: CB,
      commitLane: B,
      snapshot: SB,
    })
  })
  test("a record from before lane containers has a commit and no disk", () => {
    const old = new Map([
      [
        entryId("1-p1"),
        {
          entry: entryId("1-p1"),
          lane: A,
          commit: C1,
          snapshot: null,
          paths: [],
          conflicts: [],
          ignored: null,
          recipe: null,
        },
      ],
    ])
    expect(nearestRevision(index, old, atEntry(entryId("3-r1")))).toEqual({
      lane: A,
      commit: C1,
      commitLane: A,
      snapshot: null,
    })
  })
  test("nothing above the root, or a conversation no run has reached", () => {
    const none = { lane: null, commit: null, commitLane: null, snapshot: null }
    expect(nearestRevision(index, revisions, ROOT)).toEqual(none)
    expect(nearestRevision(index, new Map(), atEntry(entryId("5-x1")))).toEqual(
      none,
    )
  })
})

describe("forkParent and conflictsAt: what a lane's copy was cloned from", () => {
  test("a branch's parent is the lane whose commit is above its first prompt", () => {
    expect(forkParent(index, revisions, B, entryId("7-mb"))).toEqual({
      lane: A,
      commit: C2,
    })
  })
  test("a lane working directly records no commit: a fork below it is cloned from the lane above", () => {
    expect(forkParent(index, revisions, D, entryId("a-ld"))).toEqual({
      lane: B,
      commit: CB,
    })
    expect(forkParent(index, revisions, E, entryId("b-pe"))).toEqual({
      lane: B,
      commit: CB,
    })
  })
  test("a lane that began at its base has none; nor a lane with no tip", () => {
    expect(forkParent(index, revisions, A, entryId("4-m2"))).toBeNull()
    expect(forkParent(index, revisions, B, null)).toBeNull()
  })
  test("conflictsAt unions what every record naming a commit says", () => {
    const rec = (entry: string, commit: typeof C1, conflicts: string[]) =>
      [
        entryId(entry),
        {
          entry: entryId(entry),
          lane: A,
          commit,
          snapshot: null,
          paths: [],
          conflicts,
          ignored: null,
          recipe: null,
        },
      ] as const
    const records = new Map([
      rec("1-p1", C1, ["b.txt"]),
      rec("2-m1", C1, ["a.txt", "b.txt"]),
      rec("4-m2", C2, ["c.txt"]),
    ])
    expect(conflictsAt(records, C1)).toEqual(["a.txt", "b.txt"])
    expect(conflictsAt(records, CB)).toEqual([])
  })
})

describe("a turn's entry, and a run's prompt", () => {
  test("turnEntry: from a tool result, the message that made the call; else the entry", () => {
    expect(turnEntry(index, entryId("3-r1"))).toBe("2-m1")
    expect(turnEntry(index, entryId("1-p1"))).toBe("1-p1")
    expect(turnEntry(index, entryId("4-m2"))).toBe("4-m2")
  })
  test("promptOf: the nearest person's, user or land message at or above", () => {
    expect(promptOf(index, entryId("4-m2"))).toBe("1-p1")
    expect(promptOf(index, entryId("9-md"))).toBe("8-pd")
    expect(promptOf(index, entryId("a-ld"))).toBe("a-ld")
    expect(promptOf(index, null)).toBeNull()
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

test("firstLine: the first non-empty line, cut with an ellipsis only when longer", () => {
  expect(firstLine("\n  Plan the release \nand more", 40)).toBe(
    "Plan the release",
  )
  expect(firstLine("abcdef", 3)).toBe("abc…")
  expect(firstLine("abc", 3)).toBe("abc")
  expect(firstLine("  \n ", 3)).toBe("")
})

test("hostPathInLane: a granted host path sits under /mnt/host at its own path", () => {
  expect(hostPathInLane("/Users/ada/skills/plan")).toBe(
    "/mnt/host/Users/ada/skills/plan",
  )
})
