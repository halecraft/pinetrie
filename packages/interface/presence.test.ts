import {
  type EntryId,
  entryId,
  indexTree,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { fromParents } from "./fixtures.ts"
import { othersReading, othersWithValue, seenBy } from "./presence.ts"

// 1 → 2 → 3 is a thread; 4 is a sibling branch off 1.
const index = indexTree(
  fromParents({ "1": null, "2": "1", "3": "2", "4": "1" }),
)
const [me, bea, cy] = [writerId("me"), writerId("bea"), writerId("cy")]
type Entries = [WriterId, EntryId][]

describe("presence: others, by thread", () => {
  test("excludes me, everywhere", () => {
    const reading: Entries = [
      [me, entryId("3")],
      [bea, entryId("3")],
    ]
    expect([...othersReading(reading, me)]).toEqual([["3", [bea]]])
    expect(seenBy(reading, me, index, entryId("3"))).toEqual([bea])
    expect(othersWithValue([[me, entryId("3")]], entryId("3"), me)).toEqual([])
  })
  test("seenBy counts someone behind on the same thread, not on a sibling", () => {
    const reading: Entries = [
      [bea, entryId("2")],
      [cy, entryId("4")],
    ]
    expect(seenBy(reading, me, index, entryId("3"))).toEqual([bea])
    expect(seenBy(reading, me, index, entryId("4"))).toEqual([cy])
  })
  test("othersReading groups several people, and one person's several columns once", () => {
    const at = othersReading(
      [
        [bea, entryId("3")],
        [bea, entryId("3")],
        [cy, entryId("3")],
      ],
      me,
    )
    expect(at.get(entryId("3"))).toEqual([bea, cy])
  })
  test("othersWithValue is keyed by value", () => {
    const typing: Entries = [
      [bea, entryId("3")],
      [cy, entryId("4")],
    ]
    expect([
      othersWithValue(typing, entryId("3"), me),
      othersWithValue(typing, entryId("4"), me),
    ]).toEqual([[bea], [cy]])
  })
  test("a person typing from two seats shows once", () => {
    const typing: Entries = [
      [bea, entryId("3")],
      [bea, entryId("3")],
      [me, entryId("3")],
    ]
    expect(othersWithValue(typing, entryId("3"), me)).toEqual([bea])
  })
})
