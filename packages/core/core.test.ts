// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  address,
  emailLocalPart,
  findSeqKeys,
  handleOf,
  indexTree,
  laneNameForThread,
  latestTip,
  messageText,
  NOBODY,
  normalizeEmail,
  normalizeName,
  parseMentions,
  parseNewLane,
  parseTitle,
  projectTranscript,
  THE_AGENT,
  writerId,
  writerOfPrincipal,
} from "@pineta/core"
import { describe, expect, test } from "vitest"

describe("who a principal is (ADR-0037)", () => {
  test("an email is trimmed and lower-cased", () => {
    expect(normalizeEmail("  Duane@Example.COM ")).toBe("duane@example.com")
  })

  test("anything else is refused", () => {
    for (const text of [
      "",
      "duane",
      "@example.com",
      "duane@",
      "duane@example",
      "duane@.com",
      "duane@example.",
      "a@b@example.com",
      "du ane@example.com",
      "du:ane@example.com",
      "_@example.com",
    ])
      expect(normalizeEmail(text), text).toBeUndefined()
  })

  test("the host's principal names no writer", () => {
    expect(writerOfPrincipal("pineta-host")).toBeUndefined()
    expect(writerOfPrincipal(undefined)).toBeUndefined()
    expect(writerOfPrincipal("Ada@X.io")).toBe(writerId("ada@x.io"))
  })

  test("an unnamed writer's label is the part before the @", () => {
    expect(emailLocalPart(writerId("ada.l@x.io"))).toBe("ada.l")
  })
})

test("latestTip: the newest tip by id, independent of input order", () => {
  // Out of id order on purpose: a helper that returned the first or last tip
  // would pass an in-order input.
  assert.equal(latestTip(["b-2", null, "c-3", "a-1"]), "c-3")
  assert.equal(latestTip(["c-3", "a-1", "b-2"]), "c-3")
  assert.equal(latestTip([null, null]), null, "lanes with no tip are ignored")
  assert.equal(latestTip([]), null, "an empty session has no view")
})

test("writerId and laneNameForThread: a person and a thread are never confused", () => {
  assert.equal(writerId("abc"), "w-abc")
  assert.throws(() => writerId(""), /non-empty/)
  assert.throws(() => writerId("a\u0000b"), /u0000/)
  // Different prefixes: a writer's id can never name a thread's lane.
  assert.equal(laneNameForThread("abc"), "t-abc")
  assert.notEqual(String(laneNameForThread("abc")), String(writerId("abc")))
})

test("parseNewLane: only t- and a lowercase uuidv7, since a container is named after it (ADR-0057)", () => {
  const ok = "t-01a0f9eb-86e1-77ad-a822-2a306786223f"
  assert.equal(parseNewLane(ok), ok)
  for (const bad of [
    "t-abc",
    ok.toUpperCase(),
    "t-01a0f9eb-86e1-47ad-a822-2a306786223f",
    "t-01a0f9eb-86e1-77ad-c822-2a306786223f",
    `${ok};rm -rf`,
    ` ${ok}`,
  ])
    assert.equal(parseNewLane(bad), undefined, bad)
})

test("findSeqKeys: ADR-0013 — seq must not ride the wire", () => {
  assert.deepEqual(findSeqKeys({ id: "x", accepted: true }), [])
  assert.deepEqual(findSeqKeys({ a: { seq: 3 } }), ["$.a.seq"])
  assert.deepEqual(findSeqKeys([{ seq: 1 }]), ["$[0].seq"])
  assert.deepEqual(findSeqKeys(null), [])
})

test("projectTranscript: order comes from the parentId walk, not insertion or seq", () => {
  // Deliberately insert out of order, and give the entries misleading seqs.
  const entries = {
    c: {
      id: "c",
      parentId: "b",
      type: "message",
      seq: 1,
      message: { role: "assistant", content: "three" },
    },
    a: {
      id: "a",
      parentId: null,
      type: "message",
      seq: 9,
      message: { role: "user", content: "one" },
    },
    b: {
      id: "b",
      parentId: "a",
      type: "message",
      seq: 5,
      message: { role: "user", content: "two" },
    },
  }
  const out = projectTranscript(indexTree(entries), "c")
  assert.deepEqual(
    out.map(m => m.text),
    ["one", "two", "three"],
  )
})

test("projectTranscript: an abandoned branch is not on the tip's path", () => {
  const entries = {
    a: {
      id: "a",
      parentId: null,
      type: "message",
      message: { role: "user", content: "root" },
    },
    b: {
      id: "b",
      parentId: "a",
      type: "message",
      message: { role: "assistant", content: "kept" },
    },
    x: {
      id: "x",
      parentId: "a",
      type: "message",
      message: { role: "assistant", content: "abandoned" },
    },
  }
  assert.deepEqual(
    projectTranscript(indexTree(entries), "b").map(m => m.text),
    ["root", "kept"],
  )
})

test("projectTranscript: non-message entries and unknown roles are dropped", () => {
  const entries = {
    a: {
      id: "a",
      parentId: null,
      type: "message",
      message: { role: "user", content: "hi" },
    },
    m: { id: "m", parentId: "a", type: "custom", customType: "acp:plan" },
    s: {
      id: "s",
      parentId: "m",
      type: "message",
      message: { role: "toolResult", content: "noise" },
    },
  }
  assert.deepEqual(
    projectTranscript(indexTree(entries), "s").map(m => m.role),
    ["user"],
  )
})

test("projectTranscript: a cycle is reported, not spun on", () => {
  const entries = {
    a: {
      id: "a",
      parentId: "b",
      type: "message",
      message: { role: "user", content: "a" },
    },
    b: {
      id: "b",
      parentId: "a",
      type: "message",
      message: { role: "user", content: "b" },
    },
  }
  assert.throws(() => projectTranscript(indexTree(entries), "a"), /cycle/)
})

test("messageText: flattens pi's content parts", () => {
  assert.equal(messageText({ content: "plain" }), "plain")
  assert.equal(
    messageText({
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    }),
    "ab",
  )
  assert.equal(messageText({ content: [{ type: "image" }] }), "")
  assert.equal(messageText(undefined), "")
})

describe("address: mentions pick who a message is for (ADR-0021)", () => {
  const who = (text: string, agentByDefault: boolean) =>
    address({
      mentions: parseMentions(text),
      participants: ["Ada Lovelace", "O'Brien", "guest-x4bu"],
      agentByDefault,
    })
  test("@agent asks the agent, with or without people", () => {
    expect(who("@agent go", false).compels.kind).toBe("agent")
    expect(who("@agent @adalovelace go", false)).toEqual({
      compels: { kind: "agent", agent: THE_AGENT },
      people: ["Ada Lovelace"],
    })
  })
  test("@Ada alone in agent work is for Ada only", () => {
    expect(who("@AdaLovelace look", true)).toEqual({
      compels: NOBODY,
      people: ["Ada Lovelace"],
    })
  })
  test("an unknown handle is ignored: the thread's default stands", () => {
    expect(who("bump @types/node please", true).compels.kind).toBe("agent")
    expect(who("bump @types/node please", false).compels).toEqual(NOBODY)
  })
  test("no mention: the default, either way", () => {
    expect(who("hi", true).compels.kind).toBe("agent")
    expect(who("hi", false).compels).toEqual(NOBODY)
  })
  test("a handle is a name in any script: @日本, @josé, however José was typed", () => {
    const people = address({
      mentions: parseMentions("@日本 @josé look"),
      participants: ["日本", "Jose\u0301"],
      agentByDefault: true,
    })
    expect(people).toEqual({ compels: NOBODY, people: ["日本", "Jose\u0301"] })
  })
  test("normalizeName refuses a name no mention could reach", () => {
    expect(normalizeName("  Ada ")).toBe("Ada")
    expect(normalizeName("!!")).toBeUndefined()
    expect(normalizeName("Agent")).toBeUndefined()
    expect(normalizeName("")).toBeUndefined()
  })
  test("parseTitle trims a title, clears on blank, and refuses a line break or 81 characters", () => {
    expect(parseTitle("  Tab names  ")).toEqual({
      kind: "set",
      title: "Tab names",
    })
    expect(parseTitle("")).toEqual({ kind: "clear" })
    expect(parseTitle("   ")).toEqual({ kind: "clear" })
    expect(parseTitle("two\nlines")).toEqual({ kind: "invalid" })
    expect(parseTitle("x".repeat(80))).toEqual({
      kind: "set",
      title: "x".repeat(80),
    })
    expect(parseTitle("x".repeat(81))).toEqual({ kind: "invalid" })
  })
  test("a handle is the name in handle characters: @obrien, @guest-x4bu", () => {
    expect(handleOf("O'Brien")).toBe("obrien")
    expect(who("@obrien @guest-x4bu", true).people).toEqual([
      "O'Brien",
      "guest-x4bu",
    ])
  })
})
