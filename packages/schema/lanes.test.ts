import { entryId, laneNameForThread } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  newRootDoc,
  physicalKey,
  readLaneNames,
  readLaneTip,
  readStoredLanes,
  writeLaneTip,
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
