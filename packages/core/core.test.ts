// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  address,
  asPlaceFields,
  atEntry,
  type CardId,
  type CardPlace,
  type CardRecord,
  type ChatAt,
  cardIdOfKind,
  DISCARDED,
  emailLocalPart,
  entryId,
  findSeqKeys,
  fitsPlace,
  handleOf,
  historyScope,
  indexTree,
  keyFieldsFrom,
  keyFieldsOf,
  keyOf,
  keyOfFields,
  kindOfCard,
  latestTip,
  livePlaceOf,
  type MoveTarget,
  messageText,
  moveOf,
  movesDocId,
  movesOfDocId,
  NO_CONTENT,
  NOBODY,
  type NotesTarget,
  nonEmpty,
  normalizeEmail,
  normalizeName,
  noteOf,
  ownerOf,
  PERSON_HISTORY,
  parseCardId,
  parseMentions,
  parseNewThread,
  parseTextCardId,
  parseTitle,
  pinnedOf,
  placed,
  placeFields,
  placeOfFields,
  projectTranscript,
  rootIdFor,
  rowFieldsOf,
  sameKey,
  seenAt,
  shellWord,
  type TextCard,
  type TextPlace,
  THE_AGENT,
  type ThreadId,
  type ThreadName,
  targetOfFields,
  taskIdFor,
  threadIdFor,
  writerId,
  writerOfPrincipal,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { cardIdFor } from "./fixtures.ts"

const _TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const TEST_THREAD = threadIdFor("e")
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

describe("who a principal is", () => {
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

test("parseNewThread: only t- and a lowercase uuidv7, since a container is named after it", () => {
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

test("findSeqKeys: seq must not ride the wire", () => {
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

describe("parseMentions: no mention inside code", () => {
  const names = (t: string) =>
    parseMentions(t).map(m => (m.kind === "agent" ? "agent" : m.name))
  test("an inline code span, of one backtick or several, is text", () => {
    expect(names("ping `@amber-fox` and @ada")).toEqual(["ada"])
    expect(names("``a `@x` b`` @bea")).toEqual(["bea"])
    expect(names("`@agent` is how you ask")).toEqual([])
  })
  test("a fenced block, closed or running to the end, is text", () => {
    expect(names("```\n@ada\n```\n@bea")).toEqual(["bea"])
    expect(names("~~~ts\n@ada\n")).toEqual([])
  })
  test("an unclosed backtick, and an indented block, are not code here", () => {
    expect(names("an unclosed `@ada")).toEqual(["ada"])
    expect(names("    @ada indented")).toEqual(["ada"])
  })
})

describe("address: other threads' agents are invited, then asked", () => {
  const fox = threadIdFor("01a00000-0000-7000-8000-00000000f0c5")
  const owl = threadIdFor("01a00000-0000-7000-8000-0000000000e1")
  const agents = (member: boolean) => [
    { thread: fox, name: "amber-fox" as ThreadName, member },
    { thread: owl, name: "slate-owl" as ThreadName, member: true },
  ]
  const to = (text: string, member: boolean, agentByDefault: boolean) =>
    address({
      mentions: parseMentions(text),
      participants: ["Ada", "amber-fox"],
      agents: agents(member),
      agentByDefault,
    })
  test("a first mention invites, and the message goes where it would have gone", () => {
    expect(to("please talk to @amber-fox", false, true)).toEqual({
      compels: { kind: "agent", agent: THE_AGENT },
      people: [],
      asks: [],
      invites: [fox],
    })
  })
  test("where it would go to nobody, the invited agents are asked", () => {
    expect(to("@amber-fox what do you think?", false, false)).toEqual({
      compels: NOBODY,
      people: [],
      asks: [fox],
      invites: [fox],
    })
  })
  test("a member's mention asks it, and leaves this thread's agent out", () => {
    expect(to("@amber-fox @slate-owl next?", true, true)).toEqual({
      compels: NOBODY,
      people: [],
      asks: [fox, owl],
      invites: [],
    })
  })
  test("a person named only beside an invite keeps it from being asked", () => {
    expect(to("@ada meet @amber-fox", false, false)).toEqual({
      compels: NOBODY,
      people: ["Ada"],
      asks: [],
      invites: [fox],
    })
  })
  test("@agent beside a member asks both", () => {
    const both = to("@agent @slate-owl both of you", true, false)
    expect(both.compels.kind).toBe("agent")
    expect(both.asks).toEqual([owl])
  })
})

describe("address: mentions pick who a message is for", () => {
  const who = (text: string, agentByDefault: boolean) =>
    address({
      mentions: parseMentions(text),
      participants: ["Ada Lovelace", "O'Brien", "guest-x4bu"],
      agents: [],
      agentByDefault,
    })
  test("@agent asks the agent, with or without people", () => {
    expect(who("@agent go", false).compels.kind).toBe("agent")
    expect(who("@agent @adalovelace go", false)).toEqual({
      compels: { kind: "agent", agent: THE_AGENT },
      people: ["Ada Lovelace"],
      asks: [],
      invites: [],
    })
  })
  test("@Ada alone in agent work is for Ada only", () => {
    expect(who("@AdaLovelace look", true)).toEqual({
      compels: NOBODY,
      people: ["Ada Lovelace"],
      asks: [],
      invites: [],
    })
  })
  test("an unknown handle is ignored: the thread's default stands", () => {
    expect(who("bump @types/node please", true).compels.kind).toBe("agent")
    expect(who("bump @types/node please", false).compels).toEqual(NOBODY)
  })
  test("only @agent as typed names the agent; @Agent names nobody", () => {
    expect(who("@Agent look", false).compels).toEqual(NOBODY)
  })
  test("of two people with one handle, the later in the list is named", () => {
    const people = (participants: string[]) =>
      address({
        mentions: parseMentions("@bea look"),
        participants,
        agents: [],
        agentByDefault: false,
      }).people
    expect(people(["B.ea", "Bea"])).toEqual(["Bea"])
  })
  test("a bare @, or one after another, is no mention", () => {
    expect(parseMentions("@ and @@ada")).toEqual([])
  })
  test("no mention: the default, either way", () => {
    expect(who("hi", true).compels.kind).toBe("agent")
    expect(who("hi", false).compels).toEqual(NOBODY)
  })
  test("a handle is a name in any script: @日本, @josé, however José was typed", () => {
    const people = address({
      mentions: parseMentions("@日本 @josé look"),
      participants: ["日本", "Jose\u0301"],
      agents: [],
      agentByDefault: true,
    })
    expect(people).toEqual({
      compels: NOBODY,
      people: ["日本", "Jose\u0301"],
      asks: [],
      invites: [],
    })
  })
  test("normalizeName refuses a name no mention could reach", () => {
    expect(normalizeName("  Ada ")).toBe("Ada")
    expect(normalizeName("!!")).toBeUndefined()
    expect(normalizeName("Agent")).toBeUndefined()
    expect(normalizeName("")).toBeUndefined()
  })
  test("normalizeName refuses a thread's name, which a mention reads as its agent", () => {
    expect(normalizeName("Amber-Fox")).toBeUndefined()
    expect(normalizeName("amber fox")).toBe("amber fox")
    expect(normalizeName("Mary-Jane")).toBe("Mary-Jane")
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

describe("a card's place as flat fields", () => {
  const ADA = writerId("ada@example.com")
  const places: CardPlace[] = [
    { kind: "note", column: NOTES, order: "c" },
    {
      kind: "queued",
      thread: threadIdFor("x"),
      order: "a",
      by: ADA,
      seen: "v",
    },
    {
      kind: "pinned",
      thread: threadIdFor("x"),
      order: "b",
    },
    { kind: "inventory", holder: ADA },
    {
      kind: "trash",
      left: { kind: "canvas", task: TEST_TASK, order: "m", width: 2 },
    },
    { kind: "trash", left: { kind: "inventory", holder: ADA } },
  ]

  test("every place, and its key, round-trips", () => {
    for (const place of places) {
      expect(placeOfFields(placeFields(place))).toEqual(place)
      expect(keyOfFields(placeFields(keyOf(place)))).toEqual(keyOf(place))
    }
  })

  test("a margin place round-trips, and needs its entry, its thread and its order", () => {
    const margin = {
      kind: "margin",
      entry: entryId("e-1"),
      thread: threadIdFor("x"),
      order: "c",
    } as const
    const f = placeFields(margin)
    expect(f).toMatchObject({ kind: "margin", at: "e-1", order: "c" })
    expect(placeOfFields(f)).toEqual(margin)
    expect(placeOfFields({ ...f, at: "" })).toBeUndefined()
    expect(placeOfFields({ ...f, lane: "" })).toBeUndefined()
    expect(placeOfFields({ ...f, order: "" })).toBeUndefined()
    expect(keyOf(margin)).toEqual({
      kind: "margin",
      entry: entryId("e-1"),
      thread: threadIdFor("x"),
    })
    expect(keyOfFields(keyFieldsFrom(k => f[k]))).toEqual(keyOf(margin))
    expect(rowFieldsOf("margin")).toEqual(["at", "lane", "order"])
  })

  test("a pinned card needs its order and its thread; its key has no order, and keeps its thread", () => {
    const pinned = places[2] as CardPlace
    const f = placeFields(pinned)
    expect(placeOfFields({ ...f, order: "" })).toBeUndefined()
    expect(placeOfFields({ ...f, lane: "" })).toBeUndefined()
    expect(keyOf(pinned)).toEqual({
      kind: "pinned",
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

  test("a key's fields on the wire are the table's: no width, no order, no task but a canvas's and a spot's, a task pin's or a task's notes", () => {
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
      kind: "trash",
      left: { kind: "canvas", task: TEST_TASK, order: "m", width: 1 },
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
    // A task's id is its card's, any `isTaskId` takes.
    expect(at(TEST_TASK)).toBe("task")
    expect(at(taskIdFor("x"))).toBe("task")
    expect(at(`n-${UUID}`)).toBe("note-column")
    expect(at(`m-${UUID}`)).toBe("media")
    expect(at(`f-${UUID}`)).toBe("file")
  })

  test("fitsPlace: a text card anywhere but a canvas, a thread's card on a canvas or in an inventory, a note column on a canvas, and each of them in a trash", () => {
    const fits = (kind: Parameters<typeof fitsPlace>[0]) =>
      (["note", "canvas", "inventory", "trash"] as const).filter(p =>
        fitsPlace(kind, p),
      )
    expect(fits("text")).toEqual(["note", "inventory", "trash"])
    expect(fits("thread")).toEqual(["canvas", "inventory", "trash"])
    expect(fits("note-column")).toEqual(["canvas", "trash"])
    expect(fits("media")).toEqual([])
  })

  test("placed: a card at a place its kind is ever in, and no record where it is never", () => {
    const by = writerId("ada@example.com")
    const canvas = {
      kind: "canvas",
      task: TEST_TASK,
      order: "m",
      width: 1,
    } as const
    const held = { kind: "inventory", holder: by } as const
    const column: CardRecord = {
      kind: "note-column",
      id: NOTES,
      owner: by,
      place: canvas,
      placer: by,
      content: NO_CONTENT,
    }
    const thread: CardRecord = {
      kind: "thread",
      id: TEST_THREAD,
      owner: by,
      place: canvas,
      placer: by,
      content: NO_CONTENT,
    }
    expect(placed(thread, held)?.place).toEqual(held)
    expect(placed(column, held)).toBeUndefined()
    expect(placed(column, { ...canvas, order: "n" })?.place).toMatchObject({
      order: "n",
    })
  })

  test("text that is no card's id parses as none", () => {
    for (const id of [
      "",
      "c-1",
      "n-1",
      "x-1",
      `y-${UUID}`,
      UUID.toUpperCase(),
      `${UUID}x`,
    ])
      expect(parseCardId(id)).toBeUndefined()
    expect(parseCardId(`x-${UUID}`)).toBe(`x-${UUID}`)
    expect(kindOfCard(`x-${UUID}` as CardId)).toBe("fact")
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
    expect(
      sameKey(note, { kind: "note", column: cardIdOfKind("note-column", "x") }),
    ).toBe(false)
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
    const notes = placeFields({
      kind: "notes",
      near: "thread",
      thread: TEST_THREAD,
    })
    expect(placeOfFields(notes)).toBeUndefined()
    expect(targetOfFields(keyFieldsFrom(k => notes[k]))).toEqual({
      kind: "notes",
      near: "thread",
      thread: TEST_THREAD,
    })
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
    expect(sameKey({ kind: "inventory", holder: ADA }, { kind: "trash" })).toBe(
      false,
    )
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

describe("moves, built once", () => {
  const ADA = writerId("ada@example.com")
  const LANE = threadIdFor("x")
  const _OTHER = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const _at = atEntry(entryId("e-1"))
  const card = (place: TextPlace): TextCard => ({
    kind: "text",
    id: cardIdFor("c1"),
    owner: ADA,
    place,
    placer: ADA,
    content: { command: null, unsent: null, origin: null },
  })
  const atEnd = card({ kind: "note", column: NOTES, order: "a" })
  test("a move goes from where the card is; a discard names no history: the host's to name", () => {
    expect(moveOf(atEnd, DISCARDED)).toEqual({
      card: cardIdFor("c1"),
      from: { kind: "note", column: NOTES },
      to: { kind: "trash" },
    })
  })

  test("a trashed card is stored as the place it left, its kind prefixed; an old trash row does not decode", () => {
    const left = { kind: "note", column: NOTES, order: "c" } as const
    const place = { kind: "trash", left } as const
    const fields = placeFields(place)
    expect(fields).toMatchObject({ kind: "discarded-note", column: NOTES })
    expect(placeOfFields(fields)).toEqual(place)
    expect(keyOfFields(fields)).toEqual({ kind: "trash" })
    expect(placeOfFields({ ...fields, column: "" })).toBeUndefined()
    expect(
      placeOfFields(asPlaceFields({ kind: "discarded", holder: ADA })),
    ).toBeUndefined()
    expect(keyOfFields(placeFields(DISCARDED))).toEqual(DISCARDED)
  })

  test("a surface's owner, and the live place of a trashed card", () => {
    const thread = threadIdFor("x")
    expect(ownerOf({ kind: "note", column: NOTES, order: "c" })).toEqual({
      kind: "note-column",
      column: NOTES,
    })
    expect(ownerOf({ kind: "composing", thread })).toEqual({
      kind: "thread",
      thread,
    })
    expect(
      ownerOf({ kind: "task-pinned", task: TEST_TASK, order: "a" }),
    ).toEqual({ kind: "task", task: TEST_TASK })
    expect(ownerOf({ kind: "inventory", holder: ADA })).toEqual({
      kind: "person",
      holder: ADA,
    })
    const left = { kind: "inventory", holder: ADA } as const
    expect(livePlaceOf({ kind: "trash", left })).toEqual(left)
  })

  test("seenAt: a note is where its sender saw it in its column, whatever its rank", () => {
    const now = { kind: "note", column: NOTES } as const
    expect(seenAt(now, now)).toBe(true)
    expect(
      seenAt(now, { kind: "note", column: cardIdOfKind("note-column", "x") }),
    ).toBe(false)
  })

  test("a thread's nearest notes are a move's target alone: read as a target, never as a key", () => {
    const notes = placeFields({
      kind: "notes",
      near: "thread",
      thread: TEST_THREAD,
    })
    expect(targetOfFields(notes)).toEqual({
      kind: "notes",
      near: "thread",
      thread: TEST_THREAD,
    })
    expect(keyOfFields(notes)).toBeUndefined()
    expect(
      targetOfFields(placeFields({ kind: "note", column: NOTES })),
    ).toEqual({
      kind: "note",
      column: NOTES,
    })
  })

  test("an unqueue sends a card to the note column nearest its thread, for the host to resolve", () => {
    expect(
      noteOf({
        kind: "queued",
        thread: LANE,
        order: "a",
        by: ADA,
        seen: "v",
      }),
    ).toEqual({ kind: "notes", near: "thread", thread: LANE })
  })

  test("a pin pins your message or a queued card at the same thread end; a note is at no thread", () => {
    const pinned = { kind: "pinned", thread: LANE }
    expect(pinnedOf({ kind: "composing", thread: LANE })).toEqual(pinned)
    expect(pinnedOf({ kind: "note", column: NOTES })).toBeNull()
    expect(
      pinnedOf({
        kind: "queued",
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

describe("threads, by construction", () => {
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

test("every place writes only the fields its kind's row stores (`ROWS`)", () => {
  const thread = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")
  const task = taskIdFor("01a0ffd2-0000-7000-8000-0000000000ab")
  const places: readonly (CardPlace | MoveTarget)[] = [
    { kind: "composing", thread },
    { kind: "pinned", thread, order: "a" },
    {
      kind: "queued",
      thread,
      order: "a",
      by: writerId("a@x.io"),
      seen: "v",
    },
    { kind: "canvas", task, order: "a", width: 2 },
    { kind: "canvas-at", task, after: thread },
    { kind: "task-pinned", task, order: "a" },
    { kind: "notes", near: "thread", thread },
    { kind: "notes", near: "task", task },
    { kind: "inventory", holder: writerId("a@x.io") },
    { kind: "trash", left: { kind: "canvas", task, order: "a", width: 1 } },
  ]
  for (const place of places) {
    const { kind, ...fields } = placeFields(place)
    const written = Object.entries(fields)
      .filter(([, v]) => v !== "")
      .map(([f]) => f)
    expect(written.every(f => rowFieldsOf(kind)?.includes(f))).toBe(true)
  }
  expect(rowFieldsOf("canvas-at")).toEqual(["task", "column"])
  expect(rowFieldsOf("nowhere")).toBeUndefined()
})

test("a notes target says by its tag which notes it is near, a thread's or a task's", () => {
  const thread = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")
  const task = taskIdFor("01a0ffd2-0000-7000-8000-0000000000ab")
  // @ts-expect-error: near a thread, it names the thread
  const wrong: NotesTarget = { kind: "notes", near: "thread", task }
  // @ts-expect-error: untagged, it is neither
  const bare: NotesTarget = { kind: "notes", thread }
  const near: NotesTarget = { kind: "notes", near: "thread", thread }
  expect([wrong.near, bare.kind, near.near]).toEqual([
    "thread",
    "notes",
    "thread",
  ])
  expect(
    targetOfFields(placeFields({ kind: "notes", near: "task", task })),
  ).toEqual({ kind: "notes", near: "task", task })
})

const UUID = "01a0ffd2-0000-7000-8000-00000000000a"
const NOTES = cardIdOfKind("note-column", UUID)

describe("a history of moves' document", () => {
  const ADA_W = writerId("ada@x.io")
  test("a task's and a person's outside any task read back as written; other ids name none", () => {
    for (const scope of [historyScope(TEST_TASK), PERSON_HISTORY])
      expect(movesOfDocId(movesDocId(ADA_W, scope))).toEqual({
        writer: ADA_W,
        scope,
      })
    expect(movesOfDocId(`moves:${ADA_W}:r-x`)).toBeUndefined()
    expect(movesOfDocId("root:r-x")).toBeUndefined()
  })
})
