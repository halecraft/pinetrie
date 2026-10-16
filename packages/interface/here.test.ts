import { canvasIdFor, entryId, threadIdFor, writerId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { tree } from "./fixtures.ts"
import {
  peopleHere,
  peopleIn,
  readerHeading,
  readersByCanvas,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"

const ADA = writerId("ada")
const BEA = writerId("bea")
const CY = writerId("cy")
const index = tree({ "1-r1": null, "2-a": "1-r1", "3-r2": null })
const [K1, K2, K3] = ["1", "2", "3"].map(canvasIdFor) as [
  ReturnType<typeof canvasIdFor>,
  ReturnType<typeof canvasIdFor>,
  ReturnType<typeof canvasIdFor>,
]
/** Each root's thread, each in a canvas of its own. */
const facts = {
  canvasOfThread: new Map([
    [threadIdFor("1-r1"), K1],
    [threadIdFor("3-r2"), K2],
  ]),
  reported: new Map(),
}

test("peopleHere groups each person's columns by the canvas each thread is in", () => {
  const readingAt = new Map([
    [entryId("2-a"), [BEA, CY]],
    [entryId("3-r2"), [BEA]],
    [entryId("9-missing"), [ADA]],
  ])
  expect(peopleHere(readingAt, index, [CY, BEA], facts)).toEqual([
    { writer: CY, threads: [{ end: "2-a", canvas: K1 }] },
    {
      writer: BEA,
      threads: [
        { end: "2-a", canvas: K1 },
        { end: "3-r2", canvas: K2 },
      ],
    },
  ])
})

test("peopleHere names the canvas its reader reported for an end in a root not held", () => {
  const readingAt = new Map([[entryId("8-far"), [BEA]]])
  expect(
    peopleHere(readingAt, index, [BEA], {
      ...facts,
      reported: new Map([[entryId("8-far"), K3]]),
    }),
  ).toEqual([{ writer: BEA, threads: [{ end: "8-far", canvas: K3 }] }])
})

test("readersByCanvas turns people around: each canvas with its readers, each once; peopleIn keeps a canvas's", () => {
  const people = peopleHere(
    new Map([
      [entryId("2-a"), [BEA, CY]],
      [entryId("1-r1"), [BEA]],
      [entryId("3-r2"), [BEA]],
    ]),
    index,
    [BEA, CY],
    facts,
  )
  expect([...readersByCanvas(people)]).toEqual([
    [K1, [BEA, CY]],
    [K2, [BEA]],
  ])
  expect(peopleIn(people, new Set([K2]))).toEqual([
    { writer: BEA, threads: [{ end: "3-r2", canvas: K2 }] },
  ])
})

test("withOpenMenus keeps a person who left while their menu is open, where they were", () => {
  const thread = (end: string, canvas: typeof K1) => ({
    end: entryId(end),
    canvas,
  })
  const bea = { writer: BEA, threads: [thread("2-a", K1)] }
  const cy = { writer: CY, threads: [thread("3-r2", K2)] }
  expect(withOpenMenus([bea, cy], new Map())).toEqual([
    { person: bea, gone: false },
    { person: cy, gone: false },
  ])
  // Ada's menu opened when she was first; she has left.
  expect(withOpenMenus([bea, cy], new Map([[ADA, 0]]))).toEqual([
    { person: { writer: ADA, threads: [] }, gone: true },
    { person: bea, gone: false },
    { person: cy, gone: false },
  ])
  // Past the end, a gone person goes last; one still here is only drawn once.
  expect(
    withOpenMenus(
      [bea],
      new Map([
        [BEA, 0],
        [CY, 5],
      ]),
    ),
  ).toEqual([
    { person: bea, gone: false },
    { person: { writer: CY, threads: [] }, gone: true },
  ])
})

test("toggleOpenMenu records an opening and forgets a closing, the same map when nothing changed", () => {
  const none = new Map()
  expect(toggleOpenMenu(none, BEA, 0, false)).toBe(none)
  const opened = toggleOpenMenu(none, BEA, 1, true)
  expect([...opened]).toEqual([[BEA, 1]])
  expect(toggleOpenMenu(opened, BEA, 1, true)).toBe(opened)
  expect([...toggleOpenMenu(opened, BEA, 1, false)]).toEqual([])
})

test("readerHeading: where a reader is, or that they have left", () => {
  expect(readerHeading("Bea", false)).toBe("Bea is in")
  expect(readerHeading("Bea", true)).toBe("Bea has left")
})
