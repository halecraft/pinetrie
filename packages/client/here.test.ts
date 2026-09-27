import { type EntryLike, indexTree, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { peopleHere, readersByRoot } from "./here.ts"

const ADA = writerId("ada")
const BEA = writerId("bea")
const CY = writerId("cy")
const msg = (id: string, parentId: string | null): EntryLike => ({
  id,
  parentId,
  type: "message",
  message: { role: "user", content: id },
})
const index = indexTree(
  Object.fromEntries(
    [msg("1-r1", null), msg("2-a", "1-r1"), msg("3-r2", null)].map(e => [
      e.id,
      e,
    ]),
  ),
)

test("peopleHere groups each person's columns, in order, and drops an end not arrived", () => {
  const readingAt = new Map([
    ["2-a", [BEA, CY]],
    ["3-r2", [BEA]],
    ["9-missing", [ADA]],
  ])
  expect(peopleHere(readingAt, index, [CY, BEA])).toEqual([
    { writer: CY, threads: [{ end: "2-a", root: "1-r1" }] },
    {
      writer: BEA,
      threads: [
        { end: "2-a", root: "1-r1" },
        { end: "3-r2", root: "3-r2" },
      ],
    },
  ])
})

test("readersByRoot turns people around: each root with its readers, each once", () => {
  const people = peopleHere(
    new Map([
      ["2-a", [BEA, CY]],
      ["1-r1", [BEA]],
      ["3-r2", [BEA]],
    ]),
    index,
    [BEA, CY],
  )
  expect([...readersByRoot(people)]).toEqual([
    ["1-r1", [BEA, CY]],
    ["3-r2", [BEA]],
  ])
})
