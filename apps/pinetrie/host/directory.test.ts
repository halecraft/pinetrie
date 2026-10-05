import { laneNameForThread, NOBODY, writerId } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { Scribe } from "@pinetrie/pi"
import { readRoots } from "@pinetrie/reads"
import { encodeChat } from "@pinetrie/rules"
import { writeEntry } from "@pinetrie/schema"
import { expect, test } from "vitest"
import type { HostKey } from "./basics.ts"
import { startDirectory } from "./directory.ts"
import {
  applyWrites,
  basics,
  deferred,
  ROOT_ID,
  record,
  row,
  writesOf,
} from "./fakes.ts"
import { createSettle } from "./settle.ts"

const chat = (text: string) =>
  encodeChat(
    {
      author: writerId("ada@x.io"),
      authorName: "Ada",
      text,
      compels: NOBODY,
      sendId: "s",
    },
    1,
  )

function setUp() {
  const b = basics()
  const keeper = createKeeper<HostKey>()
  const scribe = record<Pick<Scribe, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  startDirectory({ basics: b, keeper, scribe: scribe.port })
  return { b, keeper, scribe }
}

test("a root's record follows its document: a new entry refreshes it, once per burst (ADR-0063)", async () => {
  const { b, keeper, scribe } = setUp()
  // The refresh as the directory starts is over before the root changes.
  await keeper.idle()
  const before = writesOf(scribe.calls).length
  writeEntry(b.root, row("e1", null, chat("plan the rail")))
  writeEntry(b.root, row("e2", "e1", chat("and the tabs")))
  await keeper.idle()
  expect(writesOf(scribe.calls)).toHaveLength(before + 1)
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({
    entry: "e1",
    firstLine: "plan the rail",
    messages: 2,
  })
})

test("a change the record does not show writes nothing", async () => {
  const { b, keeper, scribe } = setUp()
  writeEntry(b.root, row("e1", null, chat("plan")))
  await keeper.idle()
  const before = scribe.calls.length
  b.root.values.set("x", { namespace: "pi.op.state", key: "x", value: 1 })
  await keeper.idle()
  expect(scribe.calls.length).toBe(before)
})

test("a compaction queued while refreshes and drains wait runs after all of them, and compacts records that show every change", async () => {
  const { b, keeper } = setUp()
  const lane = laneNameForThread("l")
  const done: string[] = []
  const settle = createSettle({
    basics: b,
    keeper,
    drain: async () => {
      done.push("drain")
    },
    rootOf: () => ROOT_ID,
    compact: async () => {
      done.push(`compact at ${readRoots(b.session).get(ROOT_ID)?.entry}`)
    },
    sweep: async () => {},
  })
  // The refresh as the directory starts would absorb the change below.
  await keeper.idle()
  const gate = deferred<void>()
  void keeper.run(() => gate.promise)
  void settle([lane])
  writeEntry(b.root, row("e1", null, chat("plan")))
  gate.resolve()
  await keeper.idle()
  expect(done).toEqual(["drain", "compact at e1"])
})

test("five changes to one root before its refresh starts read and write it once", async () => {
  const b = basics()
  const keeper = createKeeper<HostKey>()
  const scribe = record<Pick<Scribe, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  let reads = 0
  startDirectory({
    basics: {
      ...b,
      docs: {
        ...b.docs,
        view: root => {
          reads += 1
          return b.docs.view(root)
        },
      },
    },
    keeper,
    scribe: scribe.port,
  })
  await keeper.idle()
  reads = 0
  const written = writesOf(scribe.calls).length
  const gate = deferred<void>()
  void keeper.run(() => gate.promise)
  for (let i = 1; i <= 5; i += 1)
    writeEntry(
      b.root,
      row(`e${i}`, i === 1 ? null : `e${i - 1}`, chat(`step ${i}`)),
    )
  gate.resolve()
  await keeper.idle()
  expect(reads).toBe(1)
  expect(writesOf(scribe.calls)).toHaveLength(written + 1)
})

test("the roots held when the directory starts are refreshed, and an unchanged record is not written again (ADR-0077)", async () => {
  const b = basics()
  const keeper = createKeeper<HostKey>()
  const scribe = record<Pick<Scribe, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  writeEntry(b.root, row("e1", null, chat("plan")))
  const start = () => startDirectory({ basics: b, keeper, scribe: scribe.port })
  start()
  await keeper.idle()
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({ entry: "e1" })
  const written = scribe.calls.length
  // A host started again holds the same root.
  start()
  await keeper.idle()
  expect(scribe.calls.length).toBe(written)
})
