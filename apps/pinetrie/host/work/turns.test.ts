import { entryId } from "@pinetrie/core"
import { readTreeIndex } from "@pinetrie/reads"
import { newRootDoc, writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { row } from "../fakes.ts"
import { queueTurnEnd, revisionTitle } from "./turns.ts"

test("a turn's title is its message's first line, else its first call's intent or words, else turn", () => {
  const doc = newRootDoc()
  const call = {
    type: "toolCall",
    id: "c1",
    name: "bash",
    arguments: { command: "ls -la" },
  }
  writeEntry(doc, row("e1", null, { role: "user", content: "fix it\nplease" }))
  writeEntry(doc, row("e2", "e1", { role: "assistant", content: [call] }))
  writeEntry(doc, row("e3", "e2", { role: "assistant", content: [] }))
  writeEntry(
    doc,
    row("e4", "e3", {
      role: "assistant",
      content: [
        {
          ...call,
          id: "c2",
          arguments: { intent: "List the files", command: "ls" },
        },
      ],
    }),
  )
  const index = readTreeIndex(doc)
  expect(revisionTitle(index, entryId("e1"))).toBe("fix it")
  expect(revisionTitle(index, entryId("e2"))).toBe("ran ls -la")
  expect(revisionTitle(index, entryId("e3"))).toBe("turn")
  expect(revisionTitle(index, entryId("e4"))).toBe("List the files")
})

test("what follows a turn's commit is fired once its snapshot step is queued", () => {
  const seen: string[] = []
  const ended = queueTurnEnd(
    () => {
      seen.push("snapshot queued")
      return "ended"
    },
    () => seen.push("follow"),
  )
  expect(ended).toBe("ended")
  expect(seen).toEqual(["snapshot queued", "follow"])
  expect(queueTurnEnd(() => "ended", null)).toBe("ended")
})
