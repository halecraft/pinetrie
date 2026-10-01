import { describe, expect, test } from "vitest"
import {
  type EntryLike,
  indexTree,
  readingAt,
  seenBy,
  type WriterId,
  whoIsAt,
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
type Entries = [WriterId, string][]

describe("presence: others, by thread", () => {
  test("excludes me, everywhere", () => {
    const reading: Entries = [
      [me, "3"],
      [bea, "3"],
    ]
    expect([...readingAt(reading, me)]).toEqual([["3", [bea]]])
    expect(seenBy(reading, me, index, "3")).toEqual([bea])
    expect(whoIsAt([[me, "3"]], "3", me)).toEqual([])
  })
  test("seenBy counts someone behind on the same thread, not on a sibling", () => {
    const reading: Entries = [
      [bea, "2"],
      [cy, "4"],
    ]
    expect(seenBy(reading, me, index, "3")).toEqual([bea])
    expect(seenBy(reading, me, index, "4")).toEqual([cy])
  })
  test("readingAt groups several people, and one person's several columns once", () => {
    const at = readingAt(
      [
        [bea, "3"],
        [bea, "3"],
        [cy, "3"],
      ],
      me,
    )
    expect(at.get("3")).toEqual([bea, cy])
  })
  test("whoIsAt is keyed by value", () => {
    const typing: Entries = [
      [bea, "3"],
      [cy, "4"],
    ]
    expect([whoIsAt(typing, "3", me), whoIsAt(typing, "4", me)]).toEqual([
      [bea],
      [cy],
    ])
  })
  test("a person typing from two seats shows once (ADR-0037)", () => {
    const typing: Entries = [
      [bea, "3"],
      [bea, "3"],
      [me, "3"],
    ]
    expect(whoIsAt(typing, "3", me)).toEqual([bea])
  })
})
