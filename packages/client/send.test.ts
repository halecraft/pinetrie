import {
  type Address,
  ERR,
  entryId,
  laneNameForThread,
  NOBODY,
  type ProjectRecord,
  runId,
  THE_AGENT,
  type ThreadLane,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type ComposerMode,
  failedWords,
  lineWords,
  placeholderWords,
  planSend,
  queuePlace,
  queues,
  queueWords,
  raceWords,
  type SendPlan,
  sendable,
  sendButton,
  settleSend,
  spent,
  whereChoices,
  whereWords,
} from "./send.ts"

const ME = writerId("duane@example.com")
const BEA = writerId("bea@example.com")
const CY = writerId("cy@example.com")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
const AGENT: Address = {
  compels: { kind: "agent", agent: THE_AGENT },
  people: [],
}

const lane = (
  over: Partial<Extract<ThreadLane, { kind: "lane" }>> = {},
): ThreadLane => ({
  kind: "lane",
  name: laneNameForThread("1"),
  tip: entryId("e-1"),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  ...over,
})

describe("settleSend", () => {
  test("a conflict offers queue or branch; a refusal says why", () => {
    expect(settleSend({ kind: "conflict", by: BEA }, "hi", READER)).toEqual({
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
      status: "not sent: archived by Bea",
      conflict: null,
    })
  })
  test("a written, started or busy send says nothing: a queued card says where it waits", () => {
    expect(
      settleSend({ kind: "appended", id: entryId("e") }, "hi", READER),
    ).toEqual({ status: "", conflict: null })
    expect(
      settleSend({ kind: "started", runId: runId("r") }, "hi", READER),
    ).toEqual({ status: "", conflict: null })
    expect(settleSend({ kind: "busy" }, "hi", READER)).toEqual({
      status: "",
      conflict: null,
    })
  })
  test("spent: written or running; queues: busy; a conflict or a refusal neither", () => {
    const outcomes = [
      { kind: "appended", id: entryId("e") },
      { kind: "started", runId: runId("r") },
      { kind: "busy" },
      { kind: "conflict", by: null },
      { kind: "refused", code: ERR.REFUSED, message: "no" },
      { kind: "failed", message: "store closed" },
    ] as const
    expect(outcomes.map(o => [spent(o), queues(o)])).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [false, false],
      [false, false],
      [false, false],
    ])
  })
  test.each([
    [0, "1st in line"],
    [1, "2nd in line"],
    [2, "3rd in line"],
    [9, "10th in line"],
  ])("lineWords(%i) is %s", (n, words) => {
    expect(lineWords(n)).toBe(words)
  })
  test("a failure says the host failed, never that nothing was sent", () => {
    expect(
      settleSend({ kind: "failed", message: "store closed" }, "hi", READER),
    ).toEqual({ status: "the host failed: store closed", conflict: null })
    expect(failedWords("store closed")).not.toMatch(/not sent/)
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
  test("a card with a command is sent with no text (ADR-0055)", () => {
    expect(sendable("  ", blank, false, "bring-up-to-date")).toBe("")
    expect(sendable("@agent ", blank, false, "bring-up-to-date")).toBe("")
    expect(sendable("check it", blank, false, "bring-up-to-date")).toBe(
      "check it",
    )
    expect(sendable("", blank, true, "bring-up-to-date")).toBeNull()
  })
})

describe("planSend: what the send does, as the host will decide (ADR-0021)", () => {
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
      command: null,
      ...over,
    })
  test("in a conversation, a message is sent, to whoever it names", () => {
    expect(plan("hi")).toEqual({
      mode: "reply",
      createsLane: false,
      to: { compels: NOBODY, people: [] },
      queue: { kind: "next" },
      agentByDefault: false,
    })
    expect(plan("@ada hi").to).toEqual({ compels: NOBODY, people: ["Ada"] })
    expect(plan("@ada @bea @cy").to.people).toEqual(["Ada", "Bea", "Cy"])
  })
  test("asking the agent where there is no lane creates one", () => {
    expect(plan("@agent hi")).toMatchObject({ to: AGENT, createsLane: true })
    expect(plan("hi", { asksAgent: true })).toMatchObject({
      to: AGENT,
      createsLane: true,
      agentByDefault: true,
    })
    expect(plan("/fixture:skill:hello")).toMatchObject({
      to: AGENT,
      createsLane: true,
    })
  })
  test("in agent work, a message naming no one asks the agent", () => {
    expect(plan("hi", { lane: lane() })).toMatchObject({
      mode: "reply",
      to: AGENT,
      createsLane: false,
      agentByDefault: true,
    })
  })
  test("a busy lane queues the next card, a question or a person's message (ADR-0048)", () => {
    expect(plan("hi", { lane: lane({ running: true }) })).toMatchObject({
      mode: "queue",
      queue: { kind: "next" },
    })
    expect(
      plan("hi", { lane: lane({ waiting: 3, lastWaiting: BEA }) }),
    ).toMatchObject({
      mode: "queue",
      queue: { kind: "after", name: "Bea", ahead: 3 },
    })
    expect(plan("@ada hi", { lane: lane({ running: true }) })).toMatchObject({
      mode: "queue",
      to: { compels: NOBODY, people: ["Ada"] },
    })
  })
  test("a card with a command is queued, even on an idle lane; with no lane it is not (ADR-0055)", () => {
    expect(
      plan("check it", { lane: lane(), command: "bring-up-to-date" }).mode,
    ).toBe("queue")
    expect(plan("check it", { lane: lane() }).mode).toBe("reply")
    expect(plan("hi", { command: "bring-up-to-date" }).mode).toBe("reply")
    expect(
      plan("hi", { fresh: true, lane: lane(), command: "bring-up-to-date" })
        .mode,
    ).toBe("branch")
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

describe("sendButton: the plan in words, and whether it can be pressed", () => {
  const sent = (to: Address, mode: ComposerMode = "reply"): SendPlan => ({
    mode,
    createsLane: false,
    to,
    queue: { kind: "after", name: "Bea", ahead: 3 },
    agentByDefault: false,
  })
  const IDLE = { uploading: false, sending: false }
  const people = (...names: string[]): Address => ({
    compels: NOBODY,
    people: names,
  })
  test.each([
    ["to nobody", sent(people()), IDLE, "send", null, false],
    ["to one person", sent(people("Ada")), IDLE, "send to Ada", null, false],
    [
      "to several, naming them all in the title",
      sent(people("Ada", "Bea", "Cy")),
      IDLE,
      "send to Ada +2",
      "to Ada, Bea, Cy",
      false,
    ],
    ["to the agent", sent(AGENT), IDLE, "send to agent", null, false],
    [
      "to the agent, naming people too",
      sent({ ...AGENT, people: ["Ada"] }),
      IDLE,
      "send to agent",
      null,
      false,
    ],
    [
      "queued, in the queue's words",
      sent(AGENT, "queue"),
      IDLE,
      "queue after Bea",
      "3 waiting ahead",
      false,
    ],
    [
      "uploading, whatever it would do",
      sent(AGENT, "queue"),
      { uploading: true, sending: false },
      "uploading image…",
      null,
      true,
    ],
    [
      "sending, in the words it was sent with",
      sent(people("Ada")),
      { uploading: false, sending: true },
      "send to Ada",
      null,
      true,
    ],
  ] as const)("%s", (_, plan, busy, label, title, disabled) => {
    expect(sendButton(plan, busy)).toEqual({ label, title, disabled })
  })
  test("placeholderWords says whether a message naming no one asks the agent", () => {
    const plan = sent(people())
    expect(placeholderWords({ ...plan, agentByDefault: true })).toBe(
      "send to agent…",
    )
    expect(placeholderWords(plan)).toBe("say something · @agent to ask")
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
      label: "queue up next",
      title: null,
    })
    expect(queueWords({ kind: "after", name: "Bea", ahead: 1 })).toEqual({
      label: "queue after Bea",
      title: null,
    })
    expect(queueWords({ kind: "afterYours", ahead: 1 }).label).toBe(
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
