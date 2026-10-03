import { entryId, laneNameForThread, rootIdFor, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { tree } from "./fixtures.ts"
import {
  peopleHere,
  readersByRoot,
  runsHere,
  toggleOpenMenu,
  withOpenMenus,
} from "./here.ts"

const ADA = writerId("ada")
const BEA = writerId("bea")
const CY = writerId("cy")
const index = tree({ "1-r1": null, "2-a": "1-r1", "3-r2": null })

test("peopleHere groups each person's columns, in order, and drops an end not arrived", () => {
  const readingAt = new Map([
    [entryId("2-a"), [BEA, CY]],
    [entryId("3-r2"), [BEA]],
    [entryId("9-missing"), [ADA]],
  ])
  expect(peopleHere(readingAt, index, [CY, BEA], new Map())).toEqual([
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

test("peopleHere names the root its reader reported for an end in a root not held (ADR-0063)", () => {
  const readingAt = new Map([[entryId("8-far"), [BEA]]])
  expect(
    peopleHere(
      readingAt,
      index,
      [BEA],
      new Map([[entryId("8-far"), entryId("7-r3")]]),
    ),
  ).toEqual([{ writer: BEA, threads: [{ end: "8-far", root: "7-r3" }] }])
})

test("readersByRoot turns people around: each root with its readers, each once", () => {
  const people = peopleHere(
    new Map([
      [entryId("2-a"), [BEA, CY]],
      [entryId("1-r1"), [BEA]],
      [entryId("3-r2"), [BEA]],
    ]),
    index,
    [BEA, CY],
    new Map(),
  )
  expect([...readersByRoot(people)]).toEqual([
    ["1-r1", [BEA, CY]],
    ["3-r2", [BEA]],
  ])
})

test("withOpenMenus keeps a person who left while their menu is open, where they were", () => {
  const thread = (end: string, root: string) => ({
    end: entryId(end),
    root: entryId(root),
  })
  const bea = { writer: BEA, threads: [thread("2-a", "1-r1")] }
  const cy = { writer: CY, threads: [thread("3-r2", "3-r2")] }
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

test("runsHere: each held run at its tip, then each other running lane at its root's entry (ADR-0063)", () => {
  const held = laneNameForThread("held")
  const far = laneNameForThread("far")
  const fresh = laneNameForThread("fresh")
  const farRoot = rootIdFor("far")
  const freshRoot = rootIdFor("fresh")
  expect(
    runsHere({
      activity: [{ lane: held, tip: entryId("2-a") }],
      running: [
        { lane: held, root: rootIdFor("r1") },
        { lane: far, root: farRoot },
        { lane: fresh, root: freshRoot },
      ],
      rootEntries: new Map([[farRoot, entryId("8-r9")]]),
      index,
    }),
  ).toEqual([
    { lane: held, root: "1-r1", end: "2-a" },
    { lane: far, root: "8-r9", end: "8-r9" },
  ])
})
