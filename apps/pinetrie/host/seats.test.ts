import { writerId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { idleWriters } from "./seats.ts"

test("idleWriters: the writers with stacks of moves loaded and no seat left", () => {
  const ada = writerId("ada@x.io")
  const bea = writerId("bea@x.io")
  const cy = writerId("cy@x.io")
  expect(idleWriters([ada, bea], [bea, cy])).toEqual([ada])
  expect(idleWriters([], [ada])).toEqual([])
})
