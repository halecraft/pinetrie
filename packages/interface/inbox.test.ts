import {
  type EntryId,
  entryId,
  rootIdFor,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import type { RootRecord } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  type Inbox,
  inboxMentions,
  isUnseen,
  markAllSeen,
  markSeen,
  seenNow,
  seenOnScreen,
} from "./inbox.ts"

const ADA = writerId("ada")
const BEA = writerId("bea")
const GUEST = writerId("p-7f1d")

/** A root's directory record: its sends that name someone. Ids sort by age. */
const record = (
  entry: string | null,
  newest: string | null,
  mentions: readonly (readonly [id: string, by: WriterId, text: string])[],
): RootRecord => ({
  root: rootIdFor(entry ?? "empty"),
  entry: entry === null ? null : entryId(entry),
  first: entry === null ? null : entryId(entry),
  firstLine: "",
  messages: mentions.length,
  newest: newest === null ? null : entryId(newest),
  writers: [],
  threads: {},
  mentions: mentions.map(([id, by, text]) => ({
    id: entryId(id) as EntryId,
    by,
    text,
    thread: threadIdFor(id),
  })),
  blobs: [],
})
const roots = [
  record("1-r1", "7-d", [
    ["1-r1", BEA, "hello @ada"],
    ["2-a", ADA, "@ada talking to myself"],
    ["3-b", BEA, "@cy not you"],
    ["7-d", BEA, "later @ada"],
  ]),
  record("4-r2", "6-c", [
    ["4-r2", BEA, "@guest-7f1d over here"],
    ["6-c", BEA, "again @Ada, and @types/node"],
  ]),
  record(null, null, []),
]
const participants = ["Ada", "Bea", "Cy", "guest-7f1d"]
const mine = inboxMentions({ roots, me: ADA, myName: "Ada", participants })
const ids = mine.map(m => m.id)

describe("inboxMentions", () => {
  test("sends naming you, newest first, each with its root and writer", () => {
    expect(ids).toEqual(["7-d", "6-c", "1-r1"])
    expect(mine[1]).toMatchObject({ root: "r-4-r2", by: BEA })
  })
  test("never your own message or someone else's mention", () => {
    expect(ids).not.toContain("2-a")
    expect(ids).not.toContain("3-b")
  })
  test("a guest is mentioned by their guest label", () => {
    const theirs = inboxMentions({
      roots,
      me: GUEST,
      myName: "guest-7f1d",
      participants,
    })
    expect(theirs.map(m => m.id)).toEqual(["4-r2"])
  })
})

describe("the inbox", () => {
  const start: Inbox = { since: "1-r1", seen: [] }
  test("from a watermark, a person starts with nothing unseen", () => {
    const fresh: Inbox = { since: "7-d", seen: [] }
    expect(ids.filter(id => isUnseen(fresh, id))).toEqual([])
  })
  test("marking seen compacts `since` over a run of seen mentions", () => {
    const one = markSeen(start, ["6-c"], mine)
    expect(one).toEqual({ since: "6-c", seen: [] })
    expect(markSeen(one, ["7-d"], mine)).toEqual({ since: "7-d", seen: [] })
  })
  test("a seen mention above an unseen one stays in `seen`", () => {
    const island = markSeen(start, ["7-d"], mine)
    expect(island).toEqual({ since: "1-r1", seen: ["7-d"] })
    expect(isUnseen(island, "6-c")).toBe(true)
    expect(isUnseen(island, "7-d")).toBe(false)
    expect(markSeen(island, ["7-d"], mine)).toBe(island)
  })
  test("mark all seen moves `since` to the newest mention and empties `seen`", () => {
    expect(markAllSeen({ since: "1-r1", seen: ["7-d"] }, mine)).toEqual({
      since: "7-d",
      seen: [],
    })
  })
  test("seen on screen: the unseen mentions among what the tab you are on draws", () => {
    const shown = new Set(["1-r1", "7-d", "2-a"])
    expect(seenOnScreen(start, mine, shown)).toEqual(["7-d"])
    expect(seenOnScreen({ since: "7-d", seen: [] }, mine, shown)).toEqual([])
  })
  test("a mention drawn in the tab you are on is seen; with none new, nothing is written", () => {
    const shown = new Set(["1-r1", "7-d", "2-a"])
    const next = seenNow(start, mine, shown)
    expect(next === null ? "nothing written" : isUnseen(next, "7-d")).toBe(
      false,
    )
    expect(seenNow({ since: "7-d", seen: [] }, mine, shown)).toBe(null)
  })
})
