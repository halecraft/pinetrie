import { NOBODY, writerId } from "@pineta/core"
import { encodeChat } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readRoots } from "@pineta/reads"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { createDirectory } from "./directory.ts"
import { applyWrites, basics, ROOT_ID, record, row, writesOf } from "./fakes.ts"
import { createSerial } from "./queue.ts"

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
  const serial = createSerial()
  const agent = record<Pick<Agent, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const directory = createDirectory({
    basics: b,
    serial,
    agent: () => agent.port,
  })
  directory.watch(ROOT_ID, b.root)
  return { b, serial, agent, directory }
}

test("a root's record follows its document: a new entry refreshes it, once per burst (ADR-0063)", async () => {
  const { b, serial, agent } = setUp()
  writeEntry(b.root, row("e1", null, chat("plan the rail")))
  writeEntry(b.root, row("e2", "e1", chat("and the tabs")))
  await serial.idle()
  expect(writesOf(agent.calls)).toHaveLength(1)
  expect(readRoots(b.session).get(ROOT_ID)).toMatchObject({
    entry: "e1",
    firstLine: "plan the rail",
    messages: 2,
  })
})

test("a change the record does not show writes nothing", async () => {
  const { b, serial, agent } = setUp()
  writeEntry(b.root, row("e1", null, chat("plan")))
  await serial.idle()
  const before = agent.calls.length
  b.root.values.set("x", { namespace: "pi.op.state", key: "x", value: 1 })
  await serial.idle()
  expect(agent.calls.length).toBe(before)
})

test("flush writes a queued refresh in the caller's step, and the queued step then writes nothing", async () => {
  const { b, serial, agent, directory } = setUp()
  let release = () => {}
  void serial.run(() => new Promise<void>(r => (release = r)))
  writeEntry(b.root, row("e1", null, chat("plan")))
  await directory.flush()
  expect(readRoots(b.session).get(ROOT_ID)?.entry).toBe("e1")
  release()
  await serial.idle()
  expect(writesOf(agent.calls)).toHaveLength(1)
})
