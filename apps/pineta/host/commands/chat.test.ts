import {
  ERR,
  laneNameForThread,
  NOBODY,
  ROOT,
  runId,
  writerId,
} from "@pineta/core"
import type { ChatDetails } from "@pineta/marginalia"
import { readTreeIndex } from "@pineta/reads"
import { describe, expect, test } from "vitest"
import { basics, methods, record } from "../fakes.ts"
import { type ChatDeps, executeChat } from "./chat.ts"

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
      { kind: "createAndRun", at: ROOT, details },
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
      { kind: "createAndRun", at: ROOT, details },
      context,
    )
    expect(out).toEqual({ kind: "started", runId: "r-1" })
    expect(methods(agent.calls)).toEqual(["createThreadLane"])
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
