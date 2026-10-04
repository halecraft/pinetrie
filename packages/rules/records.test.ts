// Every host record's spec: its key is stored once, as its address, and a
// record reads back whole from what is stored.

import {
  commitId,
  entryId,
  laneNameForThread,
  type OfferRecord,
  rootIdFor,
  type Sha256,
  snapshotId,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  ARCHIVE,
  BANNER,
  BASE,
  COMMANDS,
  DIGEST,
  deleteRecord,
  LANDING,
  LANE,
  LINE,
  MARK,
  NAME,
  OFFER,
  PARTICIPANT,
  PROJECT,
  REVISION,
  type RecordSpec,
  ROOT,
  recordsOf,
  SEAT,
  STOP,
  setIfChanged,
  setRecord,
} from "./index.ts"

const ADA = writerId("ada@x.io")
const L = laneNameForThread("1")
const E = entryId("e-1")
const C = commitId("c1")

const offer: OfferRecord = {
  lane: L,
  size: 1,
  stale: false,
  files: ["a.txt"],
  conflicts: [],
  startConflicts: [],
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pineta-offer/x",
  taken: null,
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

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

/** A record's write to the document its home names: the test's root for a root's. */
const writeOf = (spec: RecordSpec<unknown, string>, record: unknown) =>
  spec.home === "root"
    ? setRecord(spec as RecordSpec<unknown, string, "root">, record, TEST_ROOT)
    : setRecord(spec as RecordSpec<unknown, string, "session">, record)

const SAMPLES: readonly Sample[] = [
  sample(
    "archive",
    ARCHIVE,
    { root: E, state: "archived", by: ADA, at: 1 },
    "root",
  ),
  sample("mark", MARK, { entry: E, title: "Plans", by: ADA, at: 1 }, "entry"),
  sample("stop", STOP, { prompt: E, by: ADA, at: 1 }, "prompt"),
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
    "lane",
    LANE,
    { lane: L, root: TEST_ROOT, work: { kind: "own" }, by: ADA, createdAt: 1 },
    "lane",
  ),
  sample(
    "revision",
    REVISION,
    {
      entry: E,
      lane: L,
      commit: C,
      snapshot: snapshotId("e-1"),
      paths: [],
      conflicts: [],
    },
    "entry",
  ),
  sample(
    "landing",
    LANDING,
    { id: "g-1", lane: L, prompt: E, state: "resolved", by: ADA, at: 1 },
    "id",
  ),
  sample(
    "offer",
    OFFER,
    { ...offer, ledger: { source: C, start: [commitId("c0")] } },
    "lane",
  ),
  sample(
    "line",
    LINE,
    {
      onto: "pineta-onto",
      wipPrefix: "wip/",
      commit: C,
      heads: { current: null, proposed: "h" },
      log: { current: null, proposed: "l" },
      wips: [],
      yours: {
        behind: 0,
        ahead: null,
        follow: null,
        conflicts: { commits: 0, files: [] },
      },
      commands: true,
    },
    null,
  ),
  sample(
    "base",
    BASE,
    {
      lane: L,
      base: { kind: "line" },
      start: C,
      state: "ok",
      catchUp: { tip: C, to: C, files: ["a.txt"] },
      untraced: [C],
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
  sample(
    "project",
    PROJECT,
    { kind: "lanes", root: "/p", rootDefault: "own" },
    null,
  ),
  sample("commands", COMMANDS, { commands: [] }, null),
  sample(
    "root",
    ROOT,
    {
      root: TEST_ROOT,
      entry: E,
      first: E,
      firstLine: "Plans",
      title: null,
      messages: 1,
      newest: E,
      writers: [ADA],
      mentions: [{ id: E, by: ADA, text: "@bea look" }],
      images: [],
    },
    "root",
  ),
]

describe.each(SAMPLES)("%s", (_, spec, record, keyField) => {
  test("reads back whole from what is stored, at its address", () => {
    const write = writeOf(spec, record)
    expect(write.key).toBe(spec.keyOf(record))
    const stored = JSON.parse(JSON.stringify(write))
    expect(recordsOf(spec, [stored]).get(write.key)).toEqual(record)
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
      value: { ...(record as object), [keyField]: "a-stale-copy" },
    }
    expect(recordsOf(spec, [old]).get(write.key)).toEqual(record)
  })
})

test("an offer record with no ledger reads back with none, and so does one written before the field (ADR-0065)", () => {
  const stored = OFFER.encode(offer) as Record<string, unknown>
  expect(OFFER.decode(stored, L)).toEqual(offer)
  const { ledger: _, ...before } = stored
  expect(OFFER.decode(before, L)).toEqual(offer)
})

test("a record keyed by lane does not read at an address that is no lane", () => {
  const write = setRecord(OFFER, offer)
  expect(recordsOf(OFFER, [{ ...write, key: "main" }]).size).toBe(0)
})

test("each record lives where it is read (ADR-0063): across roots in the session, by entry in its root", () => {
  const homes = Object.fromEntries(
    SAMPLES.map(([name, spec]) => [name, spec.home]),
  )
  expect(homes).toEqual({
    archive: "session",
    mark: "root",
    stop: "root",
    digest: "root",
    seat: "session",
    participant: "session",
    lane: "session",
    revision: "root",
    landing: "session",
    offer: "session",
    line: "session",
    base: "session",
    name: "session",
    banner: "session",
    project: "session",
    commands: "session",
    root: "session",
  })
})

test("a write goes to the document its home names", () => {
  expect(setRecord(OFFER, offer).target).toEqual({ kind: "session" })
  expect(
    setRecord(MARK, { entry: E, title: "Plans", by: ADA, at: 1 }, TEST_ROOT)
      .target,
  ).toEqual({ kind: "root", root: TEST_ROOT })
  // @ts-expect-error a root's record names its root
  setRecord(MARK, { entry: E, title: "Plans", by: ADA, at: 1 })
  // @ts-expect-error a session's record names none
  setRecord(OFFER, offer, TEST_ROOT)
})

test("deleteRecord names the spec's namespace and the key", () => {
  expect(deleteRecord(MARK, E, TEST_ROOT)).toEqual({
    kind: "delete",
    target: { kind: "root", root: TEST_ROOT },
    namespace: "pineta.mark",
    key: E,
  })
})

describe("setIfChanged", () => {
  test("an unchanged host record is not written again; a changed or new one is", () => {
    expect(setIfChanged(OFFER, offer, structuredClone(offer))).toEqual([])
    expect(setIfChanged(OFFER, offer, undefined)).toEqual([
      setRecord(OFFER, offer),
    ])
    expect(setIfChanged(OFFER, offer, { ...offer, size: 2 })).toHaveLength(1)
  })

  test("the same record with its keys in another order is unchanged", () => {
    const reordered = Object.fromEntries(
      Object.entries(offer).reverse(),
    ) as unknown as OfferRecord
    expect(setIfChanged(OFFER, offer, reordered)).toEqual([])
  })
})
