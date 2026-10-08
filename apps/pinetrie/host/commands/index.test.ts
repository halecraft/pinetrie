import {
  atEntry,
  cardId,
  ERR,
  entryId,
  type Intent,
  laneNameForThread,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { WireCommand } from "@pinetrie/protocol/codec"
import type { Reply } from "@pinetrie/protocol/messages"
import { readPlaces } from "@pinetrie/reads"
import { BOARD, setRecord, WORKFLOW } from "@pinetrie/rules"
import { newPresenceDoc } from "@pinetrie/schema"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import type { HostKey } from "../basics.ts"
import {
  applyWrites,
  basics,
  NO_BLANK_CARDS,
  putValue,
  ROOT_ID,
  record,
  row,
  writeDirectory,
} from "../fakes.ts"
import type { Offers } from "../offers/index.ts"
import { applyPlaceSteps } from "../places.ts"
import { createProvenance } from "../provenance.ts"
import type { YourRepo } from "../work/index.ts"
import { type CommandDeps, createCommands, placeOfCommand } from "./index.ts"

const ALICE = writerId("alice@example.com")
const ROOT_ENTRY = entryId("e-1")
const HELD = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
const NEW = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a3067862240")
const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]

/** The test's root in `state` on a board of Doing and Done (ADR-0112). */
const placeRoot = (b: ReturnType<typeof basics>, state: typeof DOING) => {
  putValue(
    b,
    setRecord(WORKFLOW, {
      open: [{ id: DOING, name: "Doing" }],
      closed: { id: DONE, name: "Done" },
    }),
  )
  putValue(
    b,
    setRecord(BOARD, { root: ROOT_ID, state, rank: "a", by: ALICE, at: 1 }),
  )
}

function setUp(
  work: Partial<CommandDeps["work"]> = {},
  { writes = true }: { readonly writes?: boolean } = {},
) {
  const b = basics()
  const keeper = createKeeper<HostKey>()
  const cards = record<CommandDeps["cards"]>({
    writers: async () => [],
    destroy: async () => {},
    blankQueued: NO_BLANK_CARDS.blankQueued,
  })
  const drains: string[] = []
  const titles = record<CommandDeps["titles"]>({
    laneStarted: async () => {},
    asked: async () => ({ kind: "retitling" }),
  })
  writeEntry(b.root, row(ROOT_ENTRY, null))
  writeDirectory(b)
  placeRoot(b, DOING)
  // The agent, the scribe, the records and the setup in one record, so the
  // order of their calls shows.
  const pi = record<
    CommandDeps["agent"] &
      CommandDeps["scribe"] &
      CommandDeps["records"] &
      CommandDeps["piSetup"]
  >({
    appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
    ...(writes ? { writeValues: async w => applyWrites(b, w) } : {}),
  })
  const commands = createCommands({
    basics: b,
    agent: pi.port,
    scribe: pi.port,
    records: pi.port,
    piSetup: pi.port,
    work: record<CommandDeps["work"]>(work).port,
    blobs: record<CommandDeps["blobs"]>({ ref: () => undefined }).port,
    fitImage: async () => null,
    cards: cards.port,
    cancel: () => false,
    start: () => {
      throw new Error("no run here")
    },
    names: record<CommandDeps["names"]>({
      reserve: async lane => (lane === HELD ? "held" : "name"),
    }).port,
    drain: lane => void drains.push(lane),
    histories: record<CommandDeps["histories"]>().port,
    // Its own writes, so a test counting the agent's sees only the command's.
    provenance: createProvenance({
      basics: b,
      presence: newPresenceDoc(),
      records: { writeValues: async w => applyWrites(b, w) },
    }),
    titles: titles.port,
    keeper,
  })
  const replies: Reply[] = []
  const sender = { send: (r: Reply) => void replies.push(r) }
  const chat = (id: string) =>
    ({
      id,
      kind: "chat",
      text: "hello",
      parentId: ROOT_ENTRY,
      root: ROOT_ID,
      mode: "reply",
      lane: "",
      asksAgent: false,
    }) satisfies WireCommand
  return {
    b,
    keeper,
    pi,
    cards,
    commands,
    replies,
    sender,
    chat,
    drains,
    titles,
  }
}

test.each([
  ["an acceptance", { kind: "offer", action: "accept" }, "repo"],
  ["a squash", { kind: "offer", action: "squash" }, "repo"],
  ["a description again", { kind: "offer", action: "describe" }, "repo"],
  ["a publish", { kind: "publish" }, "repo"],
  ["a move on the board", { kind: "move-root" }, "board"],
  ["a workflow edit", { kind: "workflow" }, "documents"],
  ["a chat", { kind: "chat" }, "documents"],
  ["a move", { kind: "move" }, "documents"],
  ["a stop", { kind: "stop" }, "documents"],
] as const)("placeOfCommand: %s runs on %s", (_, intent, place) => {
  expect(placeOfCommand(intent as Intent)).toBe(place)
})

test("a chat completes while an acceptance is held open on your repo's owner", async () => {
  const held = Promise.withResolvers<Awaited<ReturnType<Offers["act"]>>>()
  const { commands, replies, sender, chat } = setUp({
    repo: {
      owner: record<YourRepo["owner"]>().port,
      accepted: record<YourRepo["accepted"]>().port,
      offers: record<Offers>({ act: () => held.promise }).port,
    },
  })
  const acceptance = commands.handle(sender, ALICE, {
    id: "t-1",
    kind: "offer",
    lane: HELD,
    mode: "accept",
    seen: JSON.stringify({ ledger: null, conflicted: false }),
  })
  await commands.handle(sender, ALICE, chat("c-1"))
  expect(replies.map(r => r.id)).toEqual(["c-1"])
  held.resolve({
    kind: "done",
    fact: { kind: "squashed", lane: HELD, by: ALICE },
  })
  await acceptance
  expect(replies.map(r => [r.id, r.outcome])).toEqual([
    ["c-1", "appended"],
    ["t-1", "accepted"],
  ])
})

test("a move into Done holds the keeper only for its place and its unload: a command waits on neither its teardown, and one into the root is refused meanwhile; its reply comes after it all", async () => {
  const teardown = Promise.withResolvers<void>()
  const { b, commands, replies, sender, chat } = setUp({
    repo: null,
    teardown: () => teardown.promise,
  })
  const archive = commands.handle(sender, ALICE, {
    id: "a-1",
    kind: "move-root",
    root: ROOT_ID,
    text: JSON.stringify({ from: DOING, to: DONE, before: null }),
  })
  await new Promise(r => setTimeout(r, 5))
  await commands.handle(sender, ALICE, {
    id: "n-1",
    kind: "name",
    text: "Alice",
  })
  await commands.handle(sender, ALICE, chat("c-1"))
  expect(replies.map(r => [r.id, r.outcome])).toEqual([
    ["n-1", "named"],
    ["c-1", "refused"],
  ])
  teardown.resolve()
  await archive
  expect(replies.at(-1)).toMatchObject({ id: "a-1", outcome: "moved-root" })
  expect(b.docs.loaded()).not.toContain(ROOT_ID)
})

test("a chat in an archived root is refused, and the agent is never called", async () => {
  const { b, pi, commands, replies, sender, chat } = setUp()
  placeRoot(b, DONE)
  await commands.handle(sender, ALICE, chat("c-1"))
  expect(replies[0]).toMatchObject({ id: "c-1", outcome: "refused" })
  expect(replies[0]?.errorMessage).toMatch(/^archived by /)
  expect(pi.calls).toEqual([])
})

test("the command's id is the send's id", async () => {
  const { pi, commands, replies, sender, chat } = setUp()
  await commands.handle(sender, ALICE, chat("c-2"))
  expect(replies[0]).toMatchObject({ id: "c-2", outcome: "appended" })
  expect(pi.calls[0]?.args[0]).toMatchObject({
    details: { sendId: "c-2" },
  })
})

test("a chat command spends its card once written, record then text, answering with its rev; a refused one leaves it", async () => {
  const { b, cards, commands, replies, sender, chat } = setUp()
  for (const id of ["card-1", "card-2"])
    applyPlaceSteps(b.places, [
      {
        kind: "write",
        record: {
          id: cardId(id),
          owner: ALICE,
          placer: ALICE,
          place: {
            kind: "composing",
            root: ROOT_ID,
            at: atEntry(ROOT_ENTRY),
            lane: null,
          },
          carries: { kind: "message", command: null },
          unsent: null,
        },
      },
    ])
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

test("a popped queued card in an archived root is refused, and the agent is never called", async () => {
  const { b, pi, commands } = setUp()
  placeRoot(b, DONE)
  const out = await commands.sendPoppedQueuedCard(ALICE, "s-1", {
    text: "from the queue",
    root: ROOT_ID,
    at: atEntry(ROOT_ENTRY),
    mode: "queue",
    lane: null,
    asksAgent: false,
    mentions: [],
    card: null,
    pinned: [],
    reserved: null,
    base: null,
    state: null,
  })
  expect(out).toMatchObject({ kind: "refused", code: ERR.ARCHIVED })
  expect(pi.calls).toEqual([])
})

test("a seat whose principal names nobody is refused whatever it sends", async () => {
  const { pi, commands, replies, sender, chat } = setUp()
  await commands.handle(sender, undefined, chat("c-3"))
  expect(replies[0]).toMatchObject({ outcome: "refused" })
  expect(pi.calls).toEqual([])
})

test("a command that throws is answered failed, and logged", async () => {
  const { b, commands, replies, sender } = setUp({}, { writes: false })
  // The agent port has no `writeValues`, so `record` throws.
  await commands.handle(sender, ALICE, {
    id: "c-4",
    kind: "name",
    text: "Alice",
  } as never)
  expect(replies).toEqual([
    expect.objectContaining({
      id: "c-4",
      outcome: "failed",
      errorMessage: "writeValues is not in this port",
    }),
  ])
  expect(b.lines).toEqual([
    "[host] a name command failed: writeValues is not in this port",
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
    ["c-5", "refused", "lane_id_in_use"],
  ])
})

test("a retitle asks for its root's title as its sender, and answers retitling", async () => {
  const { commands, replies, sender, titles } = setUp()
  await commands.handle(sender, ALICE, {
    id: "c-6",
    kind: "retitle",
    root: ROOT_ID,
  } as never)
  expect(titles.calls.map(c => [c.method, ...c.args])).toEqual([
    ["asked", ROOT_ID, ALICE],
  ])
  expect(replies.map(r => [r.id, r.outcome])).toEqual([["c-6", "retitling"]])
})
