import assert from "node:assert/strict"
import {
  address,
  atEntry,
  CATCH_UP_TOOL,
  CONFLICT_TOOL,
  canvasIdFor,
  commitId,
  ERR,
  entryId,
  NOBODY,
  type PlanMode,
  type Position,
  PROPOSE_TOOL,
  parseMentions,
  proveRunnable,
  type Responder,
  type SendAt,
  type Sha256,
  THE_AGENT,
  type ThreadLane,
  textCardId,
  threadIdFor,
  type WorkflowStateId,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  addressMessage,
  decodeMessage,
  encodeMessage,
  type Floor,
  messageImageShas,
  participants,
  pendingRunEndReport,
  planMessage,
  planResolution,
  planSshNews,
  planStack,
  planStartup,
  promptAuthor,
  renderableMessage,
  resolutionFloor,
  settleRun,
  withMessageImages,
} from "./index.ts"
import { detailsFromStored } from "./message.ts"

/** A resolution's floor with room to spare. */
function floor(): Floor {
  const found = resolutionFloor({
    budget: { tokens: 10_000, estimate: c => Math.ceil(c.length / 4) },
    skill: null,
    intent: "",
    incoming: "Accepted work",
  })
  if (found.kind !== "fits") throw new Error("the floor does not fit")
  return found.floor
}

const ALICE: WriterId = writerId("alice")
const BO: WriterId = writerId("bo")
const E1 = entryId("e-1")
const E2 = entryId("e-2")
const AGENT: Responder = { kind: "agent", agent: THE_AGENT }
const LANE = threadIdFor("1")
const lane = (
  over: Partial<Extract<ThreadLane, { kind: "lane" }>> = {},
): ThreadLane => ({
  kind: "lane",
  name: LANE,
  tip: E1,
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
  ...over,
})
const NONE: ThreadLane = { kind: "none" }
/** The thread a test's branch starts. */
const NEW = threadIdFor("new")
const ASK = parseMentions("@agent please")

type PlanInput = Omit<Parameters<typeof planMessage>[0], "thread" | "at"> &
  Parameters<typeof planMessage>[0]["thread"] & {
    /** How the send goes: at the end of thread `LANE`, a branch starting `NEW`, or a queued card's pop on `LANE`. */
    readonly mode: PlanMode
    /** What the sender saw, or a branch's fork: a branch lands there. */
    readonly at: Position
  }
const plan = (over: Partial<PlanInput>) => {
  const i: PlanInput = {
    author: ALICE,
    authorName: "Alice",
    text: "hello",
    agents: [],
    mode: "reply",
    at: atEntry(E1),
    end: atEntry(E1),
    contributors: [],
    shares: { images: [], shared: [] },
    hostWorkingCopy: null,
    command: null,
    race: null,
    lane: NONE,
    mentions: [],
    participants: ["Alice", "Bo"],
    sendId: "s-1",
    news: "nothing",
    caughtUp: false,
    state: null,
    ...over,
  }
  const { end, race, lane: l, mode, at, ...rest } = i
  const sendAt: SendAt =
    mode === "queue"
      ? { kind: "queue", thread: LANE }
      : mode === "branch"
        ? {
            kind: "branch",
            thread: NEW,
            at: at.kind === "entry" ? at.id : null,
            canvas: canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c"),
          }
        : { kind: "end", thread: LANE, seen: at.kind === "entry" ? at.id : E1 }
  return planMessage({
    ...rest,
    at: sendAt,
    // A branch lands where it forks (`threadOfSend`).
    thread: { end: mode === "branch" ? at : end, race, lane: l },
  })
}
const kind = (d: ReturnType<typeof planMessage>) => d.kind
const textOf = (d: ReturnType<typeof planMessage>) =>
  "details" in d ? d.details.text : undefined

describe("addressMessage: who a chat is for, host and composer alike", () => {
  const to = (
    over: Partial<Parameters<typeof addressMessage>[0]> = {},
  ): ReturnType<typeof addressMessage> =>
    addressMessage({
      mentions: [],
      participants: ["Alice", "Bo"],
      agents: [],
      mode: "reply",
      lane: NONE,
      command: false,
      ...over,
    })
  test("a command is for the agent, and keeps the people it names", () => {
    expect(to({ command: true, mentions: parseMentions("@bo look") })).toEqual({
      compels: AGENT,
      people: ["Bo"],
      asks: [],
      invites: [],
    })
    expect(to({ mentions: parseMentions("@bo look") })).toEqual({
      compels: NOBODY,
      people: ["Bo"],
      asks: [],
      invites: [],
    })
  })
  test("no mention asks the agent in an agent thread, and nobody in a branch", () => {
    expect(to({ lane: lane() }).compels).toEqual(AGENT)
    expect(to({ lane: lane(), mode: "branch" }).compels).toEqual(NOBODY)
    expect(to({ mode: "branch", mentions: ASK }).compels).toEqual(AGENT)
  })
})

describe("planMessage: a command", () => {
  const command = {
    name: "duane:skill:plan",
    kind: "skill" as const,
    file: "/s/plan/SKILL.md",
    hash: "h",
    expanded:
      '<skill name="plan" location="/s/plan/SKILL.md">…</skill>\n\nmake it so',
  }
  test("the model reads its expansion; people see what was typed", () => {
    const d = plan({ text: "/duane:skill:plan make it so", command })
    const details = "details" in d ? d.details : undefined
    expect(details?.text).toBe("/duane:skill:plan make it so")
    expect(details === undefined ? "" : encodeMessage(details, 1).content).toBe(
      `Alice: ${command.expanded}`,
    )
  })
  test("it is for the agent, whoever else it names", () => {
    expect(
      plan({ command, mentions: parseMentions("@bo look") }),
    ).toMatchObject({ kind: "createAndRun" })
  })
  test("stored, its details still encode to the expansion", () => {
    const d = plan({ command, mode: "queue", lane: lane() })
    expect(d.kind).toBe("run")
    const sent = "details" in d ? d.details : undefined
    expect(
      sent === undefined
        ? ""
        : encodeMessage(detailsFromStored(sent as never), 1).content,
    ).toContain(command.expanded)
  })
  test("a command whose file cannot be read is refused, saying so", () => {
    expect(plan({ command: { unreadable: "duane:skill:plan" } })).toMatchObject(
      {
        kind: "refused",
        message: "the file of /duane:skill:plan could not be read",
      },
    )
  })
  test("an unknown command is refused, naming it", () => {
    expect(plan({ command: { unknown: "duane:skill:nope" } })).toEqual({
      kind: "refused",
      code: ERR.UNKNOWN_COMMAND,
      message: "no command /duane:skill:nope",
    })
  })
})

describe("planMessage: paths to your working copy, in a thread with its own copy", () => {
  const text = "look at /home/p/src/a.ts, not /home/p2/b"
  test("are stored as the lane sees them, under /mnt/host-working-copy", () => {
    expect(textOf(plan({ text, hostWorkingCopy: "/home/p" }))).toBe(
      "look at /mnt/host-working-copy/src/a.ts, not /home/p2/b",
    )
  })
  test("are stored as typed when the thread works directly", () => {
    expect(textOf(plan({ text, hostWorkingCopy: null }))).toBe(text)
  })
})

describe("planMessage: plain messages never conflict", () => {
  // In a thread with a lane, a plain message is one naming only people.
  const TO_BO = parseMentions("@bo look")
  test("no lane: appended at the thread's end, with no lane", () => {
    const d = plan({ end: atEntry(E2) })
    expect(d).toMatchObject({ kind: "appendToTree", parent: atEntry(E2) })
  })
  test("an idle lane: appended through it", () => {
    expect(plan({ mentions: TO_BO, lane: lane() })).toMatchObject({
      kind: "appendToLane",
      thread: LANE,
    })
  })
  test("a running lane, or one with cards queued: busy, and nothing is written", () => {
    expect(plan({ mentions: TO_BO, lane: lane({ running: true }) })).toEqual({
      kind: "busy",
    })
    expect(plan({ mentions: TO_BO, lane: lane({ waiting: 2 }) })).toEqual({
      kind: "busy",
    })
  })
  test("an idle lane whose queue is held: busy, so the message waits in the queue", () => {
    expect(plan({ mentions: TO_BO, lane: lane({ heldBy: BO }) })).toEqual({
      kind: "busy",
    })
  })
  test("another writer's compelled message below: still appended, never a conflict", () => {
    expect(kind(plan({ race: { by: BO } }))).toBe("appendToTree")
    expect(
      kind(plan({ mentions: TO_BO, race: { by: BO }, lane: lane() })),
    ).toBe("appendToLane")
  })
  test("naming only people leaves the agent out, even where it is the default", () => {
    expect(kind(plan({ mentions: parseMentions("hi @bo") }))).toBe(
      "appendToTree",
    )
    expect(
      kind(plan({ mentions: parseMentions("hi @bo"), lane: lane() })),
    ).toBe("appendToLane")
  })
})

describe("planMessage: a compelled message", () => {
  test("no lane: creates the thread's lane at the end and runs", () => {
    expect(plan({ mentions: ASK, end: atEntry(E2) })).toMatchObject({
      kind: "createAndRun",
      at: atEntry(E2),
    })
  })
  test("a new lane is named by its thread's id: the thread a send continues, or the one a branch starts", () => {
    const laneOf = (d: ReturnType<typeof plan>) =>
      d.kind === "createAndRun" ? d.thread : d.kind
    expect(laneOf(plan({ mentions: ASK }))).toBe(LANE)
    expect(laneOf(plan({ mode: "branch", mentions: ASK }))).toBe(NEW)
  })
  test("every decision that writes names its thread once: the one a send continues, or the one a branch starts", () => {
    const threadOf = (d: ReturnType<typeof plan>) =>
      "thread" in d ? d.thread : d.kind
    expect(threadOf(plan({ mode: "branch" }))).toBe(NEW)
    expect(threadOf(plan({ mode: "branch", mentions: ASK }))).toBe(NEW)
    expect(threadOf(plan({}))).toBe(LANE)
    expect(threadOf(plan({ mentions: ASK }))).toBe(LANE)
    expect(threadOf(plan({ lane: lane() }))).toBe(LANE)
    expect(threadOf(plan({ mentions: ASK, lane: lane() }))).toBe(LANE)
    expect(
      "starts" in (plan({ mode: "branch" }) as { details: object }).details,
    ).toBe(false)
  })
  test("a branch's decision carries its card's canvas and board state, in one value; no other does", () => {
    const startsOf = (d: ReturnType<typeof plan>) =>
      d.kind === "appendToTree" || d.kind === "createAndRun" ? d.starts : d.kind
    const state = "s-doing" as WorkflowStateId
    const want = {
      canvas: canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c"),
      state,
    }
    expect(startsOf(plan({ mode: "branch", state }))).toEqual(want)
    expect(startsOf(plan({ mode: "branch", mentions: ASK, state }))).toEqual(
      want,
    )
    expect(startsOf(plan({}))).toBeNull()
    expect(startsOf(plan({ mentions: ASK }))).toBeNull()
  })
  test("only a thread with a lane compels without a mention; elsewhere @agent does", () => {
    expect(kind(plan({ lane: lane() }))).toBe("run")
    expect(kind(plan({}))).not.toBe("createAndRun")
    expect(kind(plan({ mentions: ASK, mode: "branch" }))).toBe("createAndRun")
  })
  test("an idle lane: runs on it", () => {
    expect(plan({ mentions: ASK, lane: lane() })).toMatchObject({
      kind: "run",
      thread: LANE,
    })
  })
  test("a reply that another writer raced is a conflict, naming them", () => {
    expect(plan({ mentions: ASK, race: { by: BO } })).toEqual({
      kind: "conflict",
      by: BO,
    })
    expect(plan({ mentions: ASK, lane: lane(), race: { by: BO } })).toEqual({
      kind: "conflict",
      by: BO,
    })
  })
  test("a reply that finds the lane busy is a conflict, naming who holds it", () => {
    expect(
      plan({ mentions: ASK, lane: lane({ running: true, askedBy: BO }) }),
    ).toEqual({
      kind: "conflict",
      by: BO,
    })
    // Idle for a moment between popped cards is still busy.
    expect(kind(plan({ mentions: ASK, lane: lane({ waiting: 1 }) }))).toBe(
      "conflict",
    )
  })
  test("queue, the host's pop: the cards behind it do not make the lane busy, a run does", () => {
    expect(
      kind(plan({ mentions: ASK, mode: "queue", lane: lane({ waiting: 2 }) })),
    ).toBe("run")
    expect(
      kind(
        plan({
          mentions: parseMentions("@bo hi"),
          mode: "queue",
          lane: lane({ waiting: 2 }),
        }),
      ),
    ).toBe("appendToLane")
    expect(
      plan({ mentions: ASK, mode: "queue", lane: lane({ running: true }) }),
    ).toEqual({ kind: "busy" })
    // The pop already passed the hold: a held queue does not stop it.
    expect(
      kind(plan({ mentions: ASK, mode: "queue", lane: lane({ heldBy: BO }) })),
    ).toBe("run")
    expect(kind(plan({ mentions: ASK, mode: "queue", race: { by: BO } }))).toBe(
      "createAndRun",
    )
  })
})

describe("planMessage: branch", () => {
  test("plain: appended at the branch point with no lane; compelled: always a new lane there", () => {
    expect(plan({ mode: "branch", at: atEntry(E2) })).toMatchObject({
      kind: "appendToTree",
      parent: atEntry(E2),
    })
    expect(
      plan({
        mode: "branch",
        mentions: ASK,
        at: atEntry(E2),
        race: { by: BO },
      }),
    ).toMatchObject({
      kind: "createAndRun",
      at: atEntry(E2),
    })
  })
  test("a branch never continues a lane, even at its idle tip: that is stepping down", () => {
    expect(plan({ mode: "branch", lane: lane() })).toMatchObject({
      kind: "appendToTree",
      parent: atEntry(E1),
    })
    expect(
      plan({ mode: "branch", mentions: ASK, lane: lane({ running: true }) }),
    ).toMatchObject({ kind: "createAndRun", at: atEntry(E1) })
  })
})

test("parseMentions: handles start words, repeats collapse, e-mail is not a mention", () => {
  assert.deepEqual(parseMentions("@agent and @bob, @bob again; a@b.c"), [
    { kind: "agent", agent: THE_AGENT },
    { kind: "person", name: "bob" },
  ])
})

// ── the stored message ───────────────────────────────────────────────────────

const details = {
  author: ALICE,
  authorName: "Alice",
  text: "the plum",
  compels: NOBODY,
  sendId: "s-1",
}

test("encodeMessage: the model reads the speaker; details keep the author's words", () => {
  const m = encodeMessage(details, 1)
  assert.equal(m.content, "Alice: the plum")
  assert.deepEqual(decodeMessage(m), details)
})

const IMG = {
  sha256: "a".repeat(64) as Sha256,
  mimeType: "image/png",
  width: 4,
  height: 3,
} as const
const OTHER = { ...IMG, sha256: "b".repeat(64) as Sha256 }

test("a chat's images round-trip in its details; one stored without them decodes as before", () => {
  const withImages = { ...details, images: [IMG, OTHER] }
  const m = encodeMessage(withImages, 1)
  assert.equal(m.content, "Alice: the plum")
  assert.deepEqual(decodeMessage(m), withImages)
  assert.equal(decodeMessage(encodeMessage(details, 1))?.images, undefined)
  // A malformed image makes the whole chat undecodable, as any bad field does.
  assert.equal(
    decodeMessage({
      ...m,
      details: { ...withImages, images: [{ ...IMG, sha256: "x" }] },
    }),
    undefined,
  )
})

test("planMessage copies the shares it is given into the details, and none as absent", () => {
  const share = {
    name: "plum.png",
    original: IMG,
    size: 3,
    shown: IMG,
    hasLocation: true,
  }
  const withShares = plan({ shares: { images: [IMG], shared: [share] } })
  assert.ok("details" in withShares)
  assert.deepEqual(withShares.details.images, [IMG])
  assert.deepEqual(withShares.details.shared, [share])
  assert.deepEqual(
    decodeMessage(encodeMessage(withShares.details, 1))?.shared,
    [share],
  )
  const without = plan({})
  assert.ok("details" in without)
  assert.equal(without.details.images, undefined)
  assert.equal(without.details.shared, undefined)
})

test("messageImageShas: every chat's images, each once; other messages have none", () => {
  const messages = [
    encodeMessage({ ...details, images: [IMG, OTHER] }, 1),
    { role: "user", content: "hi" },
    encodeMessage({ ...details, images: [OTHER] }, 2),
    encodeMessage(details, 3),
  ]
  assert.deepEqual(messageImageShas(messages), [IMG.sha256, OTHER.sha256])
})

test("withMessageImages: a chat's text, then its images in order; a missing one named; others untouched", () => {
  const personMessage = encodeMessage({ ...details, images: [IMG, OTHER] }, 1)
  const plain = encodeMessage(details, 2)
  const user = { role: "user", content: "hi" }
  const [attached, same, alsoSame] = withMessageImages(
    [personMessage, plain, user],
    new Map([[IMG.sha256, { data: "AAAA", mimeType: "image/png" as const }]]),
  )
  assert.deepEqual((attached as { content: unknown }).content, [
    { type: "text", text: "Alice: the plum" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
    { type: "text", text: `[image ${OTHER.sha256} is no longer stored]` },
  ])
  assert.deepEqual(decodeMessage(attached), decodeMessage(personMessage))
  assert.equal(same, plain)
  assert.equal(alsoSame, user)
})

test("withMessageImages: a fitted image's part follows the line that maps it back to its original", () => {
  const fitted = { ...OTHER, width: 2, height: 1 }
  const original = { ...IMG, width: 8, height: 4 }
  const personMessage = encodeMessage(
    {
      ...details,
      images: [fitted],
      shared: [
        {
          name: "big.png",
          original,
          size: 9,
          shown: fitted,
          hasLocation: false,
        },
      ],
    },
    1,
  )
  const [attached] = withMessageImages(
    [personMessage],
    new Map([
      [fitted.sha256, { data: "AAAA", mimeType: "image/png" as const }],
    ]),
  )
  assert.deepEqual((attached as { content: unknown }).content, [
    { type: "text", text: "Alice: the plum" },
    {
      type: "text",
      text: "[big.png: original 8x4, shown at 2x1. Multiply coordinates by 4.00 to map to the original.]",
    },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ])
})

test("decodeMessage is total: a malformed or foreign message is not a chat", () => {
  assert.equal(
    decodeMessage({ role: "custom", customType: "pinetrie.chat" }),
    undefined,
  )
  assert.equal(decodeMessage({ role: "user", content: "hi" }), undefined)
  assert.equal(decodeMessage(undefined), undefined)
})

test("renderableMessage: a chat renders as role chat with its author", () => {
  assert.deepEqual(renderableMessage(encodeMessage(details, 1)), {
    role: "person",
    content: "the plum",
    author: "Alice",
    compelled: false,
    writer: ALICE,
    sendId: "s-1",
  })
})

test("participants: named writers and every writer in the tree, the unnamed by their email", () => {
  const names = new Map([[ALICE, "Alice"]])
  const bo = writerId("bo.b@x.io")
  const all = participants(names, [ALICE, bo])
  assert.deepEqual(all, ["Alice", "bo.b"])
  // Unnamed, bo is still someone a mention reaches.
  assert.deepEqual(
    address({
      mentions: parseMentions("@bob look"),
      participants: all,
      agents: [],
      agentByDefault: true,
    }).people,
    ["bo.b"],
  )
})

describe("settling and starting up", () => {
  const LANE1 = threadIdFor("1")
  const LANE2 = threadIdFor("2")
  /** A lane as a host with no tools proves it: always runnable. */
  const runnable = (lane: typeof LANE1) => proveRunnable(lane, undefined, null)
  const queuedOn = (lane: typeof LANE1, id: string) => ({
    kind: "text" as const,
    id: textCardId(id),
    owner: ALICE,
    placer: ALICE,
    place: {
      kind: "queued" as const,
      thread: lane,
      order: "a",
      by: ALICE,
      seen: "",
    },
    content: { command: null, unsent: null, origin: null },
  })
  test("settleRun: a refused run keeps the message; an admitted one is done", () => {
    expect(settleRun({ kind: "refused" })).toBe("keep")
    expect(settleRun({ kind: "ok" })).toBe("done")
  })
  test("planStartup: every lane with queued cards drains, once", () => {
    const plan = planStartup({
      cards: [
        queuedOn(LANE1, cardIdFor("c1")),
        queuedOn(LANE1, cardIdFor("c2")),
      ],
      interrupted: [],
      runEndReports: [],
    })
    expect(plan).toEqual({
      resume: [],
      kept: [],
      drain: [LANE1],
      unclassified: [],
    })
  })
  test("planStartup: an interrupted lane is resumed, and not drained", () => {
    const plan = planStartup({
      cards: [
        queuedOn(LANE1, cardIdFor("c1")),
        queuedOn(LANE2, cardIdFor("c2")),
      ],
      interrupted: [runnable(LANE1)],
      runEndReports: [],
    })
    expect(plan).toMatchObject({ resume: [LANE1], drain: [LANE2] })
  })
  test("planStartup: a lane of another kind stays interrupted, and is drained as any other", () => {
    const foreign = {
      kind: "foreign",
      lane: LANE2,
      history: "folder",
    } as const
    const plan = planStartup({
      cards: [queuedOn(LANE2, cardIdFor("c2"))],
      interrupted: [runnable(LANE1), foreign],
      runEndReports: [],
    })
    expect(plan).toMatchObject({
      resume: [LANE1],
      kept: [foreign],
      drain: [LANE2],
    })
  })
  test("planStartup: a pending run-end report is unclassified, unless its lane is resumed", () => {
    const pending = (lane: typeof LANE1) =>
      pendingRunEndReport(lane, entryId(`p-${lane}`), entryId(`w-${lane}`))
    const modelSaid = {
      ...pending(LANE2),
      report: { kind: "modelSaid", urgency: "done", reason: null } as const,
    }
    const plan = planStartup({
      cards: [],
      interrupted: [runnable(LANE1)],
      runEndReports: [pending(LANE1), pending(LANE2), modelSaid],
    })
    expect(plan.unclassified).toEqual([
      { ...pending(LANE2), report: { kind: "unclassified" } },
    ])
  })
})

describe("a host tool's result as a fact", () => {
  const result = (toolName: string, details: unknown, text = "Asked.") => ({
    role: "toolResult",
    toolCallId: cardIdFor("c1"),
    toolName,
    content: [{ type: "text", text }],
    details,
    isError: false,
  })

  test("an ask_about_conflict the host took is asked, from its details alone", () => {
    expect(
      renderableMessage(result(CONFLICT_TOOL, { asked: true })),
    ).toMatchObject({ role: "toolResult", asked: true })
    expect(
      renderableMessage(result(CONFLICT_TOOL, undefined)).asked,
    ).toBeUndefined()
    expect(
      renderableMessage(result("bash", { asked: true })).asked,
    ).toBeUndefined()
  })

  test("a catch_up result carries the commits it merged", () => {
    expect(
      renderableMessage(result(CATCH_UP_TOOL, { merged: ["c1"] }, "merged"))
        .merged,
    ).toEqual(["c1"])
    expect(
      renderableMessage(result(CATCH_UP_TOOL, { merged: [3] })).merged,
    ).toBeUndefined()
  })

  test("a propose_branches result carries its proposal; one that holds none carries nothing", () => {
    const proposal = { branches: [{ title: "a", brief: "do a" }] }
    expect(renderableMessage(result(PROPOSE_TOOL, proposal)).proposal).toEqual(
      proposal,
    )
    expect(
      renderableMessage(result(PROPOSE_TOOL, undefined)).proposal,
    ).toBeUndefined()
  })
})

describe("promptAuthor", () => {
  const ADA = writerId("ada@example.com")
  test("a chat's author, a land or stack message's by; none for anything else", () => {
    expect(
      promptAuthor(
        encodeMessage(
          {
            author: ADA,
            authorName: "Ada",
            text: "go",
            compels: NOBODY,
            sendId: "s-1",
          },
          1,
        ),
      ),
    ).toBe(ADA)
    expect(
      promptAuthor(
        planResolution({
          floor: floor(),
          files: [],
          details: { lane: threadIdFor("1"), merged: [], by: ADA },
          timestamp: 1,
        }),
      ),
    ).toBe(ADA)
    expect(
      promptAuthor(
        planStack({
          skill: null,
          bookmark: "pinetrie-stack/x",
          details: {
            lane: threadIdFor("1"),
            start: [],
            tip: commitId("t"),
            by: ADA,
          },
          timestamp: 1,
        }),
      ),
    ).toBe(ADA)
    expect(promptAuthor({ role: "user", content: "hi" })).toBeNull()
  })

  test("a carry-on's run is its owner's", () => {
    expect(
      promptAuthor(
        planSshNews(
          { kind: "allowed", host: "hql", owner: ADA },
          threadIdFor("1"),
          "Ada",
          1,
        ).message,
      ),
    ).toBe(ADA)
  })
})

describe("planMessage: a lane with no work of its own catches up first", () => {
  const ask = { mentions: ASK, text: "@agent please", lane: lane() }
  test("a run on a lane whose news is catch-up catches it up first, once per send", () => {
    expect(plan({ ...ask, news: "catch-up" })).toEqual({
      kind: "catch-up-first",
      thread: LANE,
    })
    expect(kind(plan({ ...ask, news: "catch-up", caughtUp: true }))).toBe("run")
    expect(kind(plan({ ...ask, news: "tell" }))).toBe("run")
  })
  test("an append, a busy lane and a new lane never catch up", () => {
    expect(
      kind(
        plan({
          lane: lane(),
          mentions: parseMentions("@bo look"),
          news: "catch-up",
        }),
      ),
    ).toBe("appendToLane")
    expect(
      kind(plan({ ...ask, lane: lane({ running: true }), news: "catch-up" })),
    ).toBe("conflict")
    expect(kind(plan({ ...ask, lane: NONE, news: "catch-up" }))).toBe(
      "createAndRun",
    )
  })
})
