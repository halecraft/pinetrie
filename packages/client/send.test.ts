import {
  ERR,
  entryId,
  laneNameForThread,
  type ProjectRecord,
  runId,
  type ThreadLane,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  planSend,
  queuePlace,
  queueWords,
  raceWords,
  sendable,
  settleSend,
  whereChoices,
  whereWords,
} from "./send.ts"

const ME = writerId("duane@example.com")
const BEA = writerId("bea@example.com")
const CY = writerId("cy@example.com")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }

const lane = (
  over: Partial<Extract<ThreadLane, { kind: "lane" }>> = {},
): ThreadLane => ({
  kind: "lane",
  name: laneNameForThread("1"),
  tip: "e-1",
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  ...over,
})

describe("settleSend", () => {
  test("a conflict and a refusal put the message back", () => {
    expect(settleSend({ kind: "conflict", by: BEA }, "hi", READER)).toEqual({
      restore: "hi",
      status: "",
      conflict: {
        text: "hi",
        line: "Bea asked the agent a moment before you.",
      },
    })
    expect(
      settleSend({ kind: "conflict", by: ME }, "hi", READER).conflict?.line,
    ).toBe("You already asked the agent here.")
    expect(
      settleSend(
        { kind: "refused", code: ERR.ARCHIVED, message: "archived by Bea" },
        "hi",
        READER,
      ),
    ).toEqual({
      restore: "hi",
      status: "not sent: archived by Bea",
      conflict: null,
    })
  })
  test("a written, started or queued message leaves the composer as it is", () => {
    expect(
      settleSend({ kind: "appended", id: entryId("e") }, "hi", READER).restore,
    ).toBeNull()
    expect(
      settleSend({ kind: "started", runId: runId("r") }, "hi", READER).restore,
    ).toBeNull()
    expect(settleSend({ kind: "queued", position: 1 }, "hi", READER)).toEqual({
      restore: null,
      status: "waiting · 2nd in line",
      conflict: null,
    })
  })
})

describe("sendable", () => {
  const blank = { text: "@agent ", blank: true }
  test("nothing, blank text, or only a blank prefill sends nothing", () => {
    for (const text of ["", "  \n ", "@agent ", "@agent", " @agent \n"])
      expect(sendable(text, blank, false)).toBeNull()
    expect(sendable("  ", undefined, false)).toBeNull()
  })
  test("anything more is sent, trimmed", () => {
    expect(sendable("@agent fix it ", blank, false)).toBe("@agent fix it")
    expect(sendable("just us", blank, false)).toBe("just us")
    expect(sendable("@agent", undefined, false)).toBe("@agent")
  })
  test("while an image is uploading, nothing is sent", () => {
    expect(sendable("look at this", undefined, true)).toBeNull()
  })
  test("a content prefill sent unchanged is sent: an edit's retry", () => {
    const edit = { text: "@agent try again ", blank: false }
    expect(sendable(edit.text, edit, false)).toBe("@agent try again")
  })
})

describe("planSend: the button, as the host will decide (ADR-0021)", () => {
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
      reader: READER,
      ...over,
    })
  test("in a conversation, a message is sent, to whoever it names", () => {
    expect(plan("hi")).toEqual({
      mode: "reply",
      createsLane: false,
      button: "send",
      title: null,
      placeholder: "say something · @agent to ask",
      queue: { button: "queue up next", title: null },
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
    expect(plan("hi", { lane: lane({ running: true }) })).toMatchObject({
      mode: "queue",
      button: "queue up next",
      title: null,
    })
    expect(
      plan("hi", { lane: lane({ waiting: 3, lastWaiting: BEA }) }),
    ).toMatchObject({
      mode: "queue",
      button: "queue after Bea",
      title: "3 waiting ahead",
    })
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

describe("queuePlace: behind the newest message waiting", () => {
  test("with nothing waiting, it is next", () => {
    expect(queuePlace(lane({ running: true }), READER)).toEqual({
      kind: "next",
    })
    expect(queuePlace({ kind: "none" }, READER)).toEqual({ kind: "next" })
  })
  test("behind someone else, by name", () => {
    expect(queuePlace(lane({ waiting: 1, lastWaiting: BEA }), READER)).toEqual({
      kind: "after",
      name: "Bea",
      ahead: 1,
    })
    expect(queuePlace(lane({ waiting: 1, lastWaiting: CY }), READER)).toEqual({
      kind: "after",
      name: "cy",
      ahead: 1,
    })
  })
  test("behind your own message, as yours", () => {
    expect(queuePlace(lane({ waiting: 2, lastWaiting: ME }), READER)).toEqual({
      kind: "afterYours",
      ahead: 2,
    })
  })
})

describe("queueWords", () => {
  test("says where it waits", () => {
    expect(queueWords({ kind: "next" })).toEqual({
      button: "queue up next",
      title: null,
    })
    expect(queueWords({ kind: "after", name: "Bea", ahead: 1 })).toEqual({
      button: "queue after Bea",
      title: null,
    })
    expect(queueWords({ kind: "afterYours", ahead: 1 }).button).toBe(
      "queue after yours",
    )
  })
  test("counts the queue when one name stands for several", () => {
    expect(queueWords({ kind: "afterYours", ahead: 3 }).title).toBe(
      "3 waiting ahead",
    )
  })
})

describe("raceWords", () => {
  test("names who asked first, and never names you", () => {
    expect(raceWords(null, READER)).toBe(
      "Another thread started here a moment before you",
    )
    expect(raceWords(ME, READER)).toBe("You already asked the agent here")
    expect(raceWords(BEA, READER)).toBe(
      "Bea asked the agent a moment before you",
    )
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
