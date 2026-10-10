// `KynetaStorage`'s shell: a replica's index rebuilt from another's writes,
// and the edges of its seqs and value keys that pi's conformance suite does
// not reach.
import {
  appendList,
  BACKGROUND_CONTEXT,
  deleteValue,
  insertEntry,
  insertUsage,
  list,
  setValue,
  value,
} from "@earendil-works/pi-agent-core"
import { exportSince, merge, version } from "@kyneta/schema"
import { entryId, threadIdFor } from "@pinetrie/core"
import { newRootDoc, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { emptyUsage } from "./deep.ts"
import { KynetaStorage } from "./storage.ts"
import { threadContext } from "./thread-context.ts"

// Every commit here writes in one thread, as a lane's or the scribe's does.
const ctx = threadContext(threadIdFor("a"), BACKGROUND_CONTEXT)

const message = (id: string, parentId: string | null) =>
  insertEntry({
    id,
    parentId,
    type: "message",
    message: { role: "user", content: id, timestamp: 1 },
  })

test("a replica indexes another's writes from merged changes, parents first", async () => {
  const docA = newRootDoc()
  const docB = newRootDoc()
  const a = new KynetaStorage({ doc: docA, peerId: "a" })
  const b = new KynetaStorage({ doc: docB, peerId: "b" })
  const sync = () => {
    const delta = exportSince(docA, version(docB))
    if (delta !== null) merge(docB, delta)
  }
  const usage = { ...emptyUsage(), input: 5 }

  await a.commit(
    [
      message("z1", null),
      message("m2", "z1"),
      insertUsage({ id: "u1", usage, adjustment: false }),
      setValue(value("ns", "k1"), 1),
      setValue(value("ns", "k2"), 2),
      appendList(list("ns", "l"), "x"),
    ],
    ctx,
  )
  sync()
  await b.getStats(ctx)
  await a.commit(
    [
      message("a3", "m2"),
      insertUsage({ id: "u2", usage, adjustment: false }),
      setValue(value("ns", "k1"), 10),
      deleteValue(value("ns", "k2")),
      appendList(list("ns", "l"), "y"),
    ],
    ctx,
  )
  sync()

  const read = async (s: KynetaStorage) => ({
    entries: (await s.scanEntries({}, ctx)).map(({ seq: _, ...e }) => e),
    usage: (await s.scanUsage({ order: "desc" }, ctx)).map(
      ({ seq: _, ...u }) => u,
    ),
    stats: await s.getStats(ctx),
    values: (await s.scanValues(value("ns", ""), ctx)).map(v => [
      v.address.key,
      v.value,
    ]),
    list: (await s.readList(list("ns", "l"), undefined, ctx)).map(e => e.value),
  })
  const fromB = await read(b)
  expect(fromB).toEqual(await read(a))
  expect(fromB.values).toEqual([["k1", 10]])
  expect(fromB.stats.messageCount).toBe(3)

  const seqs = new Map((await b.scanEntries({}, ctx)).map(e => [e.id, e.seq]))
  for (const [child, parent] of [
    ["m2", "z1"],
    ["a3", "m2"],
  ] as const)
    expect(seqs.get(parent) ?? Number.NaN).toBeLessThan(
      seqs.get(child) ?? Number.NaN,
    )
})

test("a value written without a token, as writeLaneTip writes one, stays readable", async () => {
  const doc = newRootDoc()
  const lane = threadIdFor("0123456789abcdef")
  writeLaneTip(doc, lane, entryId("e-1"))
  const storage = new KynetaStorage({ doc })
  const tip = value("pi.branch.tip", lane)
  expect((await storage.getValue(tip, ctx))?.value).toBe("e-1")
  await storage.commit([setValue(value("ns", "k"), 1)], ctx)
  expect((await storage.getValue(tip, ctx))?.value).toBe("e-1")
})

test("a commit ending in a delete still uses up that delete's seq", async () => {
  const storage = new KynetaStorage()
  const first = await storage.commit(
    [setValue(value("ns", "k"), 1), deleteValue(value("ns", "k"))],
    ctx,
  )
  expect(first.seqs).toEqual([1, 2])
  const second = await storage.commit([setValue(value("ns", "k"), 2)], ctx)
  expect(second.firstSeq).toBe(3)
})

test("scanValues keeps to its namespace: a prefix of `a` is not one of `ab`", async () => {
  const storage = new KynetaStorage()
  await storage.commit(
    [setValue(value("a", "x"), 1), setValue(value("ab", "x"), 2)],
    ctx,
  )
  expect(
    (await storage.scanValues(value("a", ""), ctx)).map(
      v => v.address.namespace,
    ),
  ).toEqual(["a"])
})

test("a commit whose context names no thread throws on its entries and writes nothing; one that moves only a tip needs no thread (ADR-0125)", async () => {
  const doc = newRootDoc()
  const storage = new KynetaStorage({ doc })
  await expect(
    storage.commit([message("e1", null)], BACKGROUND_CONTEXT),
  ).rejects.toThrow(/names no thread/)
  expect(doc.entries()).toEqual({})
  const lane = threadIdFor("0123456789abcdef")
  await storage.commit(
    [setValue(value("pi.branch.tip", lane), null)],
    BACKGROUND_CONTEXT,
  )
  expect(
    (await storage.getValue(value("pi.branch.tip", lane), ctx))?.value,
  ).toBe(null)
})
