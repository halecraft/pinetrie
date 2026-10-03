// Every host record's spec: its key is stored once, as its address, and a
// record reads back whole from what is stored.

import {
  commitId,
  entryId,
  laneNameForThread,
  type OfferRecord,
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
  yourEdits: [],
  described: true,
  edited: false,
  bookmark: "pineta-offer/x",
  taken: null,
  commits: [C],
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
    { prompt: E, text: "done", at: 1, final: true },
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
    { lane: L, work: { kind: "own" }, by: ADA, createdAt: 1 },
    "lane",
  ),
  sample(
    "revision",
    REVISION,
    { entry: E, lane: L, commit: C, snapshot: snapshotId("e-1"), paths: [] },
    "entry",
  ),
  sample(
    "landing",
    LANDING,
    { id: "g-1", lane: L, prompt: E, state: "resolved", by: ADA, at: 1 },
    "id",
  ),
  sample("offer", OFFER, offer, "lane"),
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
    { lane: L, base: { kind: "line" }, start: C, state: "ok" },
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
]

describe.each(SAMPLES)("%s", (_, spec, record, keyField) => {
  test("reads back whole from what is stored, at its address", () => {
    const write = setRecord(spec, record)
    expect(write.key).toBe(spec.keyOf(record))
    const stored = JSON.parse(JSON.stringify(write))
    expect(recordsOf(spec, [stored]).get(write.key)).toEqual(record)
  })

  test("its stored contents never repeat its key", () => {
    if (keyField === null) return
    const contents = setRecord(spec, record).value
    expect(
      typeof contents === "object" && contents !== null && keyField in contents,
    ).toBe(false)
  })

  test("a value stored with its key in its contents too still reads, and the address wins", () => {
    const write = setRecord(spec, record)
    // Only records stored as objects held their key: a name is a string.
    if (keyField === null || typeof write.value !== "object") return
    const old = {
      key: write.key,
      value: { ...(record as object), [keyField]: "a-stale-copy" },
    }
    expect(recordsOf(spec, [old]).get(write.key)).toEqual(record)
  })
})

test("a record keyed by lane does not read at an address that is no lane", () => {
  const write = setRecord(OFFER, offer)
  expect(recordsOf(OFFER, [{ ...write, key: "main" }]).size).toBe(0)
})

test("deleteRecord names the spec's namespace and the key", () => {
  expect(deleteRecord(MARK, E)).toEqual({
    kind: "delete",
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
