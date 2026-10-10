import { describe, expect, test } from "vitest"
import { entriesOf, entry } from "./fixtures.ts"
import {
  type EntryLike,
  entryId,
  heardFrom,
  indexTree,
  invitedAt,
  membersOf,
  roundOf,
  type TreeIndex,
  threadIdFor,
  writerId,
} from "./index.ts"

type Message = NonNullable<EntryLike["message"]>
const fox = threadIdFor("fox")
const owl = threadIdFor("owl")
const here = threadIdFor("here")
const ada = writerId("ada@example.com")
const build = (rows: readonly EntryLike[]): TreeIndex =>
  indexTree(entriesOf(rows))
const chat = (extra: Partial<Message> = {}): Message => ({
  role: "chat",
  content: "hi",
  ...extra,
})
const said = (text: string): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const answer = (from: typeof fox, source: string): Message => ({
  role: "answer",
  content: "answered",
  answer: {
    from,
    fromName: "x",
    relay: entryId("r"),
    source: entryId(source),
    text: "answered",
    wakes: false,
    budget: entryId("m"),
    by: ada,
  },
})

describe("membersOf (ADR-0128)", () => {
  const index = build([
    entry("1", null, chat({ invites: [fox] })),
    entry("2", "1", chat({ invites: [owl, fox] })),
    entry("3", "2", { role: "fact", content: "", member: { gone: fox } }),
    entry("b", "1", said("a branch before owl was invited")),
  ])
  test("invites add, in the order invited, and a fact removes", () => {
    expect(membersOf(index, entryId("2"))).toEqual([fox, owl])
    expect(membersOf(index, entryId("3"))).toEqual([owl])
  })
  test("a branch has the members its thread had where it forked", () => {
    expect(membersOf(index, entryId("b"))).toEqual([fox])
  })
  test("where each was invited: the newest invite on the path", () => {
    expect(invitedAt(index, entryId("3"), fox)).toBe("2")
    expect(invitedAt(index, entryId("b"), owl)).toBeNull()
  })
})

describe("heardFrom (ADR-0128)", () => {
  const heard = (from: typeof fox, entries: string[]): Message => ({
    role: "heard",
    content: "",
    heard: { from, fromName: "x", entries: entries.map(entryId) },
  })
  const index = build([
    entry("1", null, heard(here, ["a", "b"])),
    entry("2", "1", heard(owl, ["z"])),
    entry("3", "2", said("ok")),
    {
      id: entryId("c"),
      parentId: entryId("3"),
      type: "compaction",
      thread: fox,
    },
    entry("4", "c", said("after")),
  ])
  test("the newest heard entry from that thread, its last source entry", () => {
    expect(heardFrom(index, entryId("3"), here)).toBe("b")
    expect(heardFrom(index, entryId("3"), owl)).toBe("z")
    expect(heardFrom(index, entryId("3"), fox)).toBeNull()
  })
  test("past a compaction, nothing heard: the next ask copies it again", () => {
    expect(heardFrom(index, entryId("4"), here)).toBeNull()
  })
})

describe("roundOf (ADR-0128)", () => {
  const index = build([
    entry("q", null, chat({ asks: [fox, owl] })),
    entry("1", "q", answer(fox, "q")),
    entry("2", "1", answer(owl, "other")),
    entry("3", "2", answer(owl, "q")),
  ])
  test("done once every member it asked has answered it", () => {
    expect(roundOf(index, entryId("1"), entryId("q"))).toBe(false)
    expect(roundOf(index, entryId("2"), entryId("q"))).toBe(false)
    expect(roundOf(index, entryId("3"), entryId("q"))).toBe(true)
  })
  test("a chat that asked nobody has no round", () => {
    expect(roundOf(index, entryId("3"), entryId("1"))).toBe(false)
  })
})
