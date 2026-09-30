import { expect, test } from "vitest"
import { click, type RowFacts, type RowSize, rowSize } from "./tool-row.ts"

test.each<[RowFacts, RowSize]>([
  [{ revealed: false, reader: null }, "closed"],
  [{ revealed: true, reader: null }, "capped"],
  [{ revealed: false, reader: "full" }, "full"],
  [{ revealed: true, reader: "closed" }, "closed"],
  [{ revealed: true, reader: "full" }, "full"],
])("rowSize(%o) is %s", (facts, size) => {
  expect(rowSize(facts)).toBe(size)
})

test.each<[RowSize, "full" | "closed"]>([
  ["closed", "full"],
  ["capped", "full"],
  ["full", "closed"],
])("a click on a %s row makes it %s", (size, next) => {
  expect(click(size)).toBe(next)
})
