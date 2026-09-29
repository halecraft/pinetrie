import { lineDocId } from "@kyneta/exchange"
import { expect, test } from "vitest"
import { departedSeats, lineDocPrefix } from "./lines.ts"

test("departedSeats: the open seats no longer among the peers", () => {
  const peers = new Map([["s1", {}]])
  expect(departedSeats(["s1", "s2"], peers)).toEqual(["s2"])
  expect(departedSeats(["s1"], peers)).toEqual([])
})

test("lineDocPrefix is where Kyneta keeps a Line's documents", () => {
  expect(
    lineDocId("pineta.control", "a", "b").startsWith(
      lineDocPrefix("pineta.control"),
    ),
  ).toBe(true)
})
