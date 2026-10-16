import {
  NOBODY,
  type RootId,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { readRoots } from "@pinetrie/reads"
import { encodeMessage, setRecord, THREAD } from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { planRebuild, startDirectory } from "./directory.ts"
import {
  applyWrites,
  basics,
  deferred,
  hostRoots,
  putValue,
  ROOT_ID,
  record,
  row,
  writesOf,
} from "./fakes.ts"
import type { Records } from "./records.ts"
import { queueUpkeepOn } from "./roots.ts"
import { createSettle } from "./settle.ts"

const said = (text: string) =>
  encodeMessage(
    {
      author: writerId("ada@x.io"),
      authorName: "Ada",
      text,
      compels: NOBODY,
      sendId: "s",
    },
    1,
  )

/**
 * The directory over the real roots' store, `ROOT_ID` held by a lease so the
 * upkeep keeps it loaded: `doc` is its document.
 */
async function setUp() {
  const b = basics()
  const { keeper, roots } = hostRoots({ session: b.session })
  const records = record<Pick<Records, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const held = await keeper.run(async step => step.lease(ROOT_ID))
  const doc = await held.ready
  startDirectory({ basics: b, keeper, records: records.port, roots })
  return { b, keeper, records, roots, held, doc }
}

test("a root's record follows its document: a new entry refreshes it, once per burst", async () => {
  const { b, keeper, records, doc } = await setUp()
  // The refresh as the directory starts is over before the root changes.
  await keeper.idle()
  const before = writesOf(records.calls).length
  writeEntry(doc, row("e1", null, said("plan the rail")))
  writeEntry(doc, row("e2", "e1", said("and the tabs")))
  await keeper.idle()
  expect(writesOf(records.calls)).toHaveLength(before + 1)
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({
    entry: "e1",
    firstLine: "plan the rail",
    messages: 2,
  })
})

test("a change the record does not show writes nothing", async () => {
  const { keeper, records, doc } = await setUp()
  writeEntry(doc, row("e1", null, said("plan")))
  await keeper.idle()
  const before = records.calls.length
  doc.values.set("x", { namespace: "pi.op.state", key: "x", value: 1 })
  await keeper.idle()
  expect(records.calls.length).toBe(before)
})

test("an upkeep queued while refreshes and drains wait runs after all of them, and compacts records that show every change", async () => {
  const { b, keeper, doc } = await setUp()
  const lane = threadIdFor("l")
  const done: string[] = []
  const settle = createSettle({
    basics: b,
    keeper,
    drain: async () => {
      done.push("drain")
    },
    rootOf: () => ROOT_ID,
    settled: () =>
      queueUpkeepOn(keeper, async () => {
        done.push(`compact at ${readRoots(b.session).get(ROOT_ID)?.entry}`)
      }),
  })
  // The refresh as the directory starts would absorb the change below.
  await keeper.idle()
  const gate = deferred<void>()
  void keeper.run(() => gate.promise)
  void settle([lane])
  writeEntry(doc, row("e1", null, said("plan")))
  gate.resolve()
  await keeper.idle()
  expect(done).toEqual(["drain", "compact at e1"])
})

test("five changes to one root before its refresh starts read it once and write it once", async () => {
  const b = basics()
  const { keeper, roots } = hostRoots({ session: b.session })
  const records = record<Pick<Records, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  await using held = await keeper.run(async step => step.lease(ROOT_ID))
  const doc = await held.ready
  // Each read of the document's entries the directory makes.
  let reads = 0
  const counted = new Proxy(doc, {
    get(target, key, receiver) {
      if (key === "entries") reads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  startDirectory({
    basics: b,
    keeper,
    records: records.port,
    roots: {
      ...roots,
      onOpened: listener => roots.onOpened(root => listener(root, counted)),
    },
  })
  await keeper.idle()
  /** The reads one refresh makes after `changes`, made while the keeper is held. */
  const readsFor = async (changes: number, from: number) => {
    reads = 0
    const gate = deferred<void>()
    void keeper.run(() => gate.promise)
    for (let i = from; i < from + changes; i += 1)
      writeEntry(
        doc,
        row(`e${i}`, i === 1 ? null : `e${i - 1}`, said(`step ${i}`)),
      )
    gate.resolve()
    await keeper.idle()
    return reads
  }
  const one = await readsFor(1, 1)
  const written = writesOf(records.calls).length
  const five = await readsFor(5, 2)
  expect([five, writesOf(records.calls).length]).toEqual([one, written + 1])
})

test("a root loaded when the directory starts is refreshed, and an unchanged record is not written again", async () => {
  const b = basics()
  const { keeper, roots } = hostRoots({ session: b.session })
  const records = record<Pick<Records, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  await using held = await keeper.run(async step => step.lease(ROOT_ID))
  writeEntry(await held.ready, row("e1", null, said("plan")))
  const start = () =>
    startDirectory({ basics: b, keeper, records: records.port, roots })
  start()
  await keeper.idle()
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({ entry: "e1" })
  const written = records.calls.length
  // A host started again holds the same root.
  start()
  await keeper.idle()
  expect(records.calls.length).toBe(written)
})

test("a root let go is refreshed once more as it goes, with what changed since its last refresh", async () => {
  const { b, keeper, held, doc } = await setUp()
  await keeper.idle()
  // Written as the upkeep runs: no refresh is queued before it lets go.
  const gate = deferred<void>()
  void keeper.run(() => gate.promise)
  writeEntry(doc, row("e1", null, said("plan")))
  await held[Symbol.asyncDispose]()
  gate.resolve()
  await keeper.idle()
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({ entry: "e1" })
})

test("planRebuild: a root a thread names, with no record that decodes, and held by no document", () => {
  const [a, b, c] = ["a", "b", "c"].map(rootIdFor) as [RootId, RootId, RootId]
  expect(
    planRebuild({
      named: [c, a, b, a],
      recorded: new Set([b]),
      loaded: new Set([c]),
    }),
  ).toEqual([a])
})

test("a starting directory rebuilds a stale record of a root no one holds, loading it once and letting it go", async () => {
  const b = basics()
  const archived = rootIdFor("01a0ffd2-0000-7000-8000-0000000000dd")
  putValue(
    b,
    setRecord(THREAD, {
      thread: threadIdFor("x"),
      root: archived,
      by: writerId("ada@x.io"),
      createdAt: 0,
      origin: { kind: "root" },
    }),
  )
  const { keeper, roots } = hostRoots({ session: b.session })
  // Its one message stored, and let go, before the directory starts.
  await keeper.run(async step =>
    writeEntry(await step.root(archived), row("e1", null, said("plan"))),
  )
  await keeper.idle()
  const records = record<Pick<Records, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  startDirectory({ basics: b, keeper, records: records.port, roots })
  await keeper.idle()
  expect(readRoots(b.session).get(archived)).toMatchObject({ messages: 1 })
  expect(roots.loaded()).not.toContain(archived)
})

test("a root with no message is not recorded: a tab's new root is not started", async () => {
  const b = basics()
  const fresh = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ee")
  const { keeper, roots } = hostRoots({ session: b.session })
  const records = record<Pick<Records, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  startDirectory({ basics: b, keeper, records: records.port, roots })
  await keeper.run(async step => step.root(fresh))
  await keeper.idle()
  expect(readRoots(b.session).has(fresh)).toBe(false)
})
