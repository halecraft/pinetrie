import {
  ERR,
  entryId,
  laneNameForThread,
  type ProjectRecord,
  runId,
  type ThreadLane,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  planSend,
  queueWords,
  sendable,
  settleSend,
  whereChoices,
  whereWords,
} from "./send.ts"

describe("settleSend", () => {
  test("a conflict and a refusal put the message back", () => {
    expect(settleSend({ kind: "conflict", by: "Bea" }, "hi")).toEqual({
      restore: "hi",
      status: "",
      conflict: { text: "hi", by: "Bea" },
    })
    expect(
      settleSend(
        { kind: "refused", code: ERR.ARCHIVED, message: "archived by Bea" },
        "hi",
      ),
    ).toEqual({
      restore: "hi",
      status: "not sent: archived by Bea",
      conflict: null,
    })
  })
  test("a written, started or queued message leaves the composer as it is", () => {
    expect(
      settleSend({ kind: "appended", id: entryId("e") }, "hi").restore,
    ).toBeNull()
    expect(
      settleSend({ kind: "started", runId: runId("r") }, "hi").restore,
    ).toBeNull()
    expect(settleSend({ kind: "queued", position: 1 }, "hi")).toEqual({
      restore: null,
      status: "waiting · 2nd in line",
      conflict: null,
    })
  })
})

describe("sendable", () => {
  test("nothing, blank text, or only the prefill sends nothing", () => {
    for (const text of ["", "  \n ", "@agent ", "@agent", " @agent \n"])
      expect(sendable(text, "@agent ")).toBeNull()
    expect(sendable("  ", undefined)).toBeNull()
  })
  test("anything more is sent, trimmed", () => {
    expect(sendable("@agent fix it ", "@agent ")).toBe("@agent fix it")
    expect(sendable("just us", "@agent ")).toBe("just us")
    expect(sendable("@agent", undefined)).toBe("@agent")
  })
})

describe("planSend: the button, as the host will decide (ADR-0021)", () => {
  const LANE = laneNameForThread("1")
  const lane = (
    over: Partial<Extract<ThreadLane, { kind: "lane" }>> = {},
  ): ThreadLane => ({
    kind: "lane",
    name: LANE,
    tip: "e-1",
    running: false,
    waiting: 0,
    askedBy: null,
    ...over,
  })
  const plan = (
    text: string,
    over: Partial<Parameters<typeof planSend>[0]> = {},
  ) =>
    planSend({
      text,
      fresh: false,
      lane: { kind: "none" },
      asksAgent: false,
      participants: ["Ada", "Bea", "Cy"],
      holderName: "Bea",
      ...over,
    })
  test("in a conversation, a message is sent, to whoever it names", () => {
    expect(plan("hi")).toEqual({
      mode: "reply",
      createsLane: false,
      button: "send",
      title: null,
      placeholder: "say something · @agent to ask",
    })
    expect([plan("@ada hi").button, plan("@ada hi").title]).toEqual([
      "send to Ada",
      null,
    ])
    expect([plan("@ada @bea @cy").button, plan("@ada @bea @cy").title]).toEqual(
      ["send to Ada +2", "to Ada, Bea, Cy"],
    )
  })
  test("asking the agent where there is no lane creates one", () => {
    expect(plan("@agent hi")).toMatchObject({
      button: "ask the agent",
      createsLane: true,
    })
    expect(plan("hi", { asksAgent: true })).toMatchObject({
      button: "ask the agent",
      createsLane: true,
      placeholder: "ask the agent…",
    })
    expect(plan("/fixture:skill:hello")).toMatchObject({
      button: "ask the agent",
      createsLane: true,
    })
  })
  test("in agent work, a message naming no one asks the agent", () => {
    expect(plan("hi", { lane: lane() })).toMatchObject({
      mode: "reply",
      button: "ask the agent",
      createsLane: false,
      placeholder: "ask the agent…",
    })
  })
  test("a busy lane queues the agent's next question, never a person's message", () => {
    for (const busy of [lane({ running: true }), lane({ waiting: 1 })])
      expect(plan("hi", { lane: busy })).toMatchObject({
        mode: "queue",
        button: "queue after Bea",
      })
    expect(
      plan("hi", { lane: lane({ running: true }), holderName: null }).button,
    ).toBe("queue")
    expect(plan("@ada hi", { lane: lane({ running: true }) })).toMatchObject({
      mode: "reply",
      button: "send to Ada",
    })
  })
  test("a fresh column branches, and creates a lane when it asks the agent", () => {
    expect(plan("hi", { fresh: true })).toMatchObject({
      mode: "branch",
      createsLane: false,
    })
    expect(plan("@agent hi", { fresh: true })).toMatchObject({
      mode: "branch",
      createsLane: true,
    })
  })
})

describe("queueWords", () => {
  test("names who it waits behind, when anyone", () => {
    expect(queueWords("Bea")).toBe("queue after Bea")
    expect(queueWords(null)).toBe("queue")
  })
})

describe("where a new lane works: the chip and its menu", () => {
  const lanes: ProjectRecord = {
    kind: "lanes",
    root: "/work",
    rootDefault: "own",
  }
  const direct: ProjectRecord = {
    kind: "direct",
    root: "/work",
    reason: "not a jj repo",
  }
  test("whereWords says each setting", () => {
    expect(whereWords({ kind: "own" }, lanes)).toBe("on a copy")
    expect(whereWords({ kind: "direct", dir: "/work" }, lanes)).toBe(
      "in your working copy",
    )
    expect(whereWords({ kind: "direct", dir: "/tmp/x" }, lanes)).toBe(
      "in /tmp/x",
    )
  })
  test("each row with a setting starts with the chip's words for it", () => {
    for (const c of whereChoices(lanes, ["/tmp/x"]))
      if (c.setting !== null)
        expect(c.row.startsWith(whereWords(c.setting, lanes))).toBe(true)
  })
  test("the working copy is never a used directory's row", () => {
    expect(
      whereChoices(lanes, ["/work", "/tmp/x"]).map(c => c.className),
    ).toEqual(["where-own", "where-yours", "where-used", "where-other"])
  })
  test("a copy cannot be chosen where the project cannot have one, and says why", () => {
    expect(
      whereChoices(direct, []).map(c => [c.key, c.disabled, c.title]),
    ).toEqual([
      ["own", true, "not a jj repo"],
      ["yours", false, undefined],
      ["other", false, undefined],
    ])
    expect(whereChoices(lanes, [])[0]?.disabled).toBe(false)
  })
})
