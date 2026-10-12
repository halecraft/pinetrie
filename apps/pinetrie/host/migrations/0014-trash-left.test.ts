import { expect, test } from "vitest"
import { oldTrashRows } from "./0014-trash-left.ts"

test("only rows in the old trash shape are deleted, so a second run finds none", () => {
  const rows = {
    b: { kind: "discarded", holder: "w-ada", task: "" },
    a: { kind: "discarded", holder: "w-bea", task: "k-1" },
    c: { kind: "discarded-canvas", task: "k-1", order: "m", width: "1" },
    d: { kind: "note", column: "n-1", order: "m" },
  }
  expect(oldTrashRows(rows)).toEqual(["a", "b"])
  expect(oldTrashRows({ c: rows.c, d: rows.d })).toEqual([])
})
