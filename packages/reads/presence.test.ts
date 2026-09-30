import { writerId } from "@pineta/core"
import { newPresenceDoc, readingKey, seatKey } from "@pineta/schema"
import { expect, test } from "vitest"
import { readPresence } from "./index.ts"

test("readPresence names each seat's person, a person with two seats twice (ADR-0037)", () => {
  const ada = writerId("ada@x.io")
  const [one, two] = [seatKey(ada, "s1"), seatKey(ada, "s2")]
  const doc = newPresenceDoc()
  doc.reading.set(readingKey(one, "c1"), "e1")
  doc.typing.set(one, "e1")
  doc.typing.set(two, "e2")
  doc.editing.set(two, "n1")
  expect(readPresence(doc)).toEqual({
    reading: [[ada, "e1"]],
    typing: [
      [ada, "e1"],
      [ada, "e2"],
    ],
    editing: [[ada, "n1"]],
  })
})

test("readPresence leaves out an entry once it decays", () => {
  const ada = writerId("ada@x.io")
  const bea = writerId("bea@x.io")
  const doc = newPresenceDoc()
  doc.reading.set(readingKey(seatKey(ada, "s1"), "c1"), "e1")
  doc.reading.set(readingKey(seatKey(bea, "s2"), "c2"), null)
  doc.typing.set(seatKey(bea, "s2"), null)
  expect(readPresence(doc)).toEqual({
    reading: [[ada, "e1"]],
    typing: [],
    editing: [],
  })
})
