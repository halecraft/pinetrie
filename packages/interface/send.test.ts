import {
  commitId,
  ERR,
  entryId,
  type JjAcceptedRecord,
  pointId,
  runId,
  THE_AGENT,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { NOBODY, type Recipients, type ThreadLane } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  baseChoices,
  type ComposerMode,
  failedWords,
  forkWords,
  lineWords,
  placeholderWords,
  planSend,
  queuePlace,
  queueWords,
  raceWords,
  type SendPlan,
  sendable,
  sendButton,
  settleSend,
  spent,
  startWords,
} from "./send.ts"

const ME = writerId("duane@example.com")
const BEA = writerId("bea@example.com")
const CY = writerId("cy@example.com")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
const AGENT: Recipients = {
  compels: { kind: "agent", agent: THE_AGENT },
  people: [],
  asks: [],
  invites: [],
}

const lane = (
  over: Partial<Extract<ThreadLane, { kind: "lane" }>> = {},
): ThreadLane => ({
  kind: "lane",
  name: threadIdFor("1"),
  tip: entryId("e-1"),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
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
        {
          kind: "refused",
          code: ERR.CANVAS_ARCHIVED,
          message: "archived by Bea",
        },
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
  test("spent: written, running, or queued by the host; busy, a conflict, a refusal or a failure not", () => {
    const outcomes = [
      { kind: "appended", id: entryId("e") },
      { kind: "started", runId: runId("r") },
      { kind: "queued" },
      { kind: "busy" },
      { kind: "conflict", by: null },
      { kind: "refused", code: ERR.REFUSED, message: "no" },
      { kind: "failed", message: "store closed" },
    ] as const
    expect(outcomes.map(spent)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
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
  test("a card with a command is sent with no text", () => {
    expect(sendable("  ", blank, false, "get-latest")).toBe("")
    expect(sendable("@agent ", blank, false, "get-latest")).toBe("")
    expect(sendable("check it", blank, false, "get-latest")).toBe("check it")
    expect(sendable("", blank, true, "get-latest")).toBeNull()
  })
})

describe("planSend: what the send does, as the host will decide", () => {
  const plan = (
    text: string,
    over: Partial<Parameters<typeof planSend>[0]> = {},
  ) =>
    planSend({
      text,
      unstarted: false,
      lane: { kind: "none" },
      participants: ["Ada", "Bea", "Cy"],
      agents: [],
      reader: READER,
      command: null,
      noModel: null,
      ...over,
    })
  test("a card's command, and whether it has text to send after", () => {
    expect(plan("then test", { command: "get-latest" }).command).toEqual({
      command: "get-latest",
      text: true,
    })
    expect(plan("  ", { command: "get-latest" }).command).toEqual({
      command: "get-latest",
      text: false,
    })
    expect(plan("hi").command).toBe(null)
  })
  test("in a chat, a message is sent, to whoever it names", () => {
    expect(plan("hi")).toEqual({
      mode: "reply",
      createsLane: false,
      to: { compels: NOBODY, people: [], asks: [], invites: [] },
      queue: { kind: "next" },
      hold: "keep",
      agentByDefault: false,
      agentNames: new Map(),
      command: null,
      noModel: null,
    })
    expect(plan("@ada hi").to).toEqual({
      compels: NOBODY,
      people: ["Ada"],
      asks: [],
      invites: [],
    })
    expect(plan("@ada @bea @cy").to.people).toEqual(["Ada", "Bea", "Cy"])
  })
  test("asking the agent where there is no lane creates one", () => {
    expect(plan("@agent hi")).toMatchObject({ to: AGENT, createsLane: true })
    expect(plan("hi")).toMatchObject({ createsLane: false })
    expect(plan("/fixture:skill:hello")).toMatchObject({
      to: AGENT,
      createsLane: true,
    })
  })
  test("in an agent thread, a message naming no one asks the agent", () => {
    expect(plan("hi", { lane: lane() })).toMatchObject({
      mode: "reply",
      to: AGENT,
      createsLane: false,
      agentByDefault: true,
    })
  })
  test("a busy lane queues the next card, a question or a person's message", () => {
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
  test("on an idle lane whose queue is held, a send queues last and releases it; on a running one it waits", () => {
    expect(
      plan("hi", { lane: lane({ heldBy: BEA, waiting: 2, lastWaiting: BEA }) }),
    ).toMatchObject({
      mode: "queue",
      hold: "release",
      queue: { kind: "releases", count: 3 },
    })
    expect(
      plan("hi", { lane: lane({ heldBy: BEA, running: true }) }),
    ).toMatchObject({ mode: "queue", hold: "keep", queue: { kind: "next" } })
  })
  test("a card with a command is queued, even on an idle lane; with no lane it is not", () => {
    expect(plan("check it", { lane: lane(), command: "get-latest" }).mode).toBe(
      "queue",
    )
    expect(plan("check it", { lane: lane() }).mode).toBe("reply")
    expect(plan("hi", { command: "get-latest" }).mode).toBe("reply")
    expect(
      plan("hi", { unstarted: true, lane: lane(), command: "get-latest" }).mode,
    ).toBe("branch")
  })
  test("a unstarted column branches, and creates a lane when it asks the agent", () => {
    expect(plan("hi", { unstarted: true })).toMatchObject({
      mode: "branch",
      createsLane: false,
    })
    expect(plan("@agent hi", { unstarted: true })).toMatchObject({
      mode: "branch",
      createsLane: true,
    })
  })
})

describe("a send with no model", () => {
  const plan = (text: string) =>
    planSend({
      text,
      unstarted: false,
      lane: { kind: "none" },
      participants: ["Ada"],
      agents: [],
      reader: READER,
      command: null,
      noModel: "no config names one",
    })
  test("a send that asks the agent is refused, pointing at the setup page", () => {
    expect(
      sendButton(plan("@agent hi"), { uploading: false, sending: false }),
    ).toEqual({
      label: "no model",
      title: "No model: no config names one",
      disabled: true,
      setup: true,
    })
  })
  test("a send to people needs no model", () => {
    expect(
      sendButton(plan("hi Ada"), { uploading: false, sending: false }),
    ).toMatchObject({
      disabled: false,
      setup: false,
    })
  })
})

describe("sendButton: the plan in words, and whether it can be pressed", () => {
  const sent = (to: Recipients, mode: ComposerMode = "reply"): SendPlan => ({
    mode,
    createsLane: false,
    agentNames: new Map(),
    to,
    queue: { kind: "after", name: "Bea", ahead: 3 },
    hold: "keep",
    agentByDefault: false,
    command: null,
    noModel: null,
  })
  const IDLE = { uploading: false, sending: false }
  const people = (...names: string[]): Recipients => ({
    compels: NOBODY,
    people: names,
    asks: [],
    invites: [],
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
      "queued on an idle thread whose queue is held: it sends them all",
      {
        ...sent(AGENT, "queue"),
        queue: { kind: "releases", count: 3 },
        hold: "release",
      },
      IDLE,
      "send all (3)",
      "release the held queue: what waits goes first, then this",
      false,
    ],
    [
      "uploading, whatever it would do",
      sent(AGENT, "queue"),
      { uploading: true, sending: false },
      "uploading a file…",
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
    [
      "a card with a command names it, its wait in the title",
      {
        ...sent(AGENT, "queue"),
        command: { command: "get-latest", text: false },
      },
      IDLE,
      "get the latest",
      "queue after Bea",
      false,
    ],
    [
      "a card with a command and text sends the text after",
      {
        ...sent(AGENT, "queue"),
        queue: { kind: "next" },
        command: { command: "get-latest", text: true },
      },
      IDLE,
      "get the latest and send",
      null,
      false,
    ],
  ] as const)("%s", (_, plan, busy, label, title, disabled) => {
    expect(sendButton(plan, busy)).toEqual({
      label,
      title,
      disabled,
      setup: false,
    })
  })

  test("placeholderWords says whether a message naming no one asks the agent", () => {
    const plan = sent(people())
    expect(placeholderWords({ ...plan, agentByDefault: true })).toBe(
      "send to agent…",
    )
    expect(placeholderWords(plan)).toBe("say something · @agent to ask")
    expect(
      placeholderWords({
        ...plan,
        command: { command: "get-latest", text: false },
      }),
    ).toBe("what should the agent do with the new work? (optional)")
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
      kind: "after-mine",
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
    expect(queueWords({ kind: "after-mine", ahead: 1 }).label).toBe(
      "queue after yours",
    )
  })
  test("counts the queue when one name stands for several", () => {
    expect(queueWords({ kind: "after-mine", ahead: 3 }).title).toBe(
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

describe("what a new lane starts from: its line", () => {
  test("forkWords: a new lane cloned from a conflicted commit says so", () => {
    expect(forkWords(1)).toBe(
      "starts from a copy with an unresolved conflict in 1 file",
    )
    expect(forkWords(3)).toMatch(/in 3 files$/)
  })
  /** Accepted work, set up, with `unfinishedWork` above it. */
  const accepted = (
    unfinishedWork: JjAcceptedRecord["unfinishedWork"] = [],
    commit: JjAcceptedRecord["commit"] = commitId("c1"),
  ): JjAcceptedRecord => ({
    kind: "jj",
    acceptedBookmark: "pinetrie-accepted",
    wipPrefix: "wip/",
    publish: "main",
    published: { commit: null, behind: 0, ahead: 0 },
    commit,
    heads: { current: null, proposed: "" },
    log: { current: null, proposed: "" },
    unfinishedWork,
    workingCopy: {
      behind: 0,
      ahead: 0,
      getLatest: null,
      conflicts: { commits: 0, files: [] },
    },
    publishCatchesUp: false,
  })
  test("baseChoices: accepted work first, then each WIP with how far behind it is; none with no line, or no WIP", () => {
    const line = accepted([
      { bookmark: "wip/search", commit: commitId("w"), behind: 3, ahead: 1 },
    ])
    expect(
      baseChoices(line, "wip/search").map(c => [c.row, c.detail, c.chosen]),
    ).toEqual([
      ["accepted work", null, false],
      [
        "wip/search",
        "your unfinished work · 3 commits behind accepted work",
        true,
      ],
    ])
    expect(baseChoices(line, null)[0]?.title).toBe("pinetrie-accepted at c1")
    expect(baseChoices(accepted(), null)).toEqual([])
    expect(baseChoices(accepted([], null), null)).toEqual([])
    expect(baseChoices(null, null)).toEqual([])
  })
  test("baseChoices: none in a folder project, which has no WIP", () => {
    expect(
      baseChoices(
        { kind: "folder", newest: pointId("line-0192aaaa"), kept: [], at: 1 },
        null,
      ),
    ).toEqual([])
  })
  test("startWords: accepted work, or the WIP chosen", () => {
    expect(startWords(null)).toBe("starts from accepted work")
    expect(startWords("wip/search")).toBe(
      "starts from your unfinished work: wip/search",
    )
  })
})
