import { entryId, laneNameForThread } from "@pinetrie/core"
import { expect, test } from "vitest"
import { newRootDoc, writeLaneTip } from "./fixtures.ts"
import {
  physicalKey,
  readLaneNames,
  readLaneTip,
  readStoredLanes,
} from "./index.ts"

test("readStoredLanes gives a thread's lanes, and sets aside a stored name that is not one", () => {
  const doc = newRootDoc()
  const lane = laneNameForThread("0123456789abcdef")
  writeLaneTip(doc, lane, entryId("e-1"))
  doc.values.set(physicalKey("pi.branch.tip", "main"), {
    namespace: "pi.branch.tip",
    key: "main",
    value: "e-2",
  })
  expect(readStoredLanes(doc)).toEqual({ lanes: [lane], malformed: ["main"] })
  expect(readLaneNames(doc)).toEqual([lane])
  expect(readLaneTip(doc, lane)).toBe("e-1")
})

test("readStoredLanes sets aside a lane whose tip is no entry id, and orders the rest by name", () => {
  const doc = newRootDoc()
  const [a, b, c] = ["0001", "0002", "0003"].map(laneNameForThread) as [
    ReturnType<typeof laneNameForThread>,
    ReturnType<typeof laneNameForThread>,
    ReturnType<typeof laneNameForThread>,
  ]
  writeLaneTip(doc, c, null)
  writeLaneTip(doc, a, entryId("e-1"))
  doc.values.set(physicalKey("pi.branch.tip", b), {
    namespace: "pi.branch.tip",
    key: b,
    value: 7,
  })
  expect(readStoredLanes(doc)).toEqual({ lanes: [a, c], malformed: [b] })
  expect(readLaneTip(doc, c)).toBeNull()
})
