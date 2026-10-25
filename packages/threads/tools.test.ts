import { expect, test } from "vitest"
import { BASH_TOOL, isTerminalOutputTool, READ_TOOL } from "./tools.ts"

test("only bash's result is a terminal's output", () => {
  expect(
    [BASH_TOOL, READ_TOOL, "constructor"].map(isTerminalOutputTool),
  ).toEqual([true, false, false])
})
