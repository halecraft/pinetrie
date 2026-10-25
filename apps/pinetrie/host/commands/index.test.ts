import {
  ERR,
  entryId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { IN_INVENTORY_WORDS } from "@pinetrie/interface"
import type { WireCommand } from "@pinetrie/protocol/codec"
import type { Reply } from "@pinetrie/protocol/messages"
import { readPlaces } from "@pinetrie/reads"
import { foreignLaneWords, LANE, setRecord, WORKFLOW } from "@pinetrie/rules"
import { testWorkflow } from "@pinetrie/rules/fixtures"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { type Intent, textCardId } from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { expect, test } from "vitest"
import {
  applyWrites,
  basics,
  CANVAS_ID,
  NO_BLANK_CARDS,
  placeCanvas,
  placesFor,
  putCanvas,
  putValue,
  ROOT_ID,
  record,
  seedPlaces,
  stepKeeper,
  threadRow,
  writeDirectory,
} from "../fakes.ts"
import type { StepRecords } from "../records.ts"
import type { Destination, ProposedChangesActs } from "../work/destination.ts"
import { type CommandDeps, createCommands, placeOfCommand } from "./index.ts"

const TEST_THREAD = threadIdFor("e")

const ALICE = writerId("alice@example.com")
const ROOT_ENTRY = entryId("e-1")
const HELD = threadIdFor("01a0f9eb-86e1-77ad-a822-2a306786223f")
const NEW = threadIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")
const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
/** The thread the test's root entry starts. */
const THREAD = threadIdFor("root")

/** The test's root in `state` on a board of Doing and Done. */
const placeRoot = (b: ReturnType<typeof basics>, state: typeof DOING) => {
  // The canvas THREAD is in, its card on the board.
  putCanvas(b, THREAD, CANVAS_ID, undefined, state)
  putValue(
    b,
    setRecord(
      WORKFLOW,
      testWorkflow([{ id: DOING, name: "Doing" }], { id: DONE, name: "Done" }),
    ),
  )
  placeCanvas(b, CANVAS_ID, state, ALICE)
}

function setUp(
  work: Partial<CommandDeps["work"]> = {},
  {
    writes = true,
    repairAgain = null,
  }: {
    readonly writes?: boolean
    readonly repairAgain?: CommandDeps["repairAgain"]
  } = {},
) {
  const b = basics()
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
  writeEntry(b.root, threadRow(ROOT_ENTRY, null, THREAD))
  writeDirectory(b)
  placeRoot(b, DOING)
  // The agent, the scribe, the records and the setup in one record, so the
  // order of their calls shows.
  const pi = record<
    CommandDeps["agent"] &
      CommandDeps["scribe"] &
      Pick<StepRecords, "writeValues"> &
      CommandDeps["piSetup"]
  >({
    appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
    commands: () => [],
    ...(writes ? { writeValues: async w => applyWrites(b, w) } : {}),
  })
  // A step's records are the agent's record's too, so its writes show there.
  const keeper = stepKeeper(b, { records: pi.port })
  const commands = createCommands({
    relays: { relayMessage: async () => {} },
    basics: b,
    agent: pi.port,
    scribe: pi.port,
    records: pi.port,
    piSetup: pi.port,
    work: record<CommandDeps["work"]>(work).port,
    blobs: record<CommandDeps["blobs"]>({
      ref: () => undefined,
      size: () => undefined,
      get: () => undefined,
      fitted: () => undefined,
    }).port,
    quoteBytes: 32 * 1024,
    fitImage: async () => null,
    cards: cards.port,
    cancel: () => false,
    start: () => {
      throw new Error("no run here")
    },
    names: record<CommandDeps["names"]>({
      reserve: async lane => (lane === HELD ? "held" : "name"),
      ensure: async () => {},
    }).port,
    drain: lane => void drains.push(lane),
    histories: record<CommandDeps["histories"]>({
      gestureOf: async () => write => write(),
      unloadCanvas: async () => {},
    }).port,
    runs: { docOf: () => null },
    // Its own writes, so a test counting the agent's sees only the command's.
    ...placesFor(b, { texts: cards.port }),
    titles: titles.port,
    keeper,
    later: { step: async () => {} },
    repairAgain,
  })
  const replies: Reply[] = []
  const sender = { send: (r: Reply) => void replies.push(r) }
  const said = (id: string) =>
    ({
      id,
      kind: "send",
      text: "hello",
      parentId: ROOT_ENTRY,
      root: ROOT_ID,
      mode: "reply",
      lane: THREAD,
    }) satisfies WireCommand
  return {
    b,
    keeper,
    pi,
    cards,
    commands,
    replies,
    sender,
    send: said,
    drains,
    titles,
  }
}

test.each([
  ["an acceptance", { kind: "proposed", action: "accept" }, "repo"],
  ["a squash", { kind: "proposed", action: "squash" }, "repo"],
  ["a description again", { kind: "proposed", action: "describe" }, "repo"],
  ["a publish", { kind: "publish" }, "repo"],
  ["a restore", { kind: "restore" }, "repo"],
  ["a conflict's version chosen", { kind: "resolve" }, "repo"],
  ["a move on the board", { kind: "move-canvas" }, "board"],
  ["a workflow edit", { kind: "workflow" }, "documents"],
  ["a chat", { kind: "send" }, "documents"],
  ["a move", { kind: "move" }, "documents"],
  ["a stop", { kind: "stop" }, "documents"],
] as const)("placeOfCommand: %s runs on %s", (_, intent, place) => {
  expect(placeOfCommand(intent as Intent)).toBe(place)
})

test("a publish to a folder project and a restore to a jj project are each refused by the handler", async () => {
  const folder = setUp({
    destination: record<Destination>({
      accepted: { kind: "folder", restore: async () => ({ kind: "done" }) },
    }).port,
  })
  await folder.commands.handle(folder.sender, ALICE, {
    id: "p-1",
    kind: "publish",
  })
  const jj = setUp({
    destination: record<Destination>({
      accepted: { kind: "jj", act: async () => null },
    }).port,
  })
  await jj.commands.handle(jj.sender, ALICE, {
    id: "r-1",
    kind: "restore",
    targetId: "line-0192aaaa",
    seen: "line-0192bbbb",
  })
  expect(
    [...folder.replies, ...jj.replies].map(r => [r.id, r.outcome, r.errorCode]),
  ).toEqual([
    ["p-1", "refused", ERR.REFUSED],
    ["r-1", "refused", ERR.REFUSED],
  ])
})

test("repair again is asked of a host holding the repair's controls, and refused as no command of its own by one without", async () => {
  let asked = 0
  const holds = setUp({}, { repairAgain: () => void asked++ })
  const lacks = setUp()
  await holds.commands.handle(holds.sender, ALICE, {
    id: "a-1",
    kind: "repair-again",
  })
  await lacks.commands.handle(lacks.sender, ALICE, {
    id: "a-2",
    kind: "repair-again",
  })
  expect([
    asked,
    ...[...holds.replies, ...lacks.replies].map(r => [
      r.id,
      r.outcome,
      r.errorCode,
    ]),
  ]).toEqual([
    1,
    ["a-1", "repair-asked", ""],
    ["a-2", "refused", ERR.UNKNOWN_KIND],
  ])
})

test("a chat completes while an acceptance is held open on your repo's owner", async () => {
  const held =
    Promise.withResolvers<Awaited<ReturnType<ProposedChangesActs["act"]>>>()
  const {
    commands,
    replies,
    sender,
    send: said,
  } = setUp({
    destination: record<Destination>({
      proposed: record<ProposedChangesActs>({ act: () => held.promise }).port,
    }).port,
  })
  const acceptance = commands.handle(sender, ALICE, {
    id: "t-1",
    kind: "proposed",
    lane: HELD,
    mode: "accept",
    seen: JSON.stringify({ kind: "jj", ledger: null, conflicted: false }),
  })
  await commands.handle(sender, ALICE, said(cardIdFor("c1")))
  expect(replies.map(r => r.id)).toEqual([cardIdFor("c1")])
  held.resolve({
    kind: "done",
    fact: { kind: "squashed", lane: HELD, by: ALICE },
  })
  await acceptance
  expect(replies.map(r => [r.id, r.outcome])).toEqual([
    [cardIdFor("c1"), "appended"],
    ["t-1", "accepted"],
  ])
})

test("a move into Done holds the keeper only for its place and its stacks' unload: a command waits on neither its teardown, and one into the root is refused meanwhile; its reply comes after it all", async () => {
  const teardown = Promise.withResolvers<void>()
  const {
    commands,
    replies,
    sender,
    send: said,
  } = setUp({
    destination: null,
    teardown: () => teardown.promise,
  })
  const archive = commands.handle(sender, ALICE, {
    id: "a-1",
    kind: "move-canvas",
    canvas: CANVAS_ID,
    text: JSON.stringify({ from: DOING, to: DONE, before: null }),
  })
  await new Promise(r => setTimeout(r, 5))
  await commands.handle(sender, ALICE, {
    id: "n-1",
    kind: "name",
    text: "Alice",
  })
  await commands.handle(sender, ALICE, said(cardIdFor("c1")))
  expect(replies.map(r => [r.id, r.outcome])).toEqual([
    ["n-1", "named"],
    [cardIdFor("c1"), "refused"],
  ])
  teardown.resolve()
  await archive
  expect(replies.at(-1)).toMatchObject({ id: "a-1", outcome: "moved" })
})

test("a chat in an archived root is refused, and the agent is never called", async () => {
  const { b, pi, commands, replies, sender, send: said } = setUp()
  placeRoot(b, DONE)
  await commands.handle(sender, ALICE, said(cardIdFor("c1")))
  expect(replies[0]).toMatchObject({
    id: cardIdFor("c1"),
    outcome: "refused",
  })
  expect(replies[0]?.errorMessage).toMatch(/^archived by /)
  expect(pi.calls).toEqual([])
})

test("the command's id is the send's id", async () => {
  const { pi, commands, replies, sender, send: said } = setUp()
  await commands.handle(sender, ALICE, said(cardIdFor("c2")))
  expect(replies[0]).toMatchObject({
    id: cardIdFor("c2"),
    outcome: "appended",
  })
  expect(
    pi.calls.find(c => c.method === "appendToTree")?.args[0],
  ).toMatchObject({
    details: { sendId: cardIdFor("c2") },
  })
})

test("a chat command spends its card once written, record then text, answering with its rev; a refused one leaves it", async () => {
  const { b, cards, commands, replies, sender, send: said } = setUp()
  for (const id of [cardIdFor("cc1"), cardIdFor("cc2")])
    seedPlaces(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: textCardId(id),
          owner: ALICE,
          placer: ALICE,
          place: {
            kind: "composing",
            thread: TEST_THREAD,
          },
          content: { command: null, unsent: null, origin: null },
        },
      },
    ])
  await commands.handle(sender, ALICE, {
    ...said(cardIdFor("c4")),
    cardId: cardIdFor("cc1"),
  })
  // Refused by `sendMessage` itself: an image the host does not store.
  await commands.handle(sender, ALICE, {
    ...said(cardIdFor("c5")),
    text: `look ![a](/blob/${"b".repeat(64)})`,
    cardId: cardIdFor("cc2"),
  })
  expect(replies.map(r => [r.outcome, r.rev])).toEqual([
    ["appended", 4],
    ["refused", 0],
  ])
  expect(readPlaces(b.places).map(c => c.id)).toEqual([
    cardIdFor("cc2"),
    CANVAS_ID,
    THREAD,
  ])
  expect(
    cards.calls.filter(c => c.method === "destroy").map(c => c.args[0]),
  ).toEqual([cardIdFor("cc1")])
})

test("a popped queued card in an archived root is refused, and the agent is never called", async () => {
  const { b, pi, commands } = setUp()
  placeRoot(b, DONE)
  const out = await commands.sendPoppedQueuedCard(b.roots, ALICE, "s-1", {
    kind: "send",
    text: "from the queue",
    root: ROOT_ID,
    at: { kind: "queue", thread: THREAD },
    mentions: [],
    card: null,
    pinned: [],
    base: null,
    state: null,
  })
  expect(out).toMatchObject({ kind: "refused", code: ERR.CANVAS_ARCHIVED })
  expect(pi.calls).toEqual([])
})

test("nothing runs in a thread in an inventory", async () => {
  const { b, pi, commands, replies, sender, send: said } = setUp()
  const taken = readPlaces(b.places).find(c => c.id === THREAD)
  if (taken?.kind !== "thread") throw new Error("no thread card")
  seedPlaces(b.places, [
    {
      kind: "write",
      record: { ...taken, place: { kind: "inventory", holder: ALICE } },
    },
  ])
  await commands.handle(sender, ALICE, said(cardIdFor("c1")))
  await commands.handle(sender, ALICE, {
    ...said(cardIdFor("c2")),
    mode: "branch",
    lane: NEW,
    canvas: CANVAS_ID,
  })
  await commands.handle(sender, ALICE, {
    id: "co-1",
    kind: "carry-on",
    lane: THREAD,
  })
  await commands.handle(sender, ALICE, {
    id: "d-1",
    kind: "proposed",
    lane: THREAD,
    mode: "describe",
  })
  expect(replies.map(r => [r.outcome, r.errorMessage])).toEqual(
    Array(4).fill(["refused", IN_INVENTORY_WORDS]),
  )
  const popped = await commands.sendPoppedQueuedCard(b.roots, ALICE, "s-1", {
    kind: "send",
    text: "from the queue",
    root: ROOT_ID,
    at: { kind: "queue", thread: THREAD },
    mentions: [],
    card: null,
    pinned: [],
    base: null,
    state: null,
  })
  expect(popped).toEqual({
    kind: "refused",
    code: ERR.REFUSED,
    message: IN_INVENTORY_WORDS,
  })
  expect(pi.calls).toEqual([])
})

test("nothing runs on a lane of another kind than the project's; a held one is refused as held", async () => {
  const {
    b,
    pi,
    commands,
    replies,
    sender,
    send: said,
  } = setUp({
    project: { root: "/p", kind: "jj", owner: null },
  })
  putValue(
    b,
    setRecord(LANE, {
      lane: THREAD,
      root: ROOT_ID,
      history: "folder",
      by: ALICE,
      createdAt: 0,
    }),
  )
  const words = foreignLaneWords({
    kind: "foreign",
    lane: THREAD,
    history: "folder",
  })
  await commands.handle(sender, ALICE, said(cardIdFor("c1")))
  const popped = await commands.sendPoppedQueuedCard(b.roots, ALICE, "s-1", {
    kind: "send",
    text: "from the queue",
    root: ROOT_ID,
    at: { kind: "queue", thread: THREAD },
    mentions: [],
    card: null,
    pinned: [],
    base: null,
    state: null,
  })
  const taken = readPlaces(b.places).find(c => c.id === THREAD)
  if (taken?.kind !== "thread") throw new Error("no thread card")
  seedPlaces(b.places, [
    {
      kind: "write",
      record: { ...taken, place: { kind: "inventory", holder: ALICE } },
    },
  ])
  await commands.handle(sender, ALICE, said(cardIdFor("c2")))
  expect(replies.map(r => [r.outcome, r.errorMessage])).toEqual([
    ["refused", words],
    ["refused", IN_INVENTORY_WORDS],
  ])
  expect(popped).toEqual({
    kind: "refused",
    code: ERR.FOREIGN_LANE,
    message: words,
  })
  expect(pi.calls).toEqual([])
})

test("a seat whose principal names nobody is refused whatever it sends", async () => {
  const { pi, commands, replies, sender, send: said } = setUp()
  await commands.handle(sender, undefined, said(cardIdFor("c3")))
  expect(replies[0]).toMatchObject({ outcome: "refused" })
  expect(pi.calls).toEqual([])
})

test("a command that throws is answered failed, and logged", async () => {
  const { b, commands, replies, sender } = setUp({}, { writes: false })
  // The agent port has no `writeValues`, so `record` throws.
  await commands.handle(sender, ALICE, {
    id: cardIdFor("c4"),
    kind: "name",
    text: "Alice",
  } as never)
  expect(replies).toEqual([
    expect.objectContaining({
      id: cardIdFor("c4"),
      outcome: "failed",
      errorMessage: "writeValues is not in this port",
    }),
  ])
  expect(b.lines).toEqual([
    "[host] a name command failed: writeValues is not in this port",
  ])
})

test("a reservation is answered reserved, and refused for a lane pi holds", async () => {
  const { commands, replies, sender } = setUp()
  const reserve = (id: string, lane: string) =>
    commands.handle(sender, ALICE, { id, kind: "reserve", lane } as never)
  await reserve(cardIdFor("c4"), NEW)
  await reserve(cardIdFor("c5"), HELD)
  expect(replies.map(r => [r.id, r.outcome, r.errorCode])).toEqual([
    [cardIdFor("c4"), "reserved", ""],
    [cardIdFor("c5"), "refused", ERR.THREAD_TAKEN],
  ])
})

test("a retitle asks for its canvas's title as its sender, and answers retitling", async () => {
  const { commands, replies, sender, titles } = setUp()
  await commands.handle(sender, ALICE, {
    id: cardIdFor("c6"),
    kind: "retitle",
    canvas: CANVAS_ID,
  } as never)
  // Asked in the command's step, with its documents first.
  expect(titles.calls.map(c => [c.method, ...c.args.slice(1)])).toEqual([
    ["asked", CANVAS_ID, ALICE],
  ])
  expect(replies.map(r => [r.id, r.outcome])).toEqual([
    [cardIdFor("c6"), "retitling"],
  ])
})
