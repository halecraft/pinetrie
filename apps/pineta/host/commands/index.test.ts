import {
  atEntry,
  cardId,
  ERR,
  entryId,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { ARCHIVE_NAMESPACE, encodeArchive } from "@pineta/marginalia"
import type { WireCommand } from "@pineta/protocol/codec"
import type { Reply } from "@pineta/protocol/messages"
import { readPlaces } from "@pineta/reads"
import { writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, record, row } from "../fakes.ts"
import { applyPlaceStep } from "../places.ts"
import { type CommandDeps, createCommands } from "./index.ts"

const ALICE = writerId("alice@example.com")
const ROOT_ID = entryId("e-1")
const HELD = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
const NEW = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a3067862240")

function setUp() {
  const b = basics()
  const cards = record<CommandDeps["cards"]>({
    writers: async () => [],
    destroy: async () => {},
  })
  const drains: string[] = []
  writeEntry(b.doc, row(ROOT_ID, null))
  const agent = record<CommandDeps["agent"]>({
    appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
  })
  const commands = createCommands({
    basics: b,
    agent: agent.port,
    work: record<CommandDeps["work"]>().port,
    blobs: record<CommandDeps["blobs"]>({ ref: () => undefined }).port,
    cards: cards.port,
    start: () => {
      throw new Error("no run here")
    },
    names: record<CommandDeps["names"]>({
      reserve: async lane => (lane === HELD ? "held" : "name"),
    }).port,
    drain: lane => void drains.push(lane),
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
    }) satisfies WireCommand
  return { b, agent, cards, commands, replies, sender, chat, drains }
}

test("a chat in an archived root is refused, and the agent is never called", async () => {
  const { b, agent, commands, replies, sender, chat } = setUp()
  putValue(b.doc, {
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

test("a chat command spends its card once written, record then text, answering with its rev; a refused one leaves it", async () => {
  const { b, cards, commands, replies, sender, chat } = setUp()
  for (const id of ["card-1", "card-2"])
    applyPlaceStep(b.places, {
      kind: "write",
      record: {
        id: cardId(id),
        owner: ALICE,
        placer: ALICE,
        place: { kind: "drafting", at: atEntry(ROOT_ID), lane: null },
        command: null,
        unsent: null,
      },
    })
  await commands.handle(sender, ALICE, { ...chat("c-4"), cardId: "card-1" })
  // Refused by `sendChat` itself: an image the host does not store.
  await commands.handle(sender, ALICE, {
    ...chat("c-5"),
    text: `look ![a](/blob/${"b".repeat(64)})`,
    cardId: "card-2",
  })
  expect(replies.map(r => [r.outcome, r.rev])).toEqual([
    ["appended", 3],
    ["refused", 0],
  ])
  expect(readPlaces(b.places).map(c => c.id)).toEqual(["card-2"])
  expect(
    cards.calls.filter(c => c.method === "destroy").map(c => c.args[0]),
  ).toEqual(["card-1"])
})

test("a taken card in an archived root is refused, and the agent is never called", async () => {
  const { b, agent, commands } = setUp()
  putValue(b.doc, {
    namespace: ARCHIVE_NAMESPACE,
    key: ROOT_ID,
    value: encodeArchive({
      root: ROOT_ID,
      state: "archived",
      by: ALICE,
      at: 1,
    }),
  })
  const out = await commands.sendTaken(ALICE, "s-1", {
    text: "from the queue",
    at: atEntry(ROOT_ID),
    mode: "queue",
    lane: null,
    asksAgent: false,
    mentions: [],
    work: null,
    card: null,
    reserved: null,
  })
  expect(out).toMatchObject({ kind: "refused", code: ERR.ARCHIVED })
  expect(agent.calls).toEqual([])
})

test("a seat whose principal names nobody is refused whatever it sends", async () => {
  const { agent, commands, replies, sender, chat } = setUp()
  await commands.handle(sender, undefined, chat("c-3"))
  expect(replies[0]).toMatchObject({ outcome: "refused" })
  expect(agent.calls).toEqual([])
})

test("a command that throws is answered failed, and logged", async () => {
  const { b, commands, replies, sender } = setUp()
  // The agent port has no `setParticipantName`, so `record` throws.
  await commands.handle(sender, ALICE, {
    id: "c-4",
    kind: "name",
    text: "Alice",
  } as never)
  expect(replies).toEqual([
    expect.objectContaining({
      id: "c-4",
      outcome: "failed",
      errorMessage: "setParticipantName is not in this port",
    }),
  ])
  expect(b.lines).toEqual([
    "[host] a name command failed: setParticipantName is not in this port",
  ])
})

test("a reservation is answered reserved, and refused for a lane pi holds (ADR-0057)", async () => {
  const { commands, replies, sender } = setUp()
  const reserve = (id: string, lane: string) =>
    commands.handle(sender, ALICE, { id, kind: "reserve", lane } as never)
  await reserve("c-4", NEW)
  await reserve("c-5", HELD)
  expect(replies.map(r => [r.id, r.outcome, r.errorCode])).toEqual([
    ["c-4", "reserved", ""],
    ["c-5", "refused", "lane_taken"],
  ])
})
