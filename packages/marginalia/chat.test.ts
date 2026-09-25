import assert from "node:assert/strict"
import {
  atEntry,
  entryId,
  indexTree,
  laneNameForThread,
  NOBODY,
  parseMentions,
  type Responder,
  ROOT,
  THE_AGENT,
  type ThreadLane,
  type WriterId,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  decodeChat,
  effectiveDefault,
  encodeChat,
  entryText,
  heldMessages,
  nextHeld,
  planChat,
  planDrain,
  planStartup,
  renderableMessage,
  rulesAlong,
  settleRun,
  threadDefaults,
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
  ...over,
})
const NONE: ThreadLane = { kind: "none" }
const ASK = parseMentions("@agent please")

const plan = (over: Partial<Parameters<typeof planChat>[0]>) =>
  planChat({
    author: ALICE,
    authorName: "Alice",
    text: "hello",
    mode: "reply",
    at: atEntry(E1),
    end: atEntry(E1),
    race: null,
    mentions: [],
    threadDefault: NOBODY,
    lane: NONE,
    ...over,
  })
const kind = (d: ReturnType<typeof planChat>) => d.kind

describe("planChat: plain messages never conflict", () => {
  test("no lane: appended at the thread's end, with no lane", () => {
    const d = plan({ end: atEntry(E2) })
    expect(d).toMatchObject({ kind: "appendToTree", parent: atEntry(E2) })
  })
  test("an idle lane: appended through it", () => {
    expect(plan({ lane: lane() })).toMatchObject({
      kind: "appendToLane",
      lane: LANE,
    })
  })
  test("a running lane, or one with messages waiting: held, behind them", () => {
    expect(plan({ lane: lane({ running: true }) })).toMatchObject({
      kind: "hold",
      position: 0,
    })
    expect(plan({ lane: lane({ waiting: 2 }) })).toMatchObject({
      kind: "hold",
      position: 2,
    })
  })
  test("another writer's compelled message below: still appended, never a conflict", () => {
    expect(kind(plan({ race: { by: BO } }))).toBe("appendToTree")
    expect(kind(plan({ race: { by: BO }, lane: lane() }))).toBe("appendToLane")
  })
  test("mentioning a person only notifies: still plain", () => {
    expect(kind(plan({ mentions: parseMentions("hi @bo") }))).toBe(
      "appendToTree",
    )
  })
})

describe("planChat: a compelled message", () => {
  test("no lane: creates the thread's lane at the end and runs", () => {
    expect(plan({ mentions: ASK, end: atEntry(E2) })).toMatchObject({
      kind: "createAndRun",
      at: atEntry(E2),
    })
  })
  test("a working session compels without a mention", () => {
    expect(kind(plan({ threadDefault: AGENT }))).toBe("createAndRun")
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
    // Idle for a moment between drained messages is still busy.
    expect(kind(plan({ mentions: ASK, lane: lane({ waiting: 1 }) }))).toBe(
      "conflict",
    )
  })
  test("queue: runs when idle, holds when busy, creates when there is no lane", () => {
    expect(kind(plan({ mentions: ASK, mode: "queue", lane: lane() }))).toBe(
      "run",
    )
    expect(
      plan({
        mentions: ASK,
        mode: "queue",
        lane: lane({ running: true, waiting: 1 }),
      }),
    ).toMatchObject({
      kind: "hold",
      position: 1,
    })
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
  test("at a lane just created there, still running, it is another new lane", () => {
    expect(
      plan({ mode: "branch", mentions: ASK, lane: lane({ running: true }) }),
    ).toMatchObject({
      kind: "createAndRun",
      at: atEntry(E1),
    })
  })
  test("at a thread lane's own tip it is a reply: nothing there to fork", () => {
    expect(kind(plan({ mode: "branch", lane: lane() }))).toBe("appendToLane")
    expect(kind(plan({ mode: "branch", mentions: ASK, lane: lane() }))).toBe(
      "run",
    )
  })
})

test("parseMentions: handles start words, repeats collapse, e-mail is not a mention", () => {
  assert.deepEqual(parseMentions("@agent and @bob, @bob again; a@b.c"), [
    { kind: "agent", agent: THE_AGENT },
    { kind: "person", name: "bob" },
  ])
})

// ── thread defaults ──────────────────────────────────────────────────────────

// e-3 -> e-2 -> e-1 -> root
const parents: Record<string, string | null> = {
  "e-1": null,
  "e-2": "e-1",
  "e-3": "e-2",
}
const index = indexTree(
  Object.fromEntries(
    Object.entries(parents).map(([id, parentId]) => [
      id,
      { id, parentId, type: "message" },
    ]),
  ),
)

test("effectiveDefault: unset means the root's working session", () => {
  assert.deepEqual(
    effectiveDefault(atEntry(entryId("e-3")), index, new Map()),
    AGENT,
  )
  assert.deepEqual(effectiveDefault(ROOT, index, new Map()), AGENT)
})

test("effectiveDefault: the nearest ancestor's default wins", () => {
  const defaults = new Map([
    [E1, AGENT],
    [E2, NOBODY],
  ])
  // e-2 sets a conversation inside e-1's working session.
  assert.deepEqual(
    effectiveDefault(atEntry(entryId("e-3")), index, defaults),
    NOBODY,
  )
  // e-1's own default applies at e-1 itself.
  assert.deepEqual(effectiveDefault(atEntry(E1), index, defaults), AGENT)
})

test("threadDefaults: a malformed stored default is skipped", () => {
  const d = threadDefaults([
    { key: "e-1", value: { kind: "agent", agent: "agent" } },
    { key: "e-2", value: { kind: "everyone" } },
  ])
  assert.deepEqual([...d.keys()], [E1])
})

// ── the stored message ───────────────────────────────────────────────────────

const details = {
  author: ALICE,
  authorName: "Alice",
  text: "the plum",
  compels: NOBODY,
}

test("encodeChat: the model reads the speaker; details keep the author's words", () => {
  const m = encodeChat(details, 1)
  assert.equal(m.content, "Alice: the plum")
  assert.deepEqual(decodeChat(m), details)
})

test("decodeChat is total: a malformed or foreign message is not a chat", () => {
  assert.equal(
    decodeChat({ role: "custom", customType: "pineta.chat" }),
    undefined,
  )
  assert.equal(decodeChat({ role: "user", content: "hi" }), undefined)
  assert.equal(decodeChat(undefined), undefined)
})

test("entryText: a chat's span text is what its author wrote, not the attributed content", () => {
  assert.equal(entryText(encodeChat(details, 1)), "the plum")
  assert.equal(entryText({ role: "user", content: "plain" }), "plain")
})

test("renderableMessage: a chat renders as role chat with its author", () => {
  assert.deepEqual(renderableMessage(encodeChat(details, 1)), {
    role: "chat",
    content: "the plum",
    author: "Alice",
    compelled: false,
    writer: ALICE,
  })
})

test("rulesAlong: each message carries the rule set there, or the one above", () => {
  const defaults = new Map([[E2, NOBODY]])
  assert.deepEqual(rulesAlong(["e-1", "e-2", "e-3"], AGENT, defaults), [
    AGENT,
    NOBODY,
    NOBODY,
  ])
})

describe("outbox", () => {
  const held = (id: string, laneName: string) => ({
    id,
    lane: laneName,
    details: { author: ALICE, authorName: "Alice", text: id, compels: NOBODY },
    timestamp: 1,
  })
  test("heldMessages: oldest first, malformed values skipped", () => {
    const h = heldMessages([
      { value: held("3-c", "t-1") },
      { value: { id: "2-x" } },
      { value: held("1-a", "t-1") },
    ])
    expect(h.map(x => x.id)).toEqual(["1-a", "3-c"])
  })
  test("nextHeld: the oldest for the given lane only", () => {
    const h = heldMessages([
      { value: held("1-a", "t-other") },
      { value: held("2-b", "t-1") },
      { value: held("3-c", "t-1") },
    ])
    expect(nextHeld(h, laneNameForThread("1"))?.id).toBe("2-b")
  })
})

describe("draining, settling and starting up", () => {
  const LANE1 = laneNameForThread("1")
  const held = (id: string, compels: Responder) => ({
    id,
    lane: LANE1,
    details: { author: ALICE, authorName: "Alice", text: id, compels },
    timestamp: 1,
  })
  test("planDrain: a plain message is appended, a compelled one is run, then idle", () => {
    expect(planDrain([held("1-a", NOBODY)], LANE1)).toMatchObject({
      kind: "append",
    })
    expect(planDrain([held("1-a", AGENT)], LANE1)).toMatchObject({
      kind: "run",
    })
    expect(planDrain([], LANE1)).toEqual({ kind: "idle" })
  })
  test("settleRun: a refused run keeps the message; an admitted one is done", () => {
    expect(settleRun({ kind: "refused" })).toBe("keep")
    expect(settleRun({ kind: "ok" })).toBe("done")
  })
  test("planStartup: stale runs are cleared; every lane with held messages drains, once", () => {
    const LANE2 = laneNameForThread("2")
    const plan = planStartup({
      running: [LANE2],
      held: [held("1-a", NOBODY), held("2-b", AGENT)],
    })
    expect(plan).toEqual({ clear: [LANE2], drain: [LANE1] })
  })
})
