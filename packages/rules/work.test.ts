import {
  BASE_SNAPSHOT,
  commitId,
  entryId,
  type RevisionRecord,
  rootIdFor,
  snapshotId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  forkPoint,
  LANE as LANE_RECORD,
  PROJECT,
  planTurnRecord,
  REVISION,
  recordsOf,
  setRecord,
} from "./index.ts"
import {
  classifyDisk,
  ignoredFiles,
  planRetention,
  showHostWorkingCopy,
} from "./work.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada")
const C1 = commitId("c1")
const C2 = commitId("c2")

describe("records: one spec each, total decoders", () => {
  const lane = {
    lane: LANE,
    root: rootIdFor("test-root"),
    ownCopy: true,
    by: ADA,
    createdAt: 1,
  }
  const revision = {
    entry: entryId("e1"),
    lane: LANE,
    commit: C1,
    snapshot: snapshotId("e1"),
    paths: ["a.txt", "d/c é.txt"],
    conflicts: ["b.txt"],
    ignored: { paths: [".env", "dist"], more: 2 },
    recipe: "ran" as const,
  }
  const project = { root: "/p" }
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
      REVISION.decode({ ...revision, commit: null, snapshot: null }, "e1"),
    ).toEqual({ ...revision, commit: null, snapshot: null })
  })
  test("a record from before lane containers has no snapshot key: it decodes as none", () => {
    const { snapshot: _, ...old } = revision
    expect(REVISION.decode(old, "e1")).toEqual({ ...old, snapshot: null })
  })
  test("a record from before conflicts were recorded decodes with none", () => {
    const { conflicts: _, ...old } = revision
    expect(REVISION.decode(old, "e1")).toEqual({ ...old, conflicts: [] })
  })
  test("a project record from when a lane could work directly reads as its root alone, and is rewritten at start", () => {
    expect(
      PROJECT.decode(
        { kind: "lanes", root: "/p", rootDefault: "own" },
        "project",
      ),
    ).toEqual({ root: "/p" })
  })
  test("a lane's copy of its own is stored as its work, as records from when a lane could work directly hold it", () => {
    expect(LANE_RECORD.encode(lane)).toMatchObject({ work: { kind: "own" } })
    expect(LANE_RECORD.encode({ ...lane, ownCopy: false })).toMatchObject({
      work: null,
    })
    const none = LANE_RECORD.encode({ ...lane, ownCopy: false })
    expect(LANE_RECORD.decode(none, LANE)?.ownCopy).toBe(false)
  })
  test("malformed values are dropped, never thrown: a lane stored as working directly among them", () => {
    const stored = LANE_RECORD.encode(lane) as Record<string, unknown>
    const other = threadIdFor("other")
    expect([
      ...recordsOf(LANE_RECORD, [
        {
          key: other,
          value: { ...stored, work: { kind: "direct", dir: "/p" } },
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
      commit: C1,
      snapshot: S,
      paths: [],
      conflicts: ["x.txt"],
      ignored: null,
      recipe: null,
    })
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: C2,
        merged: true,
      })?.commit,
    ).toBe(C2)
  })
  test("a prompt always gets a record: its disk, and a commit of edits, else the newest revision", () => {
    expect(planTurnRecord({ ...base, isPrompt: true, committed: C2 })).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: C2,
      snapshot: S,
      paths: ["a.txt"],
      conflicts: ["x.txt"],
      ignored: null,
      recipe: null,
    })
    // The newest revision is what came before the prompt: no paths of its own.
    expect(
      planTurnRecord({ ...base, isPrompt: true, committed: null }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: C1,
      snapshot: S,
      paths: [],
      // The newest revision's conflicts: a branch from the prompt clones it.
      conflicts: ["x.txt"],
      ignored: null,
      recipe: null,
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
      commit: C2,
      snapshot: S,
      paths: ["a.txt"],
      conflicts: ["x.txt"],
      ignored: null,
      recipe: null,
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
      commit: null,
      snapshot: S,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
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
      commit: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      ignored: null,
      recipe: null,
    })
    expect(
      planTurnRecord({ ...direct, isPrompt: false, toolCalls: true }),
    ).toBeNull()
  })
})

describe("forkPoint: a snapshot to clone, and what to start on", () => {
  const S = snapshotId("e")
  const begin = {
    kind: "accepted",
    acceptedBookmark: "pinetrie-accepted",
    commit: commitId("l1"),
  } as const
  test("from a turn: its snapshot and the commit above", () => {
    expect(
      forkPoint({
        above: { lane: LANE, commit: C2, commitLane: LANE, snapshot: S },
        begin,
        kept: true,
      }),
    ).toEqual({
      snapshot: S,
      start: { kind: "commits", commits: [C2] },
      lost: null,
    })
  })
  test("from a turn whose snapshot is gone: the base snapshot and where agent work begins, its snapshot named lost", () => {
    expect(
      forkPoint({
        above: { lane: LANE, commit: C2, commitLane: LANE, snapshot: S },
        begin,
        kept: false,
      }),
    ).toEqual({ snapshot: BASE_SNAPSHOT, start: begin, lost: S })
  })
  test("from a lane before lane containers: the base snapshot at its commit", () => {
    expect(
      forkPoint({
        above: { lane: LANE, commit: C2, commitLane: LANE, snapshot: null },
        begin,
        kept: true,
      }),
    ).toEqual({
      snapshot: BASE_SNAPSHOT,
      start: { kind: "commits", commits: [C2] },
      lost: null,
    })
  })
  test("from nothing: the base snapshot, and where agent work begins", () => {
    expect(
      forkPoint({
        above: { lane: null, commit: null, commitLane: null, snapshot: null },
        begin,
        kept: true,
      }),
    ).toEqual({ snapshot: BASE_SNAPSHOT, start: begin, lost: null })
  })
})

describe("planRetention: which snapshots go", () => {
  const B = threadIdFor("2")
  const rec = (entry: string, lane = LANE): RevisionRecord => ({
    entry: entryId(entry),
    lane,
    commit: null,
    snapshot: snapshotId(entry),
    paths: [],
    conflicts: [],
    ignored: null,
    recipe: null,
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

describe("classifyDisk: what each path a turn's whole-disk diff names is", () => {
  const change = (
    path: string,
    change: "added" | "changed" | "deleted" = "added",
  ) => ({
    path,
    change,
    kind: "file" as const,
  })
  const classes = classifyDisk({
    diff: {
      changes: [
        change("src/a.ts", "changed"),
        change("src/new"),
        change("src/new/b.ts"),
        change(".jj/repo/op"),
        change(".pinetrie-lane/derived.json"),
        change("node_modules/x"),
        change(".pnpm-store/v10/y"),
        change(".plans"),
        change(".env"),
        change("dist"),
        change("dist/app.js"),
        change("old.log", "deleted"),
      ],
    },
    tracked: ["src/a.ts", "src/new/b.ts"],
    outputs: ["node_modules"],
    caches: [".pnpm-store"],
    shared: [".plans"],
  })
  test("tracked, own, derived, cache, and the ignored rest", () => {
    expect(Object.fromEntries(classes)).toEqual({
      "src/a.ts": "tracked",
      "src/new": "tracked",
      "src/new/b.ts": "tracked",
      ".jj/repo/op": "own",
      ".pinetrie-lane/derived.json": "own",
      "node_modules/x": "derived",
      ".pnpm-store/v10/y": "cache",
      ".plans": "own",
      ".env": "ignored",
      dist: "ignored",
      "dist/app.js": "ignored",
      "old.log": "ignored",
    })
  })
  test("ignoredFiles: the topmost, sorted; a directory stands for what is under it", () => {
    expect(ignoredFiles(classes)).toEqual({
      paths: [".env", "dist", "old.log"],
      more: 0,
    })
    expect(ignoredFiles(new Map([["a", "tracked" as const]]))).toBeNull()
    const many = new Map(
      Array.from({ length: 103 }, (_, i) => [
        `f${String(i).padStart(3, "0")}`,
        "ignored" as const,
      ]),
    )
    expect(ignoredFiles(many)?.paths).toHaveLength(100)
    expect(ignoredFiles(many)?.more).toBe(3)
  })
  test("a record from before turns diffed their disk decodes with neither", () => {
    const old = setRecord(
      REVISION,
      {
        entry: entryId("e1"),
        lane: LANE,
        commit: C1,
        snapshot: snapshotId("e1"),
        paths: [],
        conflicts: [],
        ignored: { paths: ["x"], more: 0 },
        recipe: "ran",
      },
      rootIdFor("test-root"),
    )
    const {
      ignored: _i,
      recipe: _r,
      ...value
    } = old.value as Record<string, unknown>
    expect(REVISION.decode(value, old.key)).toMatchObject({
      ignored: null,
      recipe: null,
    })
  })
})
