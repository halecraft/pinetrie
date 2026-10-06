import { createInMemoryStore, Exchange, type Store } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import {
  entryId,
  laneNameForThread,
  rootDocId,
  rootIdFor,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readMarks, readNames } from "@pinetrie/reads"
import { MARK, NAME, setRecord } from "@pinetrie/rules"
import { physicalKey, RootDoc, readLaneTip, SessionDoc } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { moveLosses, planRecordsMove } from "./0002-records.ts"
import { migrate, planStoredOpen, readStored } from "./index.ts"

/** `StorageDoc` as it was: a root's and the session's schema before ADR-0095. */
const OldStorageDoc = json.bind(
  Schema.struct({
    entries: Schema.record(
      Schema.struct.json({
        id: Schema.string(),
        parentId: Schema.string().nullable(),
        type: Schema.string(),
        timestamp: Schema.number(),
        fromId: Schema.string().nullable(),
        payload: Schema.any(),
      }),
    ),
    usageRows: Schema.record(Schema.any()),
    values: Schema.record(Schema.any()),
    lists: Schema.record(Schema.list(Schema.any())),
    checkpointText: Schema.record(Schema.text()),
  }),
)

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const LANE = laneNameForThread("0190a0a0-0000-7000-8000-000000000001")
const ENTRY = entryId("e-1")
const mark = setRecord(
  MARK,
  { entry: ENTRY, title: "Plans", by: writerId("ada@x.io"), at: 1 },
  ROOT,
)
const name = setRecord(NAME, {
  lane: LANE,
  name: "amber-fox" as ThreadName,
  at: 1,
})
/** A host record as pi stored it: wrapped, at its physical key. */
const asPiValue = (w: typeof mark | typeof name, wid: string) =>
  [
    physicalKey(w.namespace, w.key),
    { namespace: w.namespace, key: w.key, value: w.value, wid },
  ] as const
const tip = [
  physicalKey("pi.branch.tip", LANE),
  { namespace: "pi.branch.tip", key: LANE, value: ENTRY, wid: "w-0" },
] as const

describe("planRecordsMove", () => {
  test("moves the host's records and keeps pi's values, losing nothing", () => {
    const values = Object.fromEntries([asPiValue(mark, "w-1"), tip])
    const move = planRecordsMove(values)
    expect(move).toEqual({
      writes: [{ ...mark, target: { kind: "session" } }],
      moved: [physicalKey(MARK.namespace, ENTRY)],
      kept: ["pi.branch.tip"],
    })
    expect(moveLosses(values, move)).toEqual([])
  })

  test("a move that drops a record is a loss, named by its namespace", () => {
    const values = Object.fromEntries([asPiValue(mark, "w-1")])
    expect(moveLosses(values, { writes: [], moved: [], kept: [] })).toEqual([
      MARK.namespace,
    ])
  })
})

describe("a store from before ADR-0095", () => {
  /** The session and one root, written as the old host wrote them. */
  async function oldStore(): Promise<Store> {
    const store = createInMemoryStore()
    const ex = new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store,
    })
    const session = ex.get(SESSION_DOC_ID, OldStorageDoc)
    const root = ex.get(rootDocId(ROOT), OldStorageDoc)
    await ex.whenHydrated(SESSION_DOC_ID)
    await ex.whenHydrated(rootDocId(ROOT))
    batch(session, d => {
      const [k, v] = asPiValue(name, "w-2")
      d.values.set(k, v)
    })
    batch(root, d => {
      const [k, v] = asPiValue(mark, "w-1")
      d.values.set(k, v)
      d.values.set(tip[0], tip[1])
    })
    await ex.flush()
    return store
  }

  test("is migrated on start: each record readable where it now lives, pi's values kept, and nothing left to plan", async () => {
    const store = await oldStore()
    const plan = planStoredOpen(await readStored(store))
    if (plan.kind !== "open") throw new Error(plan.kind)
    expect(
      plan.run.map(r => [r.migration.name, r.migration.kind, r.docIds]),
    ).toEqual([
      ["0002-records", "session", [SESSION_DOC_ID]],
      ["0002-records", "root", [rootDocId(ROOT)]],
    ])
    const ex = new Exchange({
      principal: "host",
      type: "service",
      transports: [],
      store,
    })
    await migrate({ plan, exchange: ex, backup: null, log: () => {} })
    const session = ex.get(SESSION_DOC_ID, SessionDoc)
    const root = ex.get(rootDocId(ROOT), RootDoc)
    await ex.whenHydrated(SESSION_DOC_ID)
    await ex.whenHydrated(rootDocId(ROOT))
    expect(readNames(session).get(LANE)).toBe("amber-fox")
    expect(readMarks(root).get(ENTRY)?.title).toBe("Plans")
    expect(readLaneTip(root, LANE)).toBe(ENTRY)
    expect(Object.keys(root.values())).toEqual([tip[0]])
    expect(Object.keys(session())).toEqual(["records"])
    expect(planStoredOpen(await readStored(store))).toEqual({
      kind: "open",
      run: [],
      unknown: [],
    })
  })
})
