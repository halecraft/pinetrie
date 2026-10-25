import { BASH_OUTPUT } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { bashOutputNow } from "./0031-bash-output.ts"

test("a stored split decodes again as a split, marking no stderr", () => {
  const moved = bashOutputNow({
    statements: [
      { text: "a\n", truncated: false },
      { text: "", truncated: false },
    ],
  })
  expect(moved).toEqual({
    verdict: {
      kind: "split",
      statements: [
        { text: "a\n", truncated: false, stderr: [] },
        { text: "", truncated: false, stderr: [] },
      ],
    },
    stderr: [],
  })
  expect(BASH_OUTPUT.decode(moved, "call-1")?.verdict.kind).toBe("split")
})

test("a value already in the new shape, or not a split, needs nothing", () => {
  const already = bashOutputNow({ statements: [] })
  expect(bashOutputNow(already)).toBeNull()
  expect(bashOutputNow({ other: 1 })).toBeNull()
  expect(bashOutputNow("x")).toBeNull()
})
