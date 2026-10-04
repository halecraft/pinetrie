// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  address,
  atEntry,
  type CardPlace,
  type CardRecord,
  cardId,
  commitId,
  draftingOf,
  emailLocalPart,
  entryId,
  findSeqKeys,
  handleOf,
  indexTree,
  keyOf,
  keyOfFields,
  type LaneRecord,
  laneNameForThread,
  latestTip,
  messageText,
  moveOf,
  NOBODY,
  normalizeEmail,
  normalizeName,
  offerLedger,
  parseMentions,
  parseNewLane,
  parseTitle,
  placeFields,
  placeOfFields,
  projectTranscript,
  queueRoot,
  ROOT,
  rootIdFor,
  sameKey,
  shellWord,
  THE_AGENT,
  TRAILERS,
  trailerValues,
  untracedLanes,
  writerId,
  writerOfPrincipal,
} from "@pineta/core"
import { describe, expect, test } from "vitest"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

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

test("shellWord: one word, whatever it holds", () => {
  expect(shellWord("abc/d.e")).toBe("abc/d.e")
  expect(shellWord('it\'s "x"')).toBe(`'it'\\''s "x"'`)
})

test("latestTip: the newest tip by id, independent of input order", () => {
  // Out of id order on purpose: a helper that returned the first or last tip
  // would pass an in-order input.
  assert.equal(
    latestTip([entryId("b-2"), null, entryId("c-3"), entryId("a-1")]),
    "c-3",
  )
  assert.equal(
    latestTip([entryId("c-3"), entryId("a-1"), entryId("b-2")]),
    "c-3",
  )
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
  const out = projectTranscript(indexTree(entries), entryId("c"))
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
    projectTranscript(indexTree(entries), entryId("b")).map(m => m.text),
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
    projectTranscript(indexTree(entries), entryId("s")).map(m => m.role),
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
  assert.throws(
    () => projectTranscript(indexTree(entries), entryId("a")),
    /cycle/,
  )
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

test("trailerValues reads a trailer from every paragraph, as a squash leaves two (S77)", () => {
  const squashed = [
    "taken one",
    "",
    "Pineta-Source: aaaa",
    "",
    "taken two",
    "",
    "Pineta-Lane: t-2",
    "Pineta-Source: bbbb",
    "",
  ].join("\n")
  expect(trailerValues(squashed, TRAILERS.source)).toEqual(["aaaa", "bbbb"])
  expect(trailerValues(squashed, TRAILERS.base)).toEqual([])
})

test("offerLedger reads the newest paragraph that names a source; none without one (ADR-0060)", () => {
  const one =
    "offer: x\n\nPineta-Source: aaaa\nPineta-Start: s1\nPineta-Start: s2\n"
  expect(offerLedger(one)).toEqual({
    source: commitId("aaaa"),
    start: [commitId("s1"), commitId("s2")],
  })
  const squashed = `${one}\nPineta-Source: bbbb\nPineta-Start: s3\n`
  expect(offerLedger(squashed)).toEqual({
    source: commitId("bbbb"),
    start: [commitId("s3")],
  })
  expect(offerLedger("offer: yours, rewritten\n")).toBeNull()
  expect(offerLedger("offer: x\n\nPineta-Source: aaaa\n")).toBeNull()
})

test("untracedLanes: a take's paragraph naming a thread and a lane but no source; never a turn's, nor a traced take's (S97)", () => {
  const lane = laneNameForThread("1")
  const old = `feat: x\n\nPineta-Thread: amber-fox\nPineta-Lane: ${lane}\nPineta-Entry: e\n`
  expect(untracedLanes(old)).toEqual([lane])
  expect(
    untracedLanes(
      `${old}\nPineta-Thread: amber-fox\nPineta-Lane: ${lane}\nPineta-Source: aaaa\n`,
    ),
  ).toEqual([lane])
  expect(
    untracedLanes(
      `feat: x\n\nPineta-Thread: amber-fox\nPineta-Lane: ${lane}\nPineta-Source: aaaa\n`,
    ),
  ).toEqual([])
  expect(
    untracedLanes(`turn\n\nPineta-Lane: ${lane}\nPineta-Entry: e\n`),
  ).toEqual([])
})

describe("a card's place as flat fields (ADR-0059)", () => {
  const ADA = writerId("ada@example.com")
  const places: CardPlace[] = [
    {
      kind: "drafting",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: null,
    },
    {
      kind: "queued",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: laneNameForThread("x"),
      order: "a",
      by: ADA,
      seen: "v",
    },
    {
      kind: "pinned",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: laneNameForThread("x"),
      order: "b",
    },
    { kind: "fresh", column: "k", root: TEST_ROOT, at: ROOT },
    {
      kind: "fresh",
      column: "k",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
    },
    { kind: "inventory", holder: ADA },
  ]

  test("every place, and its key, round-trips", () => {
    for (const place of places) {
      expect(placeOfFields(placeFields(place))).toEqual(place)
      expect(keyOfFields(placeFields(keyOf(place)))).toEqual(keyOf(place))
    }
  })

  test("a pinned card needs its order; its key has none, and keeps its lane", () => {
    const pinned = places[2] as CardPlace
    const f = placeFields(pinned)
    expect(placeOfFields({ ...f, order: "" })).toBeUndefined()
    expect(keyOf(pinned)).toEqual({
      kind: "pinned",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: laneNameForThread("x"),
    })
  })

  test("sameKey leaves out the pinned cards' order, and tells pinned from drafting", () => {
    const pinned = keyOf(places[2] as CardPlace)
    expect(sameKey(pinned, keyOf({ ...(places[2] as CardPlace) }))).toBe(true)
    expect(
      pinned.kind === "pinned" &&
        sameKey(pinned, { ...pinned, kind: "drafting" }),
    ).toBe(false)
  })

  test("a fresh card needs its root", () => {
    const f = placeFields({
      kind: "fresh",
      column: "k",
      root: TEST_ROOT,
      at: ROOT,
    })
    expect(placeOfFields({ ...f, root: "" })).toBeUndefined()
  })

  test("an inventory needs its holder", () => {
    const f = placeFields({ kind: "inventory", holder: ADA })
    expect(placeOfFields({ ...f, holder: "" })).toBeUndefined()
    expect(keyOfFields({ ...f, holder: "" })).toBeUndefined()
  })

  test("sameKey tells two holders apart", () => {
    const bea = writerId("bea@example.com")
    expect(
      sameKey(
        { kind: "inventory", holder: ADA },
        { kind: "inventory", holder: ADA },
      ),
    ).toBe(true)
    expect(
      sameKey(
        { kind: "inventory", holder: ADA },
        { kind: "inventory", holder: bea },
      ),
    ).toBe(false)
    expect(
      sameKey(
        { kind: "inventory", holder: ADA },
        { kind: "fresh", column: "k", root: TEST_ROOT, at: ROOT },
      ),
    ).toBe(false)
  })

  test("sameKey leaves out a queue's root and text version", () => {
    const queued = keyOf(places[1] as CardPlace)
    expect(
      queued.kind === "queued" &&
        sameKey(queued, { ...queued, seen: "", root: rootIdFor("other") }),
    ).toBe(true)
  })
})

describe("moves, built once (ADR-0059)", () => {
  const ADA = writerId("ada@example.com")
  const LANE = laneNameForThread("x")
  const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const at = atEntry(entryId("e-1"))
  const card = (place: CardPlace): CardRecord => ({
    id: cardId("c-1"),
    owner: ADA,
    place,
    placer: ADA,
    command: null,
    unsent: null,
  })
  const drafting = card({ kind: "drafting", root: TEST_ROOT, at, lane: LANE })
  const lanes = (
    root: typeof TEST_ROOT,
  ): ReadonlyMap<typeof LANE, LaneRecord> =>
    new Map([[LANE, { lane: LANE, root, work: null, by: ADA, createdAt: 0 }]])

  test("a move goes from where the card is", () => {
    expect(moveOf(drafting, null)).toEqual({
      card: cardId("c-1"),
      from: { kind: "drafting", root: TEST_ROOT, at, lane: LANE },
      to: null,
    })
  })

  test("an unqueue puts a card back where it was queued, in its root", () => {
    expect(
      draftingOf({
        kind: "queued",
        root: OTHER,
        at,
        lane: LANE,
        order: "a",
        by: ADA,
        seen: "v",
      }),
    ).toEqual({ kind: "drafting", root: OTHER, at, lane: LANE })
  })

  test("a queued card's root is its lane's, else its own; a card at no thread has none", () => {
    expect(queueRoot(LANE, drafting, lanes(OTHER))).toBe(OTHER)
    expect(queueRoot(LANE, drafting, new Map())).toBe(TEST_ROOT)
    expect(
      queueRoot(LANE, card({ kind: "inventory", holder: ADA }), new Map()),
    ).toBeUndefined()
  })
})
