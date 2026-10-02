import assert from "node:assert/strict"
import {
  address,
  atEntry,
  cardId,
  ERR,
  entryId,
  laneNameForThread,
  NOBODY,
  parseMentions,
  type Responder,
  type Sha256,
  THE_AGENT,
  type ThreadLane,
  type WriterId,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  addressChat,
  chatImageShas,
  decodeChat,
  detailsFromStored,
  encodeChat,
  participants,
  planChat,
  planStartup,
  renderableMessage,
  settleRun,
  withChatImages,
} from "./index.ts"

const ALICE: WriterId = writerId("alice")
const BO: WriterId = writerId("bo")
const E1 = entryId("e-1")
const E2 = entryId("e-2")
const AGENT: Responder = { kind: "agent", agent: THE_AGENT }
const LANE = laneNameForThread("1")
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
  ...over,
})
const NONE: ThreadLane = { kind: "none" }
const SPARE = laneNameForThread("spare")
const RESERVED = laneNameForThread("reserved")
const ASK = parseMentions("@agent please")

type PlanInput = Omit<Parameters<typeof planChat>[0], "thread"> &
  Parameters<typeof planChat>[0]["thread"]
const plan = (over: Partial<PlanInput>) => {
  const i: PlanInput = {
    author: ALICE,
    authorName: "Alice",
    text: "hello",
    mode: "reply",
    at: atEntry(E1),
    end: atEntry(E1),
    contributors: [],
    images: [],
    hostWorkingCopy: null,
    command: null,
    race: null,
    lane: NONE,
    mentions: [],
    participants: ["Alice", "Bo"],
    asksAgent: false,
    sendId: "s-1",
    newLane: { reserved: null, held: new Set(), spare: SPARE },
    ...over,
  }
  const { end, race, lane: l, ...rest } = i
  return planChat({ ...rest, thread: { end, race, lane: l } })
}
const kind = (d: ReturnType<typeof planChat>) => d.kind
const textOf = (d: ReturnType<typeof planChat>) =>
  "details" in d ? d.details.text : undefined

describe("addressChat: who a chat is for, host and composer alike", () => {
  const to = (
    over: Partial<Parameters<typeof addressChat>[0]> = {},
  ): ReturnType<typeof addressChat> =>
    addressChat({
      mentions: [],
      participants: ["Alice", "Bo"],
      mode: "reply",
      lane: NONE,
      asksAgent: false,
      command: false,
      ...over,
    })
  test("a command is for the agent, and keeps the people it names", () => {
    expect(to({ command: true, mentions: parseMentions("@bo look") })).toEqual({
      compels: AGENT,
      people: ["Bo"],
    })
    expect(to({ mentions: parseMentions("@bo look") })).toEqual({
      compels: NOBODY,
      people: ["Bo"],
    })
  })
  test("no mention asks the agent in agent work, and nobody in a branch", () => {
    expect(to({ lane: lane() }).compels).toEqual(AGENT)
    expect(to({ lane: lane(), mode: "branch" }).compels).toEqual(NOBODY)
    expect(to({ mode: "branch", asksAgent: true }).compels).toEqual(AGENT)
  })
})

describe("planChat: a command (ADR-0036)", () => {
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
    expect(details === undefined ? "" : encodeChat(details, 1).content).toBe(
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
        : encodeChat(detailsFromStored(sent as never), 1).content,
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

describe("planChat: paths to your working copy, in a thread with its own copy", () => {
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

describe("planChat: plain messages never conflict", () => {
  // In a thread with a lane, a plain message is one naming only people.
  const TO_BO = parseMentions("@bo look")
  test("no lane: appended at the thread's end, with no lane", () => {
    const d = plan({ end: atEntry(E2) })
    expect(d).toMatchObject({ kind: "appendToTree", parent: atEntry(E2) })
  })
  test("an idle lane: appended through it", () => {
    expect(plan({ mentions: TO_BO, lane: lane() })).toMatchObject({
      kind: "appendToLane",
      lane: LANE,
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

describe("planChat: a compelled message", () => {
  test("no lane: creates the thread's lane at the end and runs", () => {
    expect(plan({ mentions: ASK, end: atEntry(E2) })).toMatchObject({
      kind: "createAndRun",
      at: atEntry(E2),
    })
  })
  test("a new lane takes its column's reserved id, unless pi holds it, else the host's spare (ADR-0057)", () => {
    const laneOf = (d: ReturnType<typeof plan>) =>
      d.kind === "createAndRun" ? d.lane : d.kind
    const ids = (reserved: typeof RESERVED | null, held: string[] = []) => ({
      newLane: { reserved, held: new Set(held), spare: SPARE },
    })
    for (const mode of ["reply", "branch"] as const) {
      expect(laneOf(plan({ mode, mentions: ASK, ...ids(RESERVED) }))).toBe(
        RESERVED,
      )
      expect(
        laneOf(plan({ mode, mentions: ASK, ...ids(RESERVED, [RESERVED]) })),
      ).toBe(SPARE)
      expect(laneOf(plan({ mode, mentions: ASK, ...ids(null) }))).toBe(SPARE)
    }
  })
  test("a thread with a lane, or a Start Agent column, compels without a mention", () => {
    expect(kind(plan({ lane: lane() }))).toBe("run")
    expect(kind(plan({ asksAgent: true }))).toBe("createAndRun")
    expect(kind(plan({ asksAgent: true, mode: "branch" }))).toBe("createAndRun")
  })
  test("an idle lane: runs on it", () => {
    expect(plan({ mentions: ASK, lane: lane() })).toMatchObject({
      kind: "run",
      lane: LANE,
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
    // Idle for a moment between taken cards is still busy.
    expect(kind(plan({ mentions: ASK, lane: lane({ waiting: 1 }) }))).toBe(
      "conflict",
    )
  })
  test("queue, the host's take: the cards behind it do not make the lane busy, a run does", () => {
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
    expect(kind(plan({ mentions: ASK, mode: "queue", race: { by: BO } }))).toBe(
      "createAndRun",
    )
  })
})

describe("planChat: branch", () => {
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

test("encodeChat: the model reads the speaker; details keep the author's words", () => {
  const m = encodeChat(details, 1)
  assert.equal(m.content, "Alice: the plum")
  assert.deepEqual(decodeChat(m), details)
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
  const m = encodeChat(withImages, 1)
  assert.equal(m.content, "Alice: the plum")
  assert.deepEqual(decodeChat(m), withImages)
  assert.equal(decodeChat(encodeChat(details, 1))?.images, undefined)
  // A malformed image makes the whole chat undecodable, as any bad field does.
  assert.equal(
    decodeChat({
      ...m,
      details: { ...withImages, images: [{ ...IMG, sha256: "x" }] },
    }),
    undefined,
  )
})

test("planChat copies the images it is given into the details, and none as absent", () => {
  const withImages = plan({ images: [IMG] })
  assert.ok("details" in withImages)
  assert.deepEqual(withImages.details.images, [IMG])
  const without = plan({})
  assert.ok("details" in without)
  assert.equal(without.details.images, undefined)
})

test("chatImageShas: every chat's images, each once; other messages have none", () => {
  const messages = [
    encodeChat({ ...details, images: [IMG, OTHER] }, 1),
    { role: "user", content: "hi" },
    encodeChat({ ...details, images: [OTHER] }, 2),
    encodeChat(details, 3),
  ]
  assert.deepEqual(chatImageShas(messages), [IMG.sha256, OTHER.sha256])
})

test("withChatImages: a chat's text, then its images in order; a missing one named; others untouched", () => {
  const chat = encodeChat({ ...details, images: [IMG, OTHER] }, 1)
  const plain = encodeChat(details, 2)
  const user = { role: "user", content: "hi" }
  const [attached, same, alsoSame] = withChatImages(
    [chat, plain, user],
    new Map([[IMG.sha256, { data: "AAAA", mimeType: "image/png" as const }]]),
  )
  assert.deepEqual((attached as { content: unknown }).content, [
    { type: "text", text: "Alice: the plum" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
    { type: "text", text: `[image ${OTHER.sha256} is no longer stored]` },
  ])
  assert.deepEqual(decodeChat(attached), decodeChat(chat))
  assert.equal(same, plain)
  assert.equal(alsoSame, user)
})

test("decodeChat is total: a malformed or foreign message is not a chat", () => {
  assert.equal(
    decodeChat({ role: "custom", customType: "pineta.chat" }),
    undefined,
  )
  assert.equal(decodeChat({ role: "user", content: "hi" }), undefined)
  assert.equal(decodeChat(undefined), undefined)
})

test("renderableMessage: a chat renders as role chat with its author", () => {
  assert.deepEqual(renderableMessage(encodeChat(details, 1)), {
    role: "chat",
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
      agentByDefault: true,
    }).people,
    ["bo.b"],
  )
})

describe("settling and starting up", () => {
  const LANE1 = laneNameForThread("1")
  const LANE2 = laneNameForThread("2")
  const queuedOn = (lane: typeof LANE1, id: string) => ({
    id: cardId(id),
    owner: ALICE,
    place: {
      kind: "queued" as const,
      at: atEntry(E1),
      lane,
      order: "a",
      by: ALICE,
      seen: "",
    },
    command: null,
    unsent: null,
  })
  test("settleRun: a refused run keeps the message; an admitted one is done", () => {
    expect(settleRun({ kind: "refused" })).toBe("keep")
    expect(settleRun({ kind: "ok" })).toBe("done")
  })
  test("planStartup: every lane with queued cards drains, once", () => {
    const plan = planStartup({
      cards: [queuedOn(LANE1, "c-1"), queuedOn(LANE1, "c-2")],
      interrupted: [],
      outbox: [],
    })
    expect(plan).toEqual({ resume: [], drain: [LANE1], discard: [] })
  })
  test("planStartup: an interrupted lane is resumed, and not drained", () => {
    const plan = planStartup({
      cards: [queuedOn(LANE1, "c-1"), queuedOn(LANE2, "c-2")],
      interrupted: [LANE1],
      outbox: [],
    })
    expect(plan).toMatchObject({ resume: [LANE1], drain: [LANE2] })
  })
  test("planStartup: an old outbox's values are discarded, each with its text", () => {
    const plan = planStartup({
      cards: [],
      interrupted: [],
      outbox: [
        { key: "h-1", value: { id: "h-1", details: { text: "hello" } } },
        { key: "h-2", value: { kind: "update", id: "h-2" } },
        { key: "h-3", value: 7 },
      ],
    })
    expect(plan.discard).toEqual([
      { key: "h-1", text: "hello" },
      { key: "h-2", text: "(an update from your work)" },
      { key: "h-3", text: "(unreadable)" },
    ])
  })
})
