import { readdirSync } from "node:fs"
import { cardIdFor } from "@pinetrie/threads/fixtures"
// Every host record's spec: its key is stored once, as its address, and a
// record reads back whole from what is stored.

import {
  canvasIdFor,
  commitId,
  entryId,
  type JjProposedChangesRecord,
  type ProposedChangesRecord,
  pointFromCommit,
  pointId,
  rootIdFor,
  SESSION_TARGET,
  type Sha256,
  snapshotId,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { ALLOWANCE } from "./allowance.ts"
import type { BaseRecord } from "./base.ts"
import { testWorkflow } from "./fixtures.ts"
import {
  ACCEPTED,
  ACCESS,
  BANNER,
  BASE,
  byTarget,
  CARD_HISTORY,
  COMMANDS,
  CONFLICT,
  DIGEST,
  decodeFolderStamps,
  decodeRecords,
  deleteRecord,
  encodeFolderStamps,
  FOLDER_WRITE_JOURNAL,
  ICONS,
  LANE,
  MARK,
  NAME,
  PARTICIPANT,
  PICTURE,
  PROJECT,
  PROPOSED_CHANGES,
  planKindSweep,
  planUndeclaredSweep,
  QUEUE_HOLD,
  RECORD_SPECS,
  REVISION,
  type RecordSpec,
  ROOT,
  RUN_END_REPORT,
  SEAT,
  STATE,
  setIfChanged,
  setRecord,
  TRACE,
  WORKFLOW,
} from "./index.ts"
import type { RootRecord } from "./roots.ts"

const ADA = writerId("ada@x.io")
const L = threadIdFor("1")
const E = entryId("e-1")
const C = commitId("c1")
const DIGESTED = {
  prompt: E,
  headline: "Done",
  points: [],
  at: 1,
  final: true,
}

const proposed: JjProposedChangesRecord = {
  kind: "jj",
  lane: L,
  size: 1,
  stale: false,
  files: ["a.txt"],
  conflicts: [],
  startConflicts: [],
  workingCopyEdits: [],
  described: true,
  edited: false,
  bookmark: "pinetrie-proposed/x",
  acceptedAs: null,
  commits: [C],
  ledger: null,
  at: 1,
}

/** A spec and a record of it, erased to one type so a table can hold both. */
type Sample = readonly [
  string,
  RecordSpec<unknown, string>,
  unknown,
  /** The record's key field, which the stored contents must not hold. */
  string | null,
]
const sample = <R, K extends string>(
  name: string,
  spec: RecordSpec<R, K>,
  record: NoInfer<R>,
  keyField: (keyof R & string) | null,
): Sample => [name, spec as RecordSpec<unknown, string>, record, keyField]

const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const TEST_THREAD = threadIdFor("e")
const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

/** A record's write to the document its home names: the test's root for a root's. */
const writeOf = (spec: RecordSpec<unknown, string>, record: unknown) =>
  spec.home === "root"
    ? setRecord(spec as RecordSpec<unknown, string, "root">, record, TEST_ROOT)
    : setRecord(spec as RecordSpec<unknown, string, "session">, record)

const rootRecord: RootRecord = {
  root: TEST_ROOT,
  entry: E,
  first: E,
  firstLine: "Plans",
  messages: 1,
  newest: E,
  writers: [ADA],
  threads: { [L]: [ADA] },
  mentions: [{ id: E, by: ADA, text: "@bea look", thread: L }],
  blobs: [],
}

const SAMPLES: readonly Sample[] = [
  sample(
    "workflow",
    WORKFLOW,
    testWorkflow([{ id: workflowStateIdFor("1"), name: "Doing" }], {
      id: workflowStateIdFor("2"),
      name: "Done",
    }),
    null,
  ),
  sample(
    "mark",
    MARK,
    { canvas: TEST_CANVAS, title: "Plans", by: ADA, at: 1 },
    "canvas",
  ),
  sample(
    "digest",
    DIGEST,
    { prompt: E, headline: "Done", points: ["`a.ts`"], at: 1, final: true },
    "prompt",
  ),
  sample(
    "seat",
    SEAT,
    { peer: "p-1", clientId: 7, writer: ADA, at: 1 },
    "peer",
  ),
  sample("participant", PARTICIPANT, { writer: ADA, name: "Ada" }, "writer"),
  sample(
    "picture",
    PICTURE,
    { writer: ADA, sha256: "b".repeat(64) as Sha256 },
    "writer",
  ),
  sample(
    "lane",
    LANE,
    { lane: L, root: TEST_ROOT, history: "jj", by: ADA, createdAt: 1 },
    "lane",
  ),
  sample(
    "revision",
    REVISION,
    {
      entry: E,
      lane: L,
      point: pointFromCommit(C),
      snapshot: snapshotId("e-1"),
      paths: [],
      conflicts: [],
      disk: null,
    },
    "entry",
  ),
  sample(
    "proposed",
    PROPOSED_CHANGES,
    { ...proposed, ledger: { source: C, start: [commitId("c0")] } },
    "lane",
  ),
  sample(
    "line",
    ACCEPTED,
    {
      kind: "jj",
      acceptedBookmark: "pinetrie-accepted",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: C, behind: 1, ahead: 0 },
      commit: C,
      heads: { current: null, proposed: "h" },
      log: { current: null, proposed: "l" },
      unfinishedWork: [],
      workingCopy: {
        behind: 0,
        ahead: 0,
        getLatest: null,
        conflicts: { commits: 0, files: [] },
      },
      publishCatchesUp: true,
    },
    null,
  ),
  sample(
    "base",
    BASE,
    {
      kind: "jj",
      lane: L,
      base: { kind: "accepted" },
      start: C,
      state: "ok",
      getLatest: { tip: C, to: C, files: ["a.txt"] },
      untraced: [C],
      work: "some",
    },
    "lane",
  ),
  sample(
    "a folder's proposed changes",
    PROPOSED_CHANGES,
    {
      kind: "folder",
      lane: L,
      start: pointId("line-0192aaaa"),
      tip: pointId("turn-0192bbbb"),
      files: ["a.txt"],
      conflicts: [],
      description: null,
      at: 1,
    },
    "lane",
  ),
  sample(
    "a folder's accepted work",
    ACCEPTED,
    { kind: "folder", newest: pointId("line-0192aaaa"), kept: [], at: 1 },
    null,
  ),
  sample(
    "a folder lane's base",
    BASE,
    {
      kind: "folder",
      lane: L,
      start: pointId("line-0192aaaa"),
      getLatest: {
        tip: pointId("turn-0192bbbb"),
        to: pointId("line-0192cccc"),
        files: ["a.txt"],
      },
      work: "some",
    },
    "lane",
  ),
  sample(
    "name",
    NAME,
    { lane: L, name: "amber-fox" as ThreadName, at: 1 },
    "lane",
  ),
  sample(
    "banner",
    BANNER,
    { lane: L, sha: "a".repeat(64) as Sha256, at: 1 },
    "lane",
  ),
  sample("queue hold", QUEUE_HOLD, { lane: L, by: ADA, at: 1 }, "lane"),
  sample(
    "budget",
    ALLOWANCE,
    { message: E, thread: L, by: ADA, limit: 200, spent: 10, over: false },
    "message",
  ),
  sample("project", PROJECT, { root: "/p", kind: "jj", owner: ADA }, null),
  sample(
    "access",
    ACCESS,
    {
      lane: L,
      personal: { kind: "allowed", host: "pop", by: ADA, at: 1 },
      outside: { host: "hql", key: "SHA256:k", at: 2 },
      services: ["deploy"],
      hosts: ["pop"],
    },
    "lane",
  ),
  sample("commands", COMMANDS, { commands: [] }, null),
  sample("icons", ICONS, { source: "built-in" }, null),
  sample("root", ROOT, rootRecord, "root"),
  sample(
    "card history",
    CARD_HISTORY,
    {
      card: cardIdFor("c1"),
      events: [
        {
          kind: "created",
          by: ADA,
          from: null,
          to: { kind: "composing", thread: L },
          at: 1,
        },
        {
          kind: "moved",
          by: null,
          from: {
            kind: "composing",
            thread: L,
          },
          to: { kind: "inventory", holder: ADA },
          at: 2,
        },
      ],
    },
    "card",
  ),
  sample(
    "trace",
    TRACE,
    {
      id: "t-1",
      for: ADA,
      card: cardIdFor("c1"),
      by: writerId("bea@x.io"),
      from: {
        kind: "pinned",
        thread: TEST_THREAD,
      },
      to: null,
      message: entryId("e-3"),
      at: 3,
    },
    "id",
  ),
  sample(
    "state",
    STATE,
    {
      id: pointId("e-2"),
      parents: [pointId("line-1"), pointId("e-1")],
      made: { kind: "turn", lane: L, entry: E },
      at: 1,
      by: ADA,
    },
    "id",
  ),
  sample(
    "state of a concurrent save",
    STATE,
    {
      id: pointId("concurrent-1"),
      parents: [pointId("line-1")],
      made: { kind: "concurrent", path: "a.txt" },
      at: 1,
      by: null,
    },
    "id",
  ),
  sample(
    "accept's journal",
    FOLDER_WRITE_JOURNAL,
    {
      id: "0190-a",
      record: {
        id: pointId("shown-1"),
        parents: [pointId("line-1"), pointId("e-1")],
        made: { kind: "accept", lane: L },
        at: 1,
        by: ADA,
      },
      paths: [
        {
          path: "a.txt",
          aside: ".pinetrie-aside-0190-a/a.txt",
          moved: { ino: 4, size: 2, mtimeNs: "123" },
          staged: { ino: 5, size: 3, mtimeNs: "124" },
          symlink: null,
          linked: true,
          keptOn: pointId("shown-1"),
        },
      ],
      status: "written",
    },
    "id",
  ),
  sample(
    "conflict",
    CONFLICT,
    {
      lane: L,
      path: "docs/a:b.md",
      base: pointId("bases-1"),
      ours: pointId("e-1"),
      theirs: pointId("line-2"),
    },
    null,
  ),
  sample(
    "run-end report",
    RUN_END_REPORT,
    {
      lane: L,
      ask: E,
      end: entryId("e-2"),
      report: { kind: "stopped", by: ADA },
    },
    "lane",
  ),
]

describe.each(SAMPLES)("%s", (_, spec, record, keyField) => {
  test("reads back whole from what is stored, at its address", () => {
    const write = writeOf(spec, record)
    expect(write.key).toBe(spec.keyOf(record))
    const stored = JSON.parse(JSON.stringify(write))
    expect(decodeRecords(spec, [stored]).get(write.key)).toEqual(record)
  })

  test("its stored contents never repeat its key", () => {
    if (keyField === null) return
    const contents = writeOf(spec, record).value
    expect(
      typeof contents === "object" && contents !== null && keyField in contents,
    ).toBe(false)
  })

  test("a value stored with its key in its contents too still reads, and the address wins", () => {
    const write = writeOf(spec, record)
    // Only records stored as objects held their key: a name is a string.
    if (keyField === null || typeof write.value !== "object") return
    const old = {
      key: write.key,
      value: { ...(write.value as object), [keyField]: "a-stale-copy" },
    }
    expect(decodeRecords(spec, [old]).get(write.key)).toEqual(record)
  })
})

test("a record stored before records had a kind does not decode", () => {
  const { kind: _o, ...proposedBefore } = PROPOSED_CHANGES.encode(
    proposed,
  ) as Record<string, unknown>
  expect(PROPOSED_CHANGES.decode(proposedBefore, L)).toBeUndefined()
})

test("a proposed-changes record with no ledger reads back with none; one missing a field does not decode", () => {
  const stored = PROPOSED_CHANGES.encode(proposed) as Record<string, unknown>
  expect(PROPOSED_CHANGES.decode(stored, L)).toEqual(proposed)
  const { ledger: _, ...noLedger } = stored
  expect(PROPOSED_CHANGES.decode(noLedger, L)).toBeUndefined()
  const { acceptedAs: __, ...noAccepted } = stored
  expect(PROPOSED_CHANGES.decode(noAccepted, L)).toBeUndefined()
})

test("a root record in an older shape does not decode: it is derived, and the directory rebuilds it", () => {
  const stored = ROOT.encode(rootRecord) as Record<string, unknown>
  const { threads: _, ...noThreads } = stored
  expect(ROOT.decode(noThreads, TEST_ROOT)).toBeUndefined()
  const mentionNoThread = {
    ...stored,
    mentions: [{ id: E, by: ADA, text: "@bea look" }],
  }
  expect(ROOT.decode(mentionNoThread, TEST_ROOT)).toBeUndefined()
  expect(ROOT.derived).toBe(true)
})

test("a root record's thread that is no lane is dropped, and the record kept", () => {
  const stored = ROOT.encode({
    ...rootRecord,
    threads: { [L]: [ADA], main: [ADA] } as RootRecord["threads"],
  })
  expect(ROOT.decode(stored, TEST_ROOT)?.threads).toEqual({ [L]: [ADA] })
})

test("a record keyed by lane does not read at an address that is no lane", () => {
  const write = setRecord(PROPOSED_CHANGES, proposed)
  expect(
    decodeRecords(PROPOSED_CHANGES, [{ ...write, key: "main" }]).size,
  ).toBe(0)
})

test("each record lives where it is read: across roots in the session, by entry in its root", () => {
  const homes = Object.fromEntries(
    SAMPLES.map(([name, spec]) => [name, spec.home]),
  )
  expect(homes).toEqual({
    workflow: "session",
    mark: "session",
    digest: "root",
    seat: "session",
    participant: "session",
    picture: "session",
    lane: "session",
    revision: "root",
    proposed: "session",
    line: "session",
    base: "session",
    "a folder's proposed changes": "session",
    "a folder's accepted work": "session",
    "a folder lane's base": "session",
    name: "session",
    banner: "session",
    access: "session",
    "queue hold": "session",
    budget: "session",
    project: "session",
    commands: "session",
    icons: "session",
    root: "session",
    "card history": "session",
    trace: "session",
    state: "session",
    "state of a concurrent save": "session",
    "accept's journal": "session",
    conflict: "session",
    "run-end report": "session",
  })
})

test("a conflict does not read at an address with no lane before its path", () => {
  const value = { base: "a-1", ours: "a-2", theirs: "a-3" }
  expect(CONFLICT.decode(value, "main:a.txt")).toBeUndefined()
  expect(CONFLICT.decode(value, `${L}:`)).toBeUndefined()
  expect(CONFLICT.decode(value, "a.txt")).toBeUndefined()
})

test("a write goes to the document its home names", () => {
  expect(setRecord(PROPOSED_CHANGES, proposed).target).toEqual({
    kind: "session",
  })
  expect(setRecord(DIGEST, DIGESTED, TEST_ROOT).target).toEqual({
    kind: "root",
    root: TEST_ROOT,
  })
  // @ts-expect-error a root's record names its root
  setRecord(DIGEST, DIGESTED)
  // @ts-expect-error a session's record names none
  setRecord(PROPOSED_CHANGES, proposed, TEST_ROOT)
})

test("deleteRecord names the spec's namespace and the key", () => {
  expect(deleteRecord(DIGEST, E, TEST_ROOT)).toEqual({
    kind: "delete",
    target: { kind: "root", root: TEST_ROOT },
    namespace: "pinetrie.digest",
    key: E,
  })
})

test("planKindSweep deletes the proposed changes, accepted work and bases of the other kind, and no other record", () => {
  const F = threadIdFor("f")
  const folderProposed = {
    kind: "folder",
    lane: F,
    start: pointId("line-0192aaaa"),
    tip: pointId("turn-0192bbbb"),
    files: [],
    conflicts: [],
    description: null,
    at: 1,
  } as const
  const folderBase = {
    kind: "folder",
    lane: F,
    start: pointId("line-0192aaaa"),
    getLatest: null,
    work: "none",
  } as const
  const records = {
    proposedByLane: new Map<ThreadId, ProposedChangesRecord>([
      [L, proposed],
      [F, folderProposed],
    ]),
    accepted: {
      kind: "folder",
      newest: pointId("line-0192aaaa"),
      kept: [],
      at: 1,
    },
    bases: new Map<ThreadId, BaseRecord>([[F, folderBase]]),
  } as const
  const swept = (kind: "jj" | "folder") =>
    planKindSweep(records, kind).map(w => [w.namespace, w.key])
  expect(swept("jj")).toEqual([
    ["pinetrie.proposed", F],
    ["pinetrie.accepted", "accepted"],
    ["pinetrie.base", F],
  ])
  expect(swept("folder")).toEqual([["pinetrie.proposed", L]])
})

test("planUndeclaredSweep deletes a record stored outside its spec's home: a root's mark, from before canvases", () => {
  const root = rootIdFor("r-1")
  expect(
    planUndeclaredSweep([
      {
        target: { kind: "root", root },
        namespaces: new Map([["pinetrie.mark", ["e-1"]]]),
      },
    ]),
  ).toEqual([
    {
      kind: "delete",
      target: { kind: "root", root },
      namespace: "pinetrie.mark",
      key: "e-1",
    },
  ])
})

describe("setIfChanged", () => {
  test("an unchanged host record is not written again; a changed or new one is", () => {
    expect(
      setIfChanged(PROPOSED_CHANGES, proposed, structuredClone(proposed)),
    ).toEqual([])
    expect(setIfChanged(PROPOSED_CHANGES, proposed, undefined)).toEqual([
      setRecord(PROPOSED_CHANGES, proposed),
    ])
    expect(
      setIfChanged(PROPOSED_CHANGES, proposed, { ...proposed, size: 2 }),
    ).toHaveLength(1)
  })

  test("the same record with its keys in another order is unchanged", () => {
    const reordered = Object.fromEntries(
      Object.entries(proposed).reverse(),
    ) as unknown as JjProposedChangesRecord
    expect(setIfChanged(PROPOSED_CHANGES, proposed, reordered)).toEqual([])
  })
})

describe("every spec, and writes by document", () => {
  test("RECORD_SPECS holds every spec this package exports, one per namespace", async () => {
    // Every module, not the index: the index holds only what another
    // package imports, and a spec no other package names is a spec still.
    const modules = await Promise.all(
      readdirSync(import.meta.dirname)
        .filter(f => f.endsWith(".ts") && !/\.test\.ts$|^fixtures\.ts$/.test(f))
        .map(
          f =>
            // A URL, not a template Vite would try to resolve at build time.
            import(
              /* @vite-ignore */ new URL(f, import.meta.url).href
            ) as Promise<Record<string, unknown>>,
        ),
    )
    const exported = modules
      .flatMap(m => Object.values(m))
      .filter(
        v =>
          typeof v === "object" &&
          v !== null &&
          "namespace" in v &&
          "decode" in v &&
          "keyOf" in v,
      )
    expect(new Set(RECORD_SPECS)).toEqual(new Set(exported))
    const namespaces = RECORD_SPECS.map(s => s.namespace)
    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  test("planUndeclaredSweep deletes every record of a namespace no spec declares, where it is", () => {
    const root = rootIdFor("r-1")
    const writes = planUndeclaredSweep([
      {
        target: SESSION_TARGET,
        namespaces: new Map([
          ["pinetrie.line", ["line"]],
          ["pinetrie.proposed", ["t-1"]],
        ]),
      },
      {
        target: { kind: "root", root },
        namespaces: new Map([["pinetrie.gone", ["a", "b"]]]),
      },
    ])
    expect(writes).toEqual([
      {
        kind: "delete",
        target: SESSION_TARGET,
        namespace: "pinetrie.line",
        key: "line",
      },
      {
        kind: "delete",
        target: { kind: "root", root },
        namespace: "pinetrie.gone",
        key: "a",
      },
      {
        kind: "delete",
        target: { kind: "root", root },
        namespace: "pinetrie.gone",
        key: "b",
      },
    ])
    expect(
      planUndeclaredSweep(
        RECORD_SPECS.map(spec => ({
          target:
            spec.home === "session" ? SESSION_TARGET : { kind: "root", root },
          namespaces: new Map([[spec.namespace, ["k"]]]),
        })),
      ),
    ).toEqual([])
  })

  test("byTarget groups writes by their document, in the order each first appears", () => {
    const root = rootIdFor("r-1")
    const name = setRecord(NAME, {
      lane: threadIdFor("t-1"),
      name: "amber-fox" as ThreadName,
      at: 1,
    })
    const marked = setRecord(DIGEST, DIGESTED, root)
    const unmarked = deleteRecord(DIGEST, E, root)
    expect(byTarget([marked, name, unmarked])).toEqual([
      [{ kind: "root", root }, [marked, unmarked]],
      [{ kind: "session" }, [name]],
    ])
  })
})

test("the project's folder's stamps read back whole; a file that is not them reads as none", () => {
  const stamps = new Map([
    [
      "a.txt",
      { kind: "file", size: 1, ctimeNs: "1700000000123456789", exec: true },
    ],
    ["l", { kind: "symlink", size: 1, ctimeNs: "2", exec: false, target: "a" }],
  ] as const)
  expect(decodeFolderStamps(encodeFolderStamps(stamps))).toEqual(stamps)
  expect(decodeFolderStamps("not json")).toBeNull()
  expect(decodeFolderStamps('{"a":{"kind":"dir"}}')).toBeNull()
})
