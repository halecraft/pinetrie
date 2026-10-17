import {
  type AcceptJournal,
  type AcceptPath,
  type AcceptWrite,
  ERR,
  type FolderProposedChangesRecord,
  type FolderStamp,
  type InodeStat,
  type PointId,
  pointId,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  acceptWrites,
  checkStage,
  journalPaths,
  keptAsides,
  planAccept,
  planAsides,
  planNames,
  planRecovery,
  planWriteSteps,
  type StageEntry,
} from "./accept.ts"
import { folderNewest, planState, shownMergeId, stateGraph } from "./graph.ts"

const LANE = threadIdFor("1")
const L1 = pointId("line-1")
const L2 = pointId("line-2")
const START = pointId("start-1")
const TURN = pointId("turn-1")
const TURN2 = pointId("turn-2")

const record = (
  id: PointId,
  made: StateRecord["made"],
  ...parents: PointId[]
): StateRecord => ({ id, parents, made, at: 0, by: null })

const STATES: readonly StateRecord[] = [
  record(L1, { kind: "read" }),
  record(START, { kind: "start", lane: LANE }, L1),
  record(TURN, { kind: "turn", lane: LANE, entry: "e-1" as never }, START),
]

const proposed: FolderProposedChangesRecord = {
  kind: "folder",
  lane: LANE,
  start: L1,
  tip: TURN,
  files: ["a.txt"],
  conflicts: [],
  description: null,
  at: 0,
}
const seen = {
  kind: "folder",
  start: L1,
  tip: TURN,
  conflicted: false,
} as const

const accept = (over: Partial<Parameters<typeof planAccept>[0]> = {}) =>
  planAccept({
    graph: stateGraph(STATES),
    proposed,
    seen,
    shownMade: true,
    at: 5,
    by: null,
    ...over,
  })

describe("planAccept", () => {
  test("the accept's state is the shown merge, on accepted work's newest and the lane's tip", () => {
    expect(accept()).toEqual({
      kind: "accept",
      record: {
        id: shownMergeId(L1, TURN),
        parents: [L1, TURN],
        made: { kind: "accept", lane: LANE },
        at: 5,
        by: null,
      },
    })
  })
  test("a read since the review is not as shown, whatever it touched", () => {
    const graph = stateGraph([...STATES, record(L2, { kind: "read" }, L1)])
    expect(accept({ graph })).toEqual({
      kind: "refused",
      code: ERR.NOT_AS_SHOWN,
    })
  })
  test("a turn since the review is not as shown", () => {
    const graph = stateGraph([
      ...STATES,
      record(TURN2, { kind: "turn", lane: LANE, entry: "e-2" as never }, TURN),
    ])
    // The record is rebuilt with the new tip; the page saw the old one.
    expect(accept({ graph, proposed: { ...proposed, tip: TURN2 } })).toEqual({
      kind: "refused",
      code: ERR.NOT_AS_SHOWN,
    })
  })
  test("a seen value of jj's kind is not as shown", () => {
    expect(
      accept({ seen: { kind: "jj", ledger: null, conflicted: false } }),
    ).toEqual({ kind: "refused", code: ERR.NOT_AS_SHOWN })
  })
  test("conflicted proposed changes have nowhere to go", () => {
    expect(
      accept({
        proposed: { ...proposed, conflicts: ["a.txt"] },
        seen: { ...seen, conflicted: true },
      }),
    ).toEqual({ kind: "refused", code: ERR.BAD_DESTINATION })
  })
  test("nothing to accept, and a shown merge gone, are refused", () => {
    expect(accept({ proposed: { ...proposed, files: [] } })).toEqual({
      kind: "refused",
      code: ERR.NO_PROPOSED_CHANGES,
    })
    expect(accept({ shownMade: false })).toEqual({
      kind: "refused",
      code: ERR.NOT_AS_SHOWN,
    })
  })
})

test("shownMergeId: the same two states name the same merge; another tip another", () => {
  expect(shownMergeId(L1, TURN)).toBe(shownMergeId(L1, TURN))
  expect(shownMergeId(L1, TURN)).not.toBe(shownMergeId(L1, TURN2))
})

const stamp = (size = 1, ctimeNs = "1"): FolderStamp => ({
  kind: "file",
  size,
  ctimeNs,
  exec: false,
})

test("acceptWrites: each changed path with the read's stamp and the shown merge's content", () => {
  const read = new Map([
    ["a.txt", stamp()],
    ["gone.txt", stamp(2)],
    ["d", stamp(3)],
  ])
  expect(
    acceptWrites(
      ["a.txt", "new.txt", "gone.txt", "l", "d"],
      [
        { kind: "file", exec: false, text: true, size: 4 },
        { kind: "file", exec: true, text: true, size: 4 },
        { kind: "absent" },
        { kind: "symlink", target: "a.txt" },
        { kind: "dir" },
      ],
      read,
    ),
  ).toEqual([
    { path: "a.txt", expected: stamp(), to: { kind: "file" } },
    { path: "new.txt", expected: null, to: { kind: "file" } },
    { path: "gone.txt", expected: stamp(2), to: null },
    { path: "l", expected: null, to: { kind: "symlink", target: "a.txt" } },
    { path: "d", expected: stamp(3), to: null },
  ])
  expect(acceptWrites(["fifo"], [{ kind: "other" }], read)).toEqual({
    unwritable: "fifo",
  })
})

test("planWriteSteps: a new path is created, a changed one replaced, a deleted one deleted, every delete first", () => {
  const writes: AcceptWrite[] = [
    { path: "a", expected: stamp(), to: { kind: "file" } },
    { path: "b", expected: null, to: { kind: "symlink", target: "a" } },
    { path: "d/x", expected: stamp(), to: null },
    { path: "c", expected: stamp(), to: null },
  ]
  expect(planWriteSteps(writes, ".stage")).toEqual([
    { kind: "delete", path: "d/x", expected: stamp() },
    { kind: "delete", path: "c", expected: stamp() },
    {
      kind: "replace",
      path: "a",
      expected: stamp(),
      to: { kind: "file", staged: ".stage/a" },
    },
    { kind: "create", path: "b", to: { kind: "symlink", target: "a" } },
  ])
})

describe("planNames", () => {
  const file = (p: string): AcceptWrite => ({
    path: p,
    expected: null,
    to: { kind: "file" },
  })
  test("a name another holds by case collides on a disk that folds case, and not on another", () => {
    expect(planNames([file("README.md")], ["readme.md"], true)).toEqual({
      kind: "collides",
      path: "README.md",
      with: "readme.md",
    })
    expect(planNames([file("README.md")], ["readme.md"], false)).toBeNull()
  })
  test("a directory on its way collides as a name does", () => {
    expect(planNames([file("Docs/a.md")], ["docs/b.md"], true)?.kind).toBe(
      "collides",
    )
  })
  test("a name deleted in the same accept frees its folded form", () => {
    expect(
      planNames(
        [file("README.md"), { path: "readme.md", expected: stamp(), to: null }],
        ["readme.md"],
        true,
      ),
    ).toBeNull()
  })
  test("NFC and NFD of one name collide", () => {
    const nfc = "caf\u00e9.txt"
    const nfd = "cafe\u0301.txt"
    expect(planNames([file(nfd)], [nfc], false)?.kind).toBe("collides")
  })
  test("a name read with a replacement character is refused", () => {
    expect(planNames([file("bad\uFFFD.txt")], [], false)).toEqual({
      kind: "not-utf8",
      path: "bad\uFFFD.txt",
    })
  })
  test("a symlink that climbs out, or is absolute, leaves the folder", () => {
    const link = (target: string): AcceptWrite => ({
      path: "d/l",
      expected: null,
      to: { kind: "symlink", target },
    })
    expect(planNames([link("../../x")], [], false)?.kind).toBe("leaves")
    expect(planNames([link("/etc/passwd")], [], false)?.kind).toBe("leaves")
    expect(planNames([link("../x")], [], false)).toBeNull()
  })
  test("a path under a reserved name at the root is refused", () => {
    expect(planNames([file(".pinetrie-aside-1/x")], [], false)?.kind).toBe(
      "reserved",
    )
    expect(planNames([file("d/.pinetrie-aside-1")], [], false)).toBeNull()
  })
})

describe("checkStage", () => {
  const writes: AcceptWrite[] = [
    { path: "d/a", expected: null, to: { kind: "file" } },
    { path: "l", expected: null, to: { kind: "symlink", target: "d/a" } },
  ]
  const entry = (
    p: string,
    kind: StageEntry["kind"] = "file",
    ino = 7,
  ): StageEntry => ({ path: p, kind, ino, size: 1, mtimeNs: "9" })
  test("exactly the planned files staged answers their stats", () => {
    expect(checkStage([entry("d", "dir"), entry("d/a")], writes)).toEqual({
      kind: "staged",
      files: new Map([["d/a", { ino: 7, size: 1, mtimeNs: "9" }]]),
    })
  })
  test("an extra path is refused", () => {
    expect(
      checkStage([entry("d", "dir"), entry("d/a"), entry("x")], writes),
    ).toMatchObject({ kind: "refused", path: "x", why: "extra" })
  })
  test("a missing one is refused", () => {
    expect(checkStage([entry("d", "dir")], writes)).toMatchObject({
      kind: "refused",
      path: "d/a",
      why: "missing",
    })
  })
  test("a file under a symlink is refused", () => {
    expect(checkStage([entry("d", "symlink")], writes)).toMatchObject({
      kind: "refused",
      path: "d",
      why: "kind",
    })
  })
  test("a kind other than planned is refused", () => {
    expect(
      checkStage([entry("d", "dir"), entry("d/a", "symlink")], writes),
    ).toMatchObject({ kind: "refused", path: "d/a", why: "kind" })
  })
})

describe("planRecovery", () => {
  const SHOWN = shownMergeId(L1, TURN)
  const staged: InodeStat = { ino: 50, size: 4, mtimeNs: "10" }
  const moved: InodeStat = { ino: 20, size: 1, mtimeNs: "5" }
  const journal = (paths: AcceptPath[]): AcceptJournal => ({
    id: "j1",
    lane: LANE,
    record: record(SHOWN, { kind: "accept", lane: LANE }, L1, TURN),
    paths,
    status: "open",
  })
  const path = (over: Partial<AcceptPath> = {}): AcceptPath => ({
    path: "a",
    aside: ".pinetrie-aside-j1/a",
    moved,
    staged,
    symlink: null,
    linked: false,
    keptOn: null,
    ...over,
  })
  const ours = { kind: "file", ...staged, target: null } as const
  const theirs = { kind: "file", ...moved, target: null } as const
  test("every path linked finishes", () => {
    expect(
      planRecovery(journal([path(), path({ path: "b" })]), [
        { target: ours, aside: moved },
        { target: ours, aside: moved },
      ]),
    ).toEqual({ kind: "finish" })
  })
  test("half linked puts back every path, unlinking only its own", () => {
    const plan = planRecovery(
      journal([path(), path({ path: "b", aside: ".pinetrie-aside-j1/b" })]),
      [
        { target: ours, aside: moved },
        { target: null, aside: moved },
      ],
    )
    expect(plan).toMatchObject({
      kind: "put-back",
      steps: [
        { kind: "unlink-own", path: "a" },
        { kind: "put-back", path: "a", aside: ".pinetrie-aside-j1/a" },
        { kind: "put-back", path: "b", aside: ".pinetrie-aside-j1/b" },
        { kind: "drop-stage", id: "j1" },
      ],
    })
  })
  test("a link whose stat is not the staged one is not unlinked", () => {
    const plan = planRecovery(journal([path(), path({ path: "b" })]), [
      { target: { ...ours, mtimeNs: "11" }, aside: moved },
      { target: null, aside: null },
    ])
    expect(plan.kind === "put-back" && plan.steps[0]).not.toMatchObject({
      kind: "unlink-own",
    })
  })
  test("a save by name since, beside an aside written through, keeps both, the aside on accepted work's newest", () => {
    const plan = planRecovery(journal([path(), path({ path: "b" })]), [
      { target: { ...theirs, ino: 99 }, aside: { ...moved, size: 9 } },
      { target: null, aside: null },
    ])
    expect(plan.kind === "put-back" && plan.journal.paths[0]?.keptOn).toBe(L1)
    expect(plan.kind === "put-back" && plan.journal.status).toBe("put-back")
  })
  test("a save by name since, beside an aside as moved, drops the aside", () => {
    const plan = planRecovery(journal([path(), path({ path: "b" })]), [
      { target: { ...theirs, ino: 99 }, aside: moved },
      { target: null, aside: null },
    ])
    expect(plan.kind === "put-back" && plan.steps[0]).toEqual({
      kind: "drop-aside",
      aside: ".pinetrie-aside-j1/a",
    })
  })
})

describe("planAsides", () => {
  const moved: InodeStat = { ino: 20, size: 1, mtimeNs: "5" }
  const kept = [
    {
      journal: "j1",
      path: "a",
      aside: "x/a",
      moved,
      keptOn: L1,
    },
    { journal: "j1", path: "b", aside: "x/b", moved, keptOn: L1 },
    { journal: "j1", path: "c", aside: "x/c", moved, keptOn: L1 },
  ]
  test("an aside as moved is dropped; one written through is a concurrent save; one gone is nothing", () => {
    expect(planAsides(kept, [moved, { ...moved, size: 2 }, null])).toEqual({
      drop: ["x/a"],
      saves: [{ path: "b", aside: "x/b", on: L1 }],
    })
  })
  test("an open journal's asides are not kept yet", () => {
    const j: AcceptJournal = {
      id: "j1",
      lane: LANE,
      record: record(L2, { kind: "accept", lane: LANE }, L1, TURN),
      paths: journalPaths(
        [{ kind: "delete", path: "a", expected: stamp() }],
        new Map(),
        "j1",
      ).map(p => ({ ...p, keptOn: L2 })),
      status: "open",
    }
    expect(keptAsides([j])).toEqual([])
    expect(keptAsides([{ ...j, status: "accepted" }])).toHaveLength(1)
  })
})

describe("a concurrent save", () => {
  const graph = stateGraph(STATES)
  test("is recorded on a line state", () => {
    expect(
      planState(
        graph,
        record(pointId("concurrent-1"), { kind: "concurrent", path: "a" }, L1),
      ).kind,
    ).toBe("record")
  })
  test("is refused on a lane's state", () => {
    expect(
      planState(
        graph,
        record(
          pointId("concurrent-1"),
          { kind: "concurrent", path: "a" },
          TURN,
        ),
      ),
    ).toEqual({ kind: "refused", why: "concurrent-off-line" })
  })
  test("is never accepted work's newest", () => {
    const g = stateGraph([
      ...STATES,
      record(pointId("concurrent-1"), { kind: "concurrent", path: "a" }, L1),
    ])
    expect(folderNewest(g)).toBe(L1)
  })
})
