import assert from "node:assert/strict"
import {
  atEntry,
  ERR,
  entryId,
  indexTree,
  type LaneName,
  laneNameForWriter,
  NOBODY,
  parseMentions,
  type Responder,
  ROOT,
  THE_AGENT,
} from "@pineta/core"
import { test } from "vitest"
import {
  decodeChat,
  effectiveDefault,
  encodeChat,
  entryText,
  planChat,
  renderableMessage,
  rulesAlong,
  threadDefaults,
} from "./index.ts"

const ALICE: LaneName = laneNameForWriter("alice")
const E1 = entryId("e-1")
const E2 = entryId("e-2")
const AGENT: Responder = { kind: "agent", agent: THE_AGENT }
const laneAt = (id: typeof E1) => ({ kind: "lane", at: atEntry(id) }) as const
const idle = { ready: true, busy: false }

const plan = (over: Partial<Parameters<typeof planChat>[0]>) =>
  planChat({
    author: ALICE,
    authorName: "Alice",
    text: "hello",
    at: { kind: "tip" },
    mentions: [],
    threadDefault: NOBODY,
    authorLane: laneAt(E1),
    agentLane: { kind: "none" },
    agentTurn: idle,
    ...over,
  })

test("planChat: a message that compels nobody is appended on the author's lane", () => {
  const d = plan({})
  assert.equal(d.kind, "append")
  assert.deepEqual(d.kind === "append" ? d.attach : undefined, {
    kind: "stay",
  })
  assert.deepEqual(d.kind === "append" ? d.details.compels : undefined, NOBODY)
})

test("planChat: @agent runs the agent, creating its lane where the author is", () => {
  const d = plan({ mentions: parseMentions("hi @agent") })
  assert.equal(d.kind, "run")
  // The author's "tip" is resolved to the author's position: the agent's lane
  // cannot attach at another writer's tip.
  assert.deepEqual(d.kind === "run" ? d.attach : undefined, {
    kind: "create",
    at: atEntry(E1),
  })
  assert.deepEqual(d.kind === "run" ? d.details.compels : undefined, AGENT)
})

test("planChat: once the agent has a lane, a later mention moves it there", () => {
  const d = plan({
    mentions: parseMentions("@agent again"),
    at: { kind: "entry", id: E2 },
    agentLane: laneAt(E1),
  })
  assert.deepEqual(d.kind === "run" ? d.attach : undefined, {
    kind: "navigate",
    to: atEntry(E2),
  })
})

test("planChat: a working session runs the agent without a mention", () => {
  assert.equal(plan({ threadDefault: AGENT }).kind, "run")
})

test("planChat: mentioning a person only notifies; nothing runs", () => {
  assert.equal(plan({ mentions: parseMentions("hi @bob") }).kind, "append")
})

test("planChat: compelling a busy agent is refused, not dropped", () => {
  const d = plan({
    threadDefault: AGENT,
    agentTurn: { ready: true, busy: true },
  })
  assert.deepEqual(d, { kind: "refused", code: ERR.BUSY })
})

test("planChat: a busy agent does not block a plain message", () => {
  assert.equal(plan({ agentTurn: { ready: true, busy: true } }).kind, "append")
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
