import {
  cardId,
  ERR,
  entryId,
  laneNameForThread,
  NOBODY,
  type ProjectRecord,
  parseMentions,
  ROOT,
  runId,
  type Sha256,
  writerId,
} from "@pineta/core"
import {
  CHAT_TYPE,
  type ChatDetails,
  type ChatMessage,
  encodeWorkRecord,
} from "@pineta/marginalia"
import { readTreeIndex } from "@pineta/reads"
import { writeEntry } from "@pineta/schema"
import { describe, expect, test } from "vitest"
import { basics, methods, putValue, record, row } from "../fakes.ts"
import { type Chat, type ChatDeps, executeChat, sendChat } from "./chat.ts"

const ALICE = writerId("alice@example.com")
const LANE = laneNameForThread("0123456789abcdef")
const details: ChatDetails = {
  author: ALICE,
  authorName: "Alice",
  text: "@agent go",
  compels: NOBODY,
  sendId: "s-1",
}

function setUp(bad: typeof ERR.BAD_DIRECTORY | null) {
  const b = basics()
  const agent = record<ChatDeps["agent"]>({
    hold: async () => {},
    createThreadLane: async () => ({ kind: "created", lane: LANE }),
  })
  const work = record<ChatDeps["work"]>({
    project: null,
    checkDirectory: async () => bad,
    prepareLane: async () => {},
  })
  const started: string[] = []
  const deps: ChatDeps = {
    basics: b,
    agent: agent.port,
    work: work.port,
    blobs: record<ChatDeps["blobs"]>().port,
    cards: record<ChatDeps["cards"]>().port,
    start: lane => {
      started.push(lane)
      return runId("r-1")
    },
  }
  const context = { index: readTreeIndex(b.doc), writer: ALICE, work: null }
  return { agent, work, started, deps, context }
}

describe("executeChat", () => {
  test("createAndRun in a missing directory refuses, and never creates the lane", async () => {
    const { agent, started, deps, context } = setUp(ERR.BAD_DIRECTORY)
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, lane: LANE, details },
      context,
    )
    expect(out).toMatchObject({ kind: "refused", code: ERR.BAD_DIRECTORY })
    expect(methods(agent.calls)).toEqual([])
    expect(started).toEqual([])
  })

  test("createAndRun creates the lane, prepares it, and runs there", async () => {
    const { agent, work, started, deps, context } = setUp(null)
    const out = await executeChat(
      deps,
      { kind: "createAndRun", at: ROOT, lane: LANE, details },
      context,
    )
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(agent.calls.map(c => [c.method, ...c.args])).toEqual([
      ["createThreadLane", ROOT, LANE],
    ])
    expect(methods(work.calls)).toEqual(["checkDirectory", "prepareLane"])
    expect(started).toEqual([LANE])
  })

  test("hold waits in the lane's outbox and answers queued", async () => {
    const { agent, deps, context } = setUp(null)
    const out = await executeChat(
      deps,
      { kind: "hold", lane: LANE, details, position: 2 },
      context,
    )
    expect(out).toEqual({ kind: "queued", position: 2 })
    expect(agent.calls[0]?.args[0]).toMatchObject({
      kind: "chat",
      lane: LANE,
      details,
      timestamp: 1_000,
    })
  })
})

describe("sendChat", () => {
  const E1 = entryId("e-1")
  const BEA = writerId("bea@example.com")
  const SHA = "a".repeat(64) as Sha256
  const chat = (text: string, asksAgent = false): Chat => ({
    text,
    at: { kind: "entry", id: E1 },
    mode: "reply",
    lane: null,
    asksAgent,
    mentions: parseMentions(text),
    work: null,
    card: null,
    reserved: null,
  })
  function setUp(project: ProjectRecord | null = null) {
    const b = basics()
    writeEntry(b.doc, row(E1, null))
    if (project !== null)
      putValue(b.doc, encodeWorkRecord({ kind: "project", record: project }))
    const cards = record<ChatDeps["cards"]>({
      writers: async () => [ALICE, BEA],
      spend: async () => {},
    })
    const agent = record<ChatDeps["agent"]>({
      commands: () => [],
      appendToTree: async () => ({ kind: "appended", id: entryId("e-2") }),
      createThreadLane: async () => ({ kind: "created", lane: LANE }),
    })
    const started: ChatMessage[] = []
    const deps: ChatDeps = {
      basics: b,
      agent: agent.port,
      work: record<ChatDeps["work"]>({
        project,
        checkDirectory: async () => null,
        prepareLane: async () => {},
      }).port,
      blobs: record<ChatDeps["blobs"]>({
        ref: sha =>
          sha === SHA
            ? { sha256: SHA, mimeType: "image/png", width: 2, height: 3 }
            : undefined,
      }).port,
      cards: cards.port,
      start: (_lane, s) => {
        if (s.kind === "prompt" && s.message.customType === CHAT_TYPE)
          started.push(s.message as ChatMessage)
        return runId("r-1")
      },
    }
    return { agent, cards, started, deps }
  }

  test("a Start Agent column's message, naming nobody, starts a run", async () => {
    const { started, deps } = setUp()
    const out = await sendChat(deps, ALICE, "s-1", chat("do it", true))
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(started).toHaveLength(1)
  })

  test("a new lane is created under the column's reserved id (ADR-0057)", async () => {
    const { agent, deps } = setUp()
    const reserved = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
    await sendChat(deps, ALICE, "s-1", { ...chat("do it", true), reserved })
    const created = agent.calls.find(c => c.method === "createThreadLane")
    expect(created?.args[1]).toBe(reserved)
  })

  test("a sent message keeps the images its text shows, as references", async () => {
    const { agent, deps } = setUp()
    await sendChat(deps, ALICE, "s-1", chat(`look ![a](/blob/${SHA})`))
    const appended = agent.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: {
        images: [{ sha256: SHA, mimeType: "image/png", width: 2, height: 3 }],
      },
    })
  })

  test("in a thread that works in its own copy, your working copy's paths are stored as the lane sees them", async () => {
    const { started, deps } = setUp({
      kind: "lanes",
      root: "/proj",
      rootDefault: "own",
    })
    await sendChat(deps, ALICE, "s-1", chat("@agent read /proj/a.txt"))
    expect(started[0]?.details.text).toBe(
      "@agent read /mnt/host-working-copy/a.txt",
    )
  })

  test("a conflict names who holds the thread, as a writer", async () => {
    const { deps } = setUp()
    const out = await executeChat(
      deps,
      { kind: "conflict", by: BEA },
      { index: readTreeIndex(deps.basics.doc), writer: ALICE, work: null },
    )
    expect(out).toEqual({ kind: "conflict", by: BEA })
  })

  test("a message sent from a card carries its other writers, and spends the card (ADR-0048)", async () => {
    const { agent, cards, deps } = setUp()
    const out = await sendChat(deps, ALICE, "s-1", {
      ...chat("from the card"),
      card: cardId("c-1"),
    })
    expect(out).toEqual({ kind: "appended", id: "e-2" })
    const appended = agent.calls.find(c => c.method === "appendToTree")
    expect(appended?.args[0]).toMatchObject({
      details: { contributors: [BEA] },
    })
    expect(cards.calls.map(c => [c.method, ...c.args])).toEqual([
      ["writers", "c-1"],
      ["spend", "c-1"],
    ])
  })

  test("a refused send leaves its card", async () => {
    const { cards, deps } = setUp()
    const missing = "b".repeat(64)
    // Refused before it is planned: an image the host does not store.
    const early = await sendChat(deps, ALICE, "s-1", {
      ...chat(`look ![a](/blob/${missing})`),
      card: cardId("c-1"),
    })
    // Refused as it is written: pi will not append it.
    const late = await sendChat(
      {
        ...deps,
        agent: {
          ...deps.agent,
          appendToTree: async () => ({ kind: "refused", code: ERR.REFUSED }),
        },
      },
      ALICE,
      "s-2",
      { ...chat("from the card"), card: cardId("c-1") },
    )
    expect([early.kind, late.kind]).toEqual(["refused", "refused"])
    expect(cards.calls.map(c => c.method)).not.toContain("spend")
  })

  test("a message with no card spends nothing and names no one else", async () => {
    const { agent, cards, deps } = setUp()
    await sendChat(deps, ALICE, "s-1", chat("plain"))
    expect(cards.calls).toEqual([])
    const appended = agent.calls.find(c => c.method === "appendToTree")
    expect(
      (appended?.args[0] as { details: ChatDetails }).details.contributors,
    ).toBeUndefined()
  })
})
