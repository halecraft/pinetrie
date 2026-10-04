import { laneNameForThread, NOBODY, writerId } from "@pineta/core"
import { createKeeper } from "@pineta/keeper"
import type { Agent } from "@pineta/pi"
import { readRoots } from "@pineta/reads"
import { encodeChat } from "@pineta/rules"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import type { HostKey } from "./basics.ts"
import { createDirectory } from "./directory.ts"
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
  const agent = record<Pick<Agent, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const directory = createDirectory({
    basics: b,
    keeper,
    agent: () => agent.port,
  })
  directory.watch(ROOT_ID, b.root)
  return { b, keeper, agent, directory }
}

test("a root's record follows its document: a new entry refreshes it, once per burst (ADR-0063)", async () => {
  const { b, keeper, agent } = setUp()
  writeEntry(b.root, row("e1", null, chat("plan the rail")))
  writeEntry(b.root, row("e2", "e1", chat("and the tabs")))
  await keeper.idle()
  expect(writesOf(agent.calls)).toHaveLength(1)
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({
    entry: "e1",
    firstLine: "plan the rail",
    messages: 2,
  })
})

test("a change the record does not show writes nothing", async () => {
  const { b, keeper, agent } = setUp()
  writeEntry(b.root, row("e1", null, chat("plan")))
  await keeper.idle()
  const before = agent.calls.length
  b.root.values.set("x", { namespace: "pi.op.state", key: "x", value: 1 })
  await keeper.idle()
  expect(agent.calls.length).toBe(before)
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
  const agent = record<Pick<Agent, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  let reads = 0
  const directory = createDirectory({
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
    agent: () => agent.port,
  })
  directory.watch(ROOT_ID, b.root)
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
  expect(writesOf(agent.calls)).toHaveLength(1)
})

test("a root is refreshed as it is watched, with no change to it, and an unchanged record is not written again (ADR-0077)", async () => {
  const b = basics()
  const keeper = createKeeper<HostKey>()
  const agent = record<Pick<Agent, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  writeEntry(b.root, row("e1", null, chat("plan")))
  const open = () =>
    createDirectory({ basics: b, keeper, agent: () => agent.port }).watch(
      ROOT_ID,
      b.root,
    )
  open()
  await keeper.idle()
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({ entry: "e1" })
  const written = agent.calls.length
  // A host started again opens the same root.
  open()
  await keeper.idle()
  expect(agent.calls.length).toBe(written)
})
