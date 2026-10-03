import { writerId } from "@pineta/core"
import { newPresenceDoc, readingKey, seatKey } from "@pineta/schema"
import { expect, test } from "vitest"
import { readReading, readReadingRoots, readTyping } from "./index.ts"

test("each presence read names each seat's person, a person with two seats twice (ADR-0037)", () => {
  const ada = writerId("ada@x.io")
  const [one, two] = [seatKey(ada, "s1"), seatKey(ada, "s2")]
  const doc = newPresenceDoc()
  doc.reading.set(readingKey(one, "c1"), "e1")
  doc.typing.set(one, "e1")
  doc.typing.set(two, "e2")
  expect(readReading(doc)).toEqual([[ada, "e1"]])
  expect(readTyping(doc)).toEqual([
    [ada, "e1"],
    [ada, "e2"],
  ])
})

test("a presence read leaves out an entry once it decays", () => {
  const ada = writerId("ada@x.io")
  const bea = writerId("bea@x.io")
  const doc = newPresenceDoc()
  doc.reading.set(readingKey(seatKey(ada, "s1"), "c1"), "e1")
  doc.reading.set(readingKey(seatKey(bea, "s2"), "c2"), null)
  doc.typing.set(seatKey(bea, "s2"), null)
  expect(readReading(doc)).toEqual([[ada, "e1"]])
  expect(readTyping(doc)).toEqual([])
})

test("a presence read keeps its array while its entries are the same, and not after a change", () => {
  const ada = seatKey(writerId("ada@x.io"), "s1")
  const doc = newPresenceDoc()
  doc.reading.set(readingKey(ada, "c1"), "e1")
  const first = readReading(doc)
  // The page's refresh: the same value written again.
  doc.reading.set(readingKey(ada, "c1"), "e1")
  expect(readReading(doc)).toBe(first)
  doc.reading.set(readingKey(ada, "c1"), "e2")
  const moved = readReading(doc)
  expect(moved).not.toBe(first)
  expect(moved).toEqual([[writerId("ada@x.io"), "e2"]])
})

test("each followed end's root, as its column reported it; the same map while unchanged (ADR-0063)", () => {
  const ada = seatKey(writerId("ada@x.io"), "s1")
  const doc = newPresenceDoc()
  doc.reading.set(readingKey(ada, "c1"), "e1")
  doc.readingRoot.set(readingKey(ada, "c1"), "r1")
  doc.reading.set(readingKey(ada, "c2"), "e2")
  doc.readingRoot.set(readingKey(ada, "c2"), null)
  const first = readReadingRoots(doc)
  expect([...first]).toEqual([["e1", "r1"]])
  doc.readingRoot.set(readingKey(ada, "c1"), "r1")
  expect(readReadingRoots(doc)).toBe(first)
  doc.readingRoot.set(readingKey(ada, "c1"), "r9")
  expect([...readReadingRoots(doc)]).toEqual([["e1", "r9"]])
})
