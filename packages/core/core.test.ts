// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  address,
  atEntry,
  type CardPlace,
  type CardRecord,
  type ChatAt,
  DISCARDED,
  emailLocalPart,
  entryId,
  findSeqKeys,
  fitsPlace,
  handleOf,
  indexTree,
  keyFieldsFrom,
  keyFieldsOf,
  keyOf,
  keyOfFields,
  kindOfCard,
  latestTip,
  messageText,
  moveOf,
  NOBODY,
  nonEmpty,
  normalizeEmail,
  normalizeName,
  noteColumnIdFor,
  noteOf,
  parseCardId,
  parseMentions,
  parseNewThread,
  parseTextCardId,
  parseTitle,
  pinnedOf,
  placeFields,
  placeOfFields,
  projectTranscript,
  ROOT,
  rootIdFor,
  sameKey,
  seenAt,
  shellWord,
  type TextPlace,
  THE_AGENT,
  type ThreadId,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
  writerOfPrincipal,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TEST_THREAD = threadIdFor("e")
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

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
    latestTip([
      entryId("b-2"),
      null,
      entryId("c0000000-0000-7000-8000-000000000003"),
      entryId("a-1"),
    ]),
    "c0000000-0000-7000-8000-000000000003",
  )
  assert.equal(
    latestTip([
      entryId("c0000000-0000-7000-8000-000000000003"),
      entryId("a-1"),
      entryId("b-2"),
    ]),
    "c0000000-0000-7000-8000-000000000003",
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
    { kind: "note", column: NOTES, order: "c" },
    {
      kind: "queued",
      at: atEntry(entryId("e-1")),
      thread: threadIdFor("x"),
      order: "a",
      by: ADA,
      seen: "v",
    },
    {
      kind: "pinned",
      at: atEntry(entryId("e-1")),
      thread: threadIdFor("x"),
      order: "b",
    },
    { kind: "fresh", column: "k", root: TEST_ROOT, task: TEST_TASK, at: ROOT },
    {
      kind: "fresh",
      column: "k",
      root: TEST_ROOT,
      task: TEST_TASK,
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

  test("a pinned card needs its order and its thread; its key has no order, and keeps its thread", () => {
    const pinned = places[2] as CardPlace
    const f = placeFields(pinned)
    expect(placeOfFields({ ...f, order: "" })).toBeUndefined()
    expect(placeOfFields({ ...f, lane: "" })).toBeUndefined()
    expect(keyOf(pinned)).toEqual({
      kind: "pinned",
      at: atEntry(entryId("e-1")),
      thread: threadIdFor("x"),
    })
  })

  test("a canvas card needs its task, its order and its width; its key is its task", () => {
    const canvas = {
      kind: "canvas",
      task: TEST_TASK,
      order: "m",
      width: 2,
    } as const
    const f = placeFields(canvas)
    expect(f).toMatchObject({ kind: "canvas", task: TEST_TASK, width: "2" })
    expect(placeOfFields(f)).toEqual(canvas)
    expect(placeOfFields({ ...f, width: "3" })).toBeUndefined()
    expect(placeOfFields({ ...f, task: "r-x" })).toBeUndefined()
    expect(keyOf(canvas)).toEqual({ kind: "canvas", task: TEST_TASK })
    expect(keyOfFields(keyFieldsFrom(k => f[k]))).toEqual(keyOf(canvas))
  })

  test("a key's fields on the wire are the table's: no width, no order, no task but a canvas's and a fresh one's", () => {
    const f = placeFields({
      kind: "canvas",
      task: TEST_TASK,
      order: "m",
      width: 2,
    })
    expect(keyFieldsOf(f)).not.toHaveProperty("width")
    expect(keyFieldsOf(f)).not.toHaveProperty("order")
    expect(keyFieldsOf(f)).toHaveProperty("task", TEST_TASK)
    const note = placeFields({ kind: "note", column: NOTES, order: "m" })
    expect(keyFieldsOf(note)).not.toHaveProperty("order")
    expect(keyFieldsOf(note)).toHaveProperty("column", NOTES)
    const gone = placeFields({
      kind: "gone",
      task: TEST_TASK,
      by: writerId("ada@example.com"),
      why: { kind: "discarded" },
    })
    expect(keyFieldsOf(gone)).not.toHaveProperty("task")
  })

  test("a card's kind is its id's prefix: a bare uuidv7 is a text card", () => {
    const at = (id: string) => {
      const card = parseCardId(id)
      return card === undefined ? undefined : kindOfCard(card)
    }
    expect(at(UUID)).toBe("text")
    expect(at(threadIdFor("x"))).toBe("thread")
    expect(at(`n-${UUID}`)).toBe("note-column")
    expect(at(`m-${UUID}`)).toBe("media")
    expect(at(`f-${UUID}`)).toBe("file")
  })

  test("fitsPlace: a text card anywhere but a canvas, a thread's card on a canvas or in an inventory, a note column on a canvas alone", () => {
    const fits = (kind: Parameters<typeof fitsPlace>[0]) =>
      (["note", "canvas", "inventory"] as const).filter(p => fitsPlace(kind, p))
    expect(fits("text")).toEqual(["note", "inventory"])
    expect(fits("thread")).toEqual(["canvas", "inventory"])
    expect(fits("note-column")).toEqual(["canvas"])
    expect(fits("media")).toEqual([])
  })

  test("text that is no card's id parses as none", () => {
    for (const id of [
      "",
      "c-1",
      "n-1",
      `x-${UUID}`,
      UUID.toUpperCase(),
      `${UUID}x`,
    ])
      expect(parseCardId(id)).toBeUndefined()
    expect(parseTextCardId(`n-${UUID}`)).toBeUndefined()
    expect(parseTextCardId(UUID)).toBe(UUID)
  })

  test("sameKey leaves out the pinned cards' and a note's order, and tells two note columns apart", () => {
    const pinned = keyOf(places[2] as CardPlace)
    expect(sameKey(pinned, keyOf({ ...(places[2] as CardPlace) }))).toBe(true)
    const note = keyOf({ kind: "note", column: NOTES, order: "a" })
    expect(
      sameKey(note, keyOf({ kind: "note", column: NOTES, order: "z" })),
    ).toBe(true)
    expect(sameKey(note, { kind: "note", column: noteColumnIdFor("x") })).toBe(
      false,
    )
  })

  test("a note needs its column and its order; the nearest notes are a target, never a stored place", () => {
    const f = placeFields({ kind: "note", column: NOTES, order: "m" })
    expect(f).toMatchObject({
      kind: "note",
      column: NOTES,
      order: "m",
      lane: "",
    })
    expect(placeOfFields({ ...f, order: "" })).toBeUndefined()
    expect(placeOfFields({ ...f, column: "t-x" })).toBeUndefined()
    const notes = placeFields({ kind: "notes", thread: TEST_THREAD })
    expect(placeOfFields(notes)).toBeUndefined()
    expect(keyOfFields(keyFieldsFrom(k => notes[k]))).toEqual({
      kind: "notes",
      thread: TEST_THREAD,
    })
  })

  test("a fresh card needs its root", () => {
    const f = placeFields({
      kind: "fresh",
      column: "k",
      root: TEST_ROOT,
      task: TEST_TASK,
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
        {
          kind: "fresh",
          column: "k",
          root: TEST_ROOT,
          task: TEST_TASK,
          at: ROOT,
        },
      ),
    ).toBe(false)
  })

  test("sameKey leaves out a queue's text version, not its thread", () => {
    const queued = keyOf(places[1] as CardPlace)
    expect(
      queued.kind === "queued" && sameKey(queued, { ...queued, seen: "" }),
    ).toBe(true)
    expect(
      queued.kind === "queued" &&
        sameKey(queued, { ...queued, thread: threadIdFor("other") }),
    ).toBe(false)
  })
})

describe("moves, built once (ADR-0059)", () => {
  const ADA = writerId("ada@example.com")
  const LANE = threadIdFor("x")
  const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const at = atEntry(entryId("e-1"))
  const card = (place: TextPlace): CardRecord => ({
    kind: "text",
    id: textCardId("c0000000-0000-7000-8000-000000000001"),
    owner: ADA,
    place,
    placer: ADA,
    carries: { kind: "message", command: null },
    unsent: null,
  })
  const atEnd = card({ kind: "note", column: NOTES, order: "a" })
  test("a move goes from where the card is; a discard names no history: the host's to name", () => {
    expect(moveOf(atEnd, DISCARDED)).toEqual({
      card: textCardId("c0000000-0000-7000-8000-000000000001"),
      from: { kind: "note", column: NOTES },
      to: { kind: "gone", why: { kind: "discarded" } },
    })
  })

  test("a gone place is stored under its reason, with who discarded it", () => {
    const place = {
      kind: "gone",
      task: TEST_TASK,
      by: ADA,
      why: { kind: "discarded" },
    } as const
    const fields = placeFields(place)
    expect(fields).toMatchObject({ kind: "discarded", holder: ADA })
    expect(placeOfFields(fields)).toEqual(place)
    expect(keyOfFields({ ...fields, holder: "" })).toEqual(keyOf(place))
    expect(placeOfFields({ ...fields, task: "" })).toMatchObject({ task: null })
    expect(placeOfFields({ ...fields, holder: "" })).toBeUndefined()
    expect(keyOfFields(fields)).toEqual({ kind: "gone", why: place.why })
  })

  test("seenAt: a card seen on its way to a thread's nearest notes is in whichever note column the host chose; else where it is", () => {
    const now = { kind: "note", column: NOTES } as const
    expect(seenAt(now, { kind: "notes", thread: TEST_THREAD })).toBe(true)
    expect(seenAt(now, now)).toBe(true)
    expect(seenAt(now, { kind: "note", column: noteColumnIdFor("x") })).toBe(
      false,
    )
    expect(
      seenAt(
        { kind: "inventory", holder: ADA },
        { kind: "notes", thread: TEST_THREAD },
      ),
    ).toBe(false)
  })

  test("a spun card is stored as spun, its root in its column and its thread in its lane; a spun place with neither is malformed", () => {
    const thread = threadIdFor("spun")
    const place = {
      kind: "gone",
      task: TEST_TASK,
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
        why: { kind: "spun", into: TEST_ROOT, thread },
      }),
    ).toBe(false)
  })

  test("an unqueue sends a card to the note column nearest its thread, for the host to resolve", () => {
    expect(
      noteOf({
        kind: "queued",
        at,
        thread: LANE,
        order: "a",
        by: ADA,
        seen: "v",
      }),
    ).toEqual({ kind: "notes", thread: LANE })
  })

  test("a pin pins your message or a queued card at the same thread end; a note is at no thread", () => {
    const pinned = { kind: "pinned", at, thread: LANE }
    expect(pinnedOf({ kind: "composing", at, thread: LANE })).toEqual(pinned)
    expect(pinnedOf({ kind: "note", column: NOTES })).toBeNull()
    expect(
      pinnedOf({
        kind: "queued",
        at,
        thread: LANE,
        order: "a",
        by: ADA,
        seen: "v",
      }),
    ).toEqual(pinned)
    expect(pinnedOf({ kind: "inventory", holder: ADA })).toBeNull()
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

const UUID = "01a0ffd2-0000-7000-8000-00000000000a"
const NOTES = noteColumnIdFor(UUID)
