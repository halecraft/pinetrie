import { describe, expect, test } from "vitest"
import {
  type EntryLike,
  indexTree,
  presenceView,
  type WriterId,
  writerId,
} from "./index.ts"

const tree = (parents: Record<string, string | null>) =>
  indexTree(
    Object.fromEntries(
      Object.entries(parents).map(([id, parentId]): [string, EntryLike] => [
        id,
        {
          id,
          parentId,
          type: "message",
          message: { role: "user", content: id },
        },
      ]),
    ),
  )
// 1 → 2 → 3 is a thread; 4 is a sibling branch off 1.
const index = tree({ "1": null, "2": "1", "3": "2", "4": "1" })
const [me, bea, cy] = [writerId("me"), writerId("bea"), writerId("cy")]
const view = (
  reading: [WriterId, string][],
  typing: [WriterId, string][] = [],
) => presenceView({ reading, typing: new Map(typing) }, me, index)

describe("presenceView: others, by thread", () => {
  test("excludes me, everywhere", () => {
    const v = view(
      [
        [me, "3"],
        [bea, "3"],
      ],
      [[me, "3"]],
    )
    expect([...v.readingAt]).toEqual([["3", [bea]]])
    expect(v.seenBy("3")).toEqual([bea])
    expect(v.typingAt("3")).toEqual([])
  })
  test("seenBy counts someone behind on the same thread, not on a sibling", () => {
    const v = view([
      [bea, "2"],
      [cy, "4"],
    ])
    expect(v.seenBy("3")).toEqual([bea])
    expect(v.seenBy("4")).toEqual([cy])
  })
  test("readingAt groups several people, and one person's several columns once", () => {
    const v = view([
      [bea, "3"],
      [bea, "3"],
      [cy, "3"],
    ])
    expect(v.readingAt.get("3")).toEqual([bea, cy])
  })
  test("typingAt is keyed by thread end", () => {
    const v = view(
      [],
      [
        [bea, "3"],
        [cy, "4"],
      ],
    )
    expect([v.typingAt("3"), v.typingAt("4")]).toEqual([[bea], [cy]])
  })
})
