import { expect, test } from "vitest"
import { Command, Reply } from "./line.ts"
import { EMPTY_COMMAND, EMPTY_REPLY } from "./messages.ts"

// The wire carries a Line's fields alone: a field the codec writes and the
// Line leaves out never reaches the host.
test("the Line carries every field of a command and of a reply", () => {
  expect(Object.keys(Command.fields).sort()).toEqual(
    Object.keys(EMPTY_COMMAND).sort(),
  )
  expect(Object.keys(Reply.fields).sort()).toEqual(
    Object.keys(EMPTY_REPLY).sort(),
  )
})
