import { entryId, toolLabel } from "@pineta/core"
import { readTreeIndex } from "@pineta/reads"
import { newSessionDoc, writeEntry } from "@pineta/schema"
import { expect, test } from "vitest"
import { row } from "../fakes.ts"
import { titleOf } from "./turns.ts"

test("a turn's title is its message's first line, else its first tool's label, else turn", () => {
  const doc = newSessionDoc()
  const call = {
    type: "toolCall",
    name: "bash",
    arguments: { command: "ls -la" },
  }
  writeEntry(doc, row("e1", null, { role: "user", content: "fix it\nplease" }))
  writeEntry(doc, row("e2", "e1", { role: "assistant", content: [call] }))
  writeEntry(doc, row("e3", "e2", { role: "assistant", content: [] }))
  const index = readTreeIndex(doc)
  expect(titleOf(index, entryId("e1"))).toBe("fix it")
  expect(titleOf(index, entryId("e2"))).toBe(toolLabel("bash", call.arguments))
  expect(titleOf(index, entryId("e3"))).toBe("turn")
})
