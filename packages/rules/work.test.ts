import {
  BASE_SNAPSHOT,
  entryId,
  NO_SHARED,
  pointId,
  type RevisionRecord,
  rootIdFor,
  snapshotId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { indexTree } from "@pinetrie/threads"
import { fromParents, personMessage } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import {
  decodeRecords,
  forkSource,
  LANE_FORK,
  LANE as LANE_RECORD,
  PROJECT,
  planLaneRecords,
  REVISION,
  setRecord,
  sourceHistory,
} from "./index.ts"
import {
  planForkEnd,
  planForkRedo,
  planRetention,
  planTurn,
  planTurnRecord,
  planTurnRevision,
  showHostWorkingCopy,
} from "./work.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada")
const C1 = pointId("c1")
const C2 = pointId("c2")

describe("a lane's fork: owed with its record, begun at its end", () => {
  const lane = {
    lane: LANE,
    root: rootIdFor("test-root"),
    history: "jj" as const,
    by: ADA,
    createdAt: 1,
  }
  test("a fork record round-trips owed, and begun with or without lost", () => {
    for (const fork of [
      { lane: LANE, base: "wip", state: "owed" },
      {
        lane: LANE,
        base: null,
        state: "begun",
        lost: snapshotId("e1"),
        instead: "point",
      },
      {
        lane: LANE,
        base: null,
        state: "begun",
        lost: snapshotId("e1"),
        instead: "base",
      },
      { lane: LANE, base: null, state: "begun", lost: null, instead: null },
    ] as const) {
      const w = setRecord(LANE_FORK, fork)
      expect(LANE_FORK.decode(w.value, w.key)).toEqual(fork)
    }
  })
  test("a fork begun before it was said where its files came from lost them to its base", () => {
    expect(
      LANE_FORK.decode({ base: null, state: "begun", lost: "e1" }, LANE),
    ).toMatchObject({ lost: "e1", instead: "base" })
  })
  test("a begun fork with no lost does not decode", () => {
    expect(
      LANE_FORK.decode({ base: null, state: "begun" }, LANE),
    ).toBeUndefined()
  })
  test("planLaneRecords: a lane of its own is recorded with its fork owed, in one write", () => {
    expect(
      planLaneRecords({ record: lane, base: "wip" }).map(w => [
        w.namespace,
        w.value,
      ]),
    ).toEqual([
      ["pinetrie.lane", LANE_RECORD.encode(lane)],
      ["pinetrie.lane-fork", { base: "wip", state: "owed" }],
    ])
    expect(
      planLaneRecords({ record: { ...lane, history: null }, base: null }).map(
        w => w.namespace,
      ),
    ).toEqual(["pinetrie.lane"])
  })
})

describe("records: one spec each, total decoders", () => {
  const lane = {
    lane: LANE,
    root: rootIdFor("test-root"),
    history: "jj" as const,
    by: ADA,
    createdAt: 1,
  }
  const revision = {
    entry: entryId("e1"),
    lane: LANE,
    point: C1,
    snapshot: snapshotId("e1"),
    paths: ["a.txt", "d/c é.txt"],
    conflicts: ["b.txt"],
    disk: {
      derived: { paths: ["node_modules"], more: 0 },
      private: { paths: [".env"], more: 2 },
      unignored: ["dist"],
      leftovers: ["big.bin"],
      shared: NO_SHARED,
    },
  }
  const project = {
    root: "/p",
    kind: "folder" as const,
    owner: writerId("duane@x.io"),
  }
  test("each record round-trips, keyed as its reader expects", () => {
    const l = setRecord(LANE_RECORD, lane)
    expect([l.namespace, l.key, LANE_RECORD.decode(l.value, l.key)]).toEqual([
      "pinetrie.lane",
      LANE,
      lane,
    ])
    const r = setRecord(REVISION, revision, rootIdFor("test-root"))
    expect([r.key, REVISION.decode(r.value, r.key)]).toEqual(["e1", revision])
    const p = setRecord(PROJECT, project)
    expect(PROJECT.decode(p.value, p.key)).toEqual(project)
  })
  test("a direct lane's prompt records no commit and no disk, and that decodes", () => {
    expect(
      REVISION.decode({ ...revision, point: null, snapshot: null }, "e1"),
    ).toEqual({ ...revision, point: null, snapshot: null })
  })
  test("a turn's record in an older shape is dropped: its migration moved every one", () => {
    for (const field of ["snapshot", "paths", "conflicts", "disk"] as const) {
      const { [field]: _, ...old } = revision
      expect(REVISION.decode(old, "e1")).toBeUndefined()
    }
    const { point, ...rest } = revision
    expect(REVISION.decode({ ...rest, commit: point }, "e1")).toBeUndefined()
  })
  test("a lane's history round-trips as its kind, or null for no copy of its own", () => {
    for (const history of ["jj", "folder", null] as const) {
      const stored = LANE_RECORD.encode({ ...lane, history })
      expect(stored).toMatchObject({ history })
      expect(LANE_RECORD.decode(stored, LANE)?.history).toBe(history)
    }
  })
  test("malformed values are dropped, never thrown: a lane of an unknown history among them", () => {
    const stored = LANE_RECORD.encode(lane) as Record<string, unknown>
    const other = threadIdFor("other")
    expect([
      ...decodeRecords(LANE_RECORD, [
        {
          key: other,
          value: { ...stored, history: "svn" },
        },
        { key: "main", value: stored },
        { key: other, value: 3 },
        { key: LANE, value: stored },
      ]).values(),
    ]).toEqual([lane])
  })
})

describe("planTurnRecord: every prompt, and every turn with tool calls", () => {
  const S = snapshotId("e")
  const base = {
    entry: entryId("e"),
    lane: LANE,
    newest: C1,
    snapshot: S,
    toolCalls: false,
    own: true,
    paths: ["a.txt"],
    conflicts: ["x.txt"],
    merged: false,
  }
  test("a turn whose catch_up merged names the bookmark it moved, with no paths; its own commit wins", () => {
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: null,
        merged: true,
      }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      point: C1,
      snapshot: S,
      paths: [],
      conflicts: ["x.txt"],
      disk: null,
    })
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: C2,
        merged: true,
      })?.point,
    ).toBe(C2)
  })
  test("a prompt always gets a record: its disk, and a commit of edits, else the newest revision", () => {
    expect(planTurnRecord({ ...base, isPrompt: true, committed: C2 })).toEqual({
      entry: base.entry,
      lane: LANE,
      point: C2,
      snapshot: S,
      paths: ["a.txt"],
      conflicts: ["x.txt"],
      disk: null,
    })
    // The newest revision is what came before the prompt: no paths of its own.
    expect(
      planTurnRecord({ ...base, isPrompt: true, committed: null }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      point: C1,
      snapshot: S,
      paths: [],
      // The newest revision's conflicts: a branch from the prompt clones it.
      conflicts: ["x.txt"],
      disk: null,
    })
  })
  test("a turn with tool calls gets its disk, and a commit only when one was made", () => {
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: C2,
      }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      point: C2,
      snapshot: S,
      paths: ["a.txt"],
      conflicts: ["x.txt"],
      disk: null,
    })
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: null,
      }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      point: null,
      snapshot: S,
      paths: [],
      conflicts: [],
      disk: null,
    })
  })
  test("a turn with no tool calls and nothing committed gets none", () => {
    expect(
      planTurnRecord({ ...base, isPrompt: false, committed: null }),
    ).toBeNull()
  })
  test("a lane working directly records its prompts with neither, and nothing else", () => {
    const direct = { ...base, own: false, snapshot: null, committed: null }
    expect(planTurnRecord({ ...direct, isPrompt: true })).toEqual({
      entry: base.entry,
      lane: LANE,
      point: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      disk: null,
    })
    expect(
      planTurnRecord({ ...direct, isPrompt: false, toolCalls: true }),
    ).toBeNull()
  })
})

describe("forkSource: a snapshot to clone, and what to start on", () => {
  const S = snapshotId("e")
  const begin = {
    kind: "accepted",
    acceptedBookmark: "pinetrie-accepted",
    point: pointId("l1"),
  } as const
  const NEW = threadIdFor("new")
  const record = (lane: typeof LANE, history: "jj" | "folder") => ({
    lane,
    root: rootIdFor("test-root"),
    history,
    by: ADA,
    createdAt: 1,
  })
  const lanes = new Map([[LANE, record(LANE, "jj")]])
  const fork = (
    input: Pick<Parameters<typeof forkSource>[0], "above" | "begin" | "kept"> &
      Partial<Parameters<typeof forkSource>[0]>,
  ) =>
    forkSource({
      pointKept: false,
      nearestKept: null,
      lane: record(NEW, "jj"),
      lanes,
      kind: "jj",
      ...input,
    })
  test("from a turn: its snapshot and the commit above", () => {
    expect(
      fork({
        above: {
          lane: LANE,
          point: C2,
          pointLane: LANE,
          snapshot: S,
          snapshotLane: LANE,
        },
        begin,
        kept: true,
      }),
    ).toEqual({
      kind: "source",
      snapshot: S,
      start: { kind: "recorded", points: [C2] },
      lost: null,
      instead: null,
    })
  })
  test("from a turn whose snapshot is gone in an open lane: the nearest older snapshot, and the turn's commit", () => {
    const older = snapshotId("e0")
    expect(
      fork({
        above: {
          lane: LANE,
          point: C2,
          pointLane: LANE,
          snapshot: S,
          snapshotLane: LANE,
        },
        begin,
        kept: false,
        pointKept: true,
        nearestKept: older,
      }),
    ).toEqual({
      kind: "source",
      snapshot: older,
      start: { kind: "recorded", points: [C2] },
      lost: S,
      instead: "point",
    })
  })
  test("from a folder turn whose snapshot is gone: its state's own snapshot, and the state", () => {
    expect(
      fork({
        above: {
          lane: LANE,
          point: pointId("turn-1"),
          pointLane: LANE,
          snapshot: S,
          snapshotLane: LANE,
        },
        begin,
        kept: false,
        pointKept: true,
        nearestKept: snapshotId("e0"),
        lane: record(NEW, "folder"),
        lanes: new Map([[LANE, record(LANE, "folder")]]),
        kind: "folder",
      }),
    ).toMatchObject({ snapshot: "turn-1", lost: S, instead: "point" })
  })
  test("from a turn whose snapshot is gone and whose point is not (an archived lane's): the base snapshot and where agent work begins, its snapshot named lost", () => {
    expect(
      fork({
        above: {
          lane: LANE,
          point: C2,
          pointLane: LANE,
          snapshot: S,
          snapshotLane: LANE,
        },
        begin,
        kept: false,
      }),
    ).toEqual({
      kind: "source",
      snapshot: BASE_SNAPSHOT,
      start: begin,
      lost: S,
      instead: "base",
    })
  })
  test("from a lane before lane containers: the base snapshot at its commit", () => {
    expect(
      fork({
        above: {
          lane: LANE,
          point: C2,
          pointLane: LANE,
          snapshot: null,
          snapshotLane: null,
        },
        begin,
        kept: true,
      }),
    ).toEqual({
      kind: "source",
      snapshot: BASE_SNAPSHOT,
      start: { kind: "recorded", points: [C2] },
      lost: null,
      instead: null,
    })
  })
  test("from nothing: the base snapshot, and where agent work begins", () => {
    expect(
      fork({
        above: {
          lane: null,
          point: null,
          pointLane: null,
          snapshot: null,
          snapshotLane: null,
        },
        begin,
        kept: true,
      }),
    ).toEqual({
      kind: "source",
      snapshot: BASE_SNAPSHOT,
      start: begin,
      lost: null,
      instead: null,
    })
  })
  test("a disk of another kind than the new lane's record is refused", () => {
    const folder = new Map([[LANE, record(LANE, "folder")]])
    const above = {
      lane: LANE,
      point: C2,
      pointLane: LANE,
      snapshot: S,
      snapshotLane: LANE,
    }
    expect(
      forkSource({
        above,
        begin,
        kept: true,
        pointKept: false,
        nearestKept: null,
        lane: record(NEW, "jj"),
        lanes: folder,
        kind: "jj",
      }),
    ).toEqual({ kind: "foreign", lane: NEW, history: "folder" })
  })
})

describe("sourceHistory: the kind of the disk a fork clones", () => {
  const S = snapshotId("e")
  const lanes = new Map([
    [
      LANE,
      {
        lane: LANE,
        root: rootIdFor("test-root"),
        history: "folder" as const,
        by: ADA,
        createdAt: 1,
      },
    ],
  ])
  const at = (snapshot: typeof S | null) => ({
    snapshot,
    snapshotLane: snapshot === null ? null : LANE,
  })
  test("a kept snapshot's lane's; the base's, or a lost snapshot's, the project's", () => {
    expect(sourceHistory({ above: at(S), kept: true, lanes, kind: "jj" })).toBe(
      "folder",
    )
    expect(
      sourceHistory({ above: at(null), kept: true, lanes, kind: "jj" }),
    ).toBe("jj")
    expect(
      sourceHistory({ above: at(S), kept: false, lanes, kind: "jj" }),
    ).toBe("jj")
  })
})

describe("planRetention: which snapshots go", () => {
  const B = threadIdFor("2")
  const rec = (entry: string, lane = LANE): RevisionRecord => ({
    entry: entryId(entry),
    lane,
    point: null,
    snapshot: snapshotId(entry),
    paths: [],
    conflicts: [],
    disk: null,
  })
  const records = [
    rec("01-a"),
    rec("03-a"),
    rec("02-a"),
    rec("04-b", B),
    rec("05-b", B),
    { ...rec("06-d"), snapshot: null },
  ]
  test("an open root keeps every snapshot", () => {
    expect(
      planRetention({ records, archived: false, keep: new Set() }),
    ).toEqual([])
  })
  test("an archived root keeps each lane's newest", () => {
    expect(planRetention({ records, archived: true, keep: new Set() })).toEqual(
      ["01-a", "02-a", "04-b"],
    )
  })
  test("an archived root keeps the snapshots it is asked to keep", () => {
    expect(
      planRetention({
        records,
        archived: true,
        keep: new Set([snapshotId("02-a")]),
      }),
    ).toEqual(["01-a", "04-b"])
  })
  test("the base snapshot is never deleted", () => {
    expect(
      planRetention({
        records: [{ ...rec("00-a"), snapshot: BASE_SNAPSHOT }, rec("01-a")],
        archived: true,
        keep: new Set(),
      }),
    ).toEqual([])
  })
})

describe("showHostWorkingCopy: whole path prefixes only", () => {
  test("a root followed by a separator, or by a non-path character, is shown under /mnt/host-working-copy", () => {
    expect(showHostWorkingCopy("read /r/x.ts", "/r")).toBe(
      "read /mnt/host-working-copy/x.ts",
    )
    expect(showHostWorkingCopy('{"path":"/r/a.ts"}', "/r")).toBe(
      '{"path":"/mnt/host-working-copy/a.ts"}',
    )
    expect(showHostWorkingCopy("cd /r && ls", "/r")).toBe(
      "cd /mnt/host-working-copy && ls",
    )
    expect(showHostWorkingCopy("/r", "/r/")).toBe("/mnt/host-working-copy")
  })
  test("never inside a longer name, nor inside a longer path", () => {
    expect(showHostWorkingCopy("/r/workspace/t-ab/x", "/r/workspace/t-a")).toBe(
      "/r/workspace/t-ab/x",
    )
    expect(showHostWorkingCopy("/x/r/y", "/r")).toBe("/x/r/y")
    expect(showHostWorkingCopy("/rr/y", "/r")).toBe("/rr/y")
  })
  test("the file system's root is never a working copy's", () => {
    expect(showHostWorkingCopy("/etc/hosts", "/")).toBe("/etc/hosts")
  })
})

describe("a turn, around its commit", () => {
  const TURN_LANE = threadIdFor("turns")
  const tree = indexTree(
    fromParents({ p: null, a: "p" }, id =>
      id === "p"
        ? personMessage("do it")
        : {
            role: "assistant",
            content: [
              { type: "toolCall", id: "c1", name: "bash", arguments: {} },
            ],
          },
    ),
  )

  test("a lane with no copy of its own records its prompts alone, with no state", () => {
    expect(
      planTurn({ index: tree, tip: entryId("p"), lane: TURN_LANE, own: false }),
    ).toMatchObject({
      kind: "record",
      revision: { entry: entryId("p"), point: null, snapshot: null },
    })
    expect(
      planTurn({ index: tree, tip: entryId("a"), lane: TURN_LANE, own: false }),
    ).toEqual({ kind: "none" })
  })

  test("a lane of its own commits the turn its tip ends, snapshotted under its entry, and records what the commit made", () => {
    const turn = planTurn({
      index: tree,
      tip: entryId("a"),
      lane: TURN_LANE,
      own: true,
    })
    expect(turn).toMatchObject({
      kind: "commit",
      entry: entryId("a"),
      isPrompt: false,
      toolCalls: true,
      snapshot: snapshotId(entryId("a")),
    })
    if (turn.kind !== "commit") throw new Error("committed")
    expect(
      planTurnRevision(turn, {
        committed: pointId("1111"),
        newest: pointId("0000"),
        paths: ["a.txt"],
        conflicts: [],
      }),
    ).toMatchObject({ point: pointId("1111"), paths: ["a.txt"] })
  })
})

test("planForkEnd: the history's start records, then the fork begun, its lost carried, in one write", () => {
  const lane = threadIdFor("1")
  const start = setRecord(LANE_FORK, { lane, base: null, state: "owed" })
  const writes = planForkEnd({
    fork: { lane, base: "wip", state: "owed" },
    lost: snapshotId("e1"),
    instead: "point",
    start: { writes: [start] },
  })
  expect(writes.map(w => ("value" in w ? w.value : null))).toEqual([
    start.value,
    { base: "wip", state: "begun", lost: "e1", instead: "point" },
  ])
})

test("planForkRedo: a fork run again is owed until its end; a first one writes nothing", () => {
  const lane = threadIdFor("2")
  expect(planForkRedo({ lane, base: "wip", state: "owed" })).toEqual([])
  expect(
    planForkRedo({
      lane,
      base: "wip",
      state: "begun",
      lost: null,
      instead: null,
    }),
  ).toEqual([setRecord(LANE_FORK, { lane, base: "wip", state: "owed" })])
})
