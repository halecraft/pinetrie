// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  address,
  atEntry,
  type CardPlace,
  type CardRecord,
  type ChatAt,
  cardId,
  discardedOf,
  emailLocalPart,
  entryId,
  findSeqKeys,
  handleOf,
  indexTree,
  keyOf,
  keyOfFields,
  type LaneRecord,
  latestTip,
  messageText,
  moveOf,
  NOBODY,
  nonEmpty,
  normalizeEmail,
  normalizeName,
  noteOf,
  parseMentions,
  parseNewThread,
  parseTitle,
  pinnedOf,
  placeFields,
  placeOfFields,
  projectTranscript,
  queueRoot,
  ROOT,
  rootIdFor,
  sameKey,
  seenAt,
  shellWord,
  THE_AGENT,
  type ThreadId,
  threadIdFor,
  writerId,
  writerOfPrincipal,
} from "@pinetrie/core"
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
    expect(writerOfPrincipal("pinetrie-host")).toBeUndefined()
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

test("writerId and threadIdFor: a person and a thread are never confused", () => {
  assert.equal(writerId("abc"), "w-abc")
  assert.throws(() => writerId(""), /non-empty/)
  assert.throws(() => writerId("a\u0000b"), /u0000/)
  // Different prefixes: a writer's id can never name a thread's lane.
  assert.equal(threadIdFor("abc"), "t-abc")
  assert.notEqual(String(threadIdFor("abc")), String(writerId("abc")))
})

test("parseNewThread: only t- and a lowercase uuidv7, since a container is named after it (ADR-0057)", () => {
  const ok = "t-01a0f9eb-86e1-77ad-a822-2a306786223f"
  assert.equal(parseNewThread(ok), ok)
  for (const bad of [
    "t-abc",
    ok.toUpperCase(),
    "t-01a0f9eb-86e1-47ad-a822-2a306786223f",
    "t-01a0f9eb-86e1-77ad-c822-2a306786223f",
    `${ok};rm -rf`,
    ` ${ok}`,
  ])
    assert.equal(parseNewThread(bad), undefined, bad)
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

describe("a card's place as flat fields (ADR-0059)", () => {
  const ADA = writerId("ada@example.com")
  const places: CardPlace[] = [
    {
      kind: "note",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: null,
      cell: 0,
    },
    {
      kind: "queued",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: threadIdFor("x"),
      order: "a",
      by: ADA,
      seen: "v",
    },
    {
      kind: "pinned",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: threadIdFor("x"),
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
      lane: threadIdFor("x"),
    })
  })

  test("sameKey leaves out the pinned cards' order, and tells pinned from a note", () => {
    const pinned = keyOf(places[2] as CardPlace)
    expect(sameKey(pinned, keyOf({ ...(places[2] as CardPlace) }))).toBe(true)
    expect(
      pinned.kind === "pinned" &&
        sameKey(pinned, { ...pinned, kind: "note", cell: 0 }),
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
  const LANE = threadIdFor("x")
  const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const at = atEntry(entryId("e-1"))
  const card = (place: CardPlace): CardRecord => ({
    id: cardId("c-1"),
    owner: ADA,
    place,
    placer: ADA,
    carries: { kind: "message", command: null },
    unsent: null,
  })
  const atEnd = card({ kind: "note", root: TEST_ROOT, at, lane: LANE, cell: 0 })
  const lanes = (
    root: typeof TEST_ROOT,
  ): ReadonlyMap<typeof LANE, LaneRecord> =>
    new Map([
      [LANE, { lane: LANE, root, ownCopy: false, by: ADA, createdAt: 0 }],
    ])

  test("a move goes from where the card is; a discard is gone in its root, or the one you are on", () => {
    const gone = discardedOf(atEnd.place, OTHER)
    expect(moveOf(atEnd, gone)).toEqual({
      card: cardId("c-1"),
      from: { kind: "note", root: TEST_ROOT, at, lane: LANE, cell: 0 },
      to: { kind: "gone", root: TEST_ROOT, why: { kind: "discarded" } },
    })
    expect(discardedOf({ kind: "inventory", holder: ADA }, OTHER)).toEqual({
      kind: "gone",
      root: OTHER,
      why: { kind: "discarded" },
    })
    expect(discardedOf({ kind: "inventory", holder: ADA }, null)).toMatchObject(
      { root: null },
    )
  })

  test("a gone place is stored under its reason, with who discarded it", () => {
    const place = {
      kind: "gone",
      root: TEST_ROOT,
      by: ADA,
      why: { kind: "discarded" },
    } as const
    const fields = placeFields(place)
    expect(fields).toMatchObject({ kind: "discarded", holder: ADA })
    expect(placeOfFields(fields)).toEqual(place)
    expect(keyOfFields({ ...fields, holder: "" })).toEqual(keyOf(place))
    expect(placeOfFields({ ...fields, root: "" })).toMatchObject({ root: null })
    expect(placeOfFields({ ...fields, holder: "" })).toBeUndefined()
    expect(
      sameKey(keyOf(place), { kind: "gone", root: OTHER, why: place.why }),
    ).toBe(false)
  })

  test("seenAt: a note seen with no cell is anywhere on its board; one seen in a cell is where it is only in that cell", () => {
    const note = {
      kind: "note",
      root: TEST_ROOT,
      at: atEntry(entryId("e-1")),
      lane: null,
    } as const
    const now = { ...note, cell: 3 }
    expect(seenAt(now, { ...note, cell: null })).toBe(true)
    expect(seenAt(now, { ...note, cell: 3 })).toBe(true)
    expect(seenAt(now, { ...note, cell: 2 })).toBe(false)
    expect(
      seenAt(now, { ...note, at: atEntry(entryId("e-2")), cell: null }),
    ).toBe(false)
  })

  test("a spun card is stored as spun, its root in its column and its thread in its lane; a spun place with neither is malformed", () => {
    const thread = threadIdFor("spun")
    const place = {
      kind: "gone",
      root: TEST_ROOT,
      by: ADA,
      why: { kind: "spun", into: OTHER, thread },
    } as const
    const fields = placeFields(place)
    expect(fields).toMatchObject({
      kind: "spun",
      column: OTHER,
      lane: thread,
      holder: ADA,
    })
    expect(placeOfFields(fields)).toEqual(place)
    expect(keyOfFields({ ...fields, holder: "" })).toEqual(keyOf(place))
    expect(placeOfFields({ ...fields, column: "" })).toBeUndefined()
    expect(placeOfFields({ ...fields, lane: "" })).toBeUndefined()
    expect(
      sameKey(keyOf(place), {
        kind: "gone",
        root: TEST_ROOT,
        why: { kind: "spun", into: TEST_ROOT, thread },
      }),
    ).toBe(false)
  })

  test("an unqueue puts a card back where it was queued, in its root", () => {
    expect(
      noteOf({
        kind: "queued",
        root: OTHER,
        at,
        lane: LANE,
        order: "a",
        by: ADA,
        seen: "v",
      }),
    ).toEqual({ kind: "note", root: OTHER, at, lane: LANE, cell: null })
  })

  test("a pin pins a card below the line or queued, at the same thread end", () => {
    const pinned = { kind: "pinned", root: OTHER, at, lane: LANE }
    expect(
      pinnedOf({ kind: "note", root: OTHER, at, lane: LANE, cell: 0 }),
    ).toEqual(pinned)
    expect(
      pinnedOf({
        kind: "queued",
        root: OTHER,
        at,
        lane: LANE,
        order: "a",
        by: ADA,
        seen: "v",
      }),
    ).toEqual(pinned)
    expect(pinnedOf({ kind: "inventory", holder: ADA })).toBeNull()
  })

  test("a queued card's root is its lane's, else its own; a card at no thread has none", () => {
    expect(queueRoot(LANE, atEnd, lanes(OTHER))).toBe(OTHER)
    expect(queueRoot(LANE, atEnd, new Map())).toBe(TEST_ROOT)
    const pinned = card({
      kind: "pinned",
      root: OTHER,
      at,
      lane: LANE,
      order: "a",
    })
    expect(queueRoot(LANE, pinned, new Map())).toBe(OTHER)
    expect(
      queueRoot(LANE, card({ kind: "inventory", holder: ADA }), new Map()),
    ).toBeUndefined()
  })
})

test("nonEmpty: a list with one element or more, or null", () => {
  expect(nonEmpty([])).toBeNull()
  expect(nonEmpty(["a", "b"])).toEqual(["a", "b"])
})

describe("threads, by construction (ADR-0117)", () => {
  test("a thread's id is no bare string, and a branch names the thread it starts", () => {
    // @ts-expect-error: a lane is named by a thread's id, never a string
    const lane: ThreadId = "t-x"
    // @ts-expect-error: a branch without the thread its column minted
    const branch: ChatAt = { kind: "branch", at: null }
    // @ts-expect-error: a send at an end names its thread
    const end: ChatAt = { kind: "end", seen: entryId("e-1") }
    expect([lane, branch.kind, end.kind]).toEqual(["t-x", "branch", "end"])
  })
})
