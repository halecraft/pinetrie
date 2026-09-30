import { entryId, writerId } from "@pineta/core"
import { ARCHIVE_NAMESPACE, encodeArchive } from "@pineta/marginalia"
import type { Reply } from "@pineta/protocol/messages"
import { physicalKey, writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, record, row } from "../fakes.ts"
import { type CommandDeps, createCommands } from "./index.ts"

const ALICE = writerId("alice@example.com")
const ROOT_ID = entryId("e-1")

function setUp() {
  const b = basics()
  writeEntry(b.doc, row(ROOT_ID, null))
  const agent = record<CommandDeps["agent"]>({
    appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
  })
  const commands = createCommands({
    basics: b,
    agent: agent.port,
    work: record<CommandDeps["work"]>().port,
    blobs: record<CommandDeps["blobs"]>().port,
    notes: record<CommandDeps["notes"]>().port,
    start: () => {
      throw new Error("no run here")
    },
  })
  const replies: Reply[] = []
  const sender = { send: (r: Reply) => void replies.push(r) }
  const chat = (id: string) =>
    ({
      id,
      kind: "chat",
      text: "hello",
      parentId: ROOT_ID,
      mode: "reply",
      lane: "",
      asksAgent: false,
    }) as never
  return { b, agent, commands, replies, sender, chat }
}

test("a chat in an archived root is refused, and the agent is never called", async () => {
  const { b, agent, commands, replies, sender, chat } = setUp()
  b.doc.values.set(physicalKey(ARCHIVE_NAMESPACE, ROOT_ID), {
    namespace: ARCHIVE_NAMESPACE,
    key: ROOT_ID,
    value: encodeArchive({
      root: ROOT_ID,
      state: "archived",
      by: ALICE,
      at: 1,
    }),
  })
  await commands.handle(sender, ALICE, chat("c-1"))
  expect(replies[0]).toMatchObject({ id: "c-1", outcome: "refused" })
  expect(replies[0]?.errorMessage).toMatch(/^archived by /)
  expect(agent.calls).toEqual([])
})

test("the command's id is the send's id", async () => {
  const { agent, commands, replies, sender, chat } = setUp()
  await commands.handle(sender, ALICE, chat("c-2"))
  expect(replies[0]).toMatchObject({ id: "c-2", outcome: "appended" })
  expect(agent.calls[0]?.args[0]).toMatchObject({
    details: { sendId: "c-2" },
  })
})

test("a seat whose principal names nobody is refused whatever it sends", async () => {
  const { agent, commands, replies, sender, chat } = setUp()
  await commands.handle(sender, undefined, chat("c-3"))
  expect(replies[0]).toMatchObject({ outcome: "refused" })
  expect(agent.calls).toEqual([])
})
