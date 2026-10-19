import { canvasIdFor, writerId } from "@pinetrie/core"
import { readingKey, seatKey } from "@pinetrie/schema"
import { newPresenceDoc } from "@pinetrie/schema/fixtures"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { expect, test } from "vitest"
import {
  readReading,
  readReadingCanvases,
  readTyping,
  readTypingIn,
} from "./index.ts"

test("each presence read names each seat's person, a person with two seats twice", () => {
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

test("each followed end's canvas, as its column reported it, kept while unchanged", () => {
  const ada = seatKey(writerId("ada@x.io"), "s1")
  const doc = newPresenceDoc()
  const [k1, k9] = [canvasIdFor("1"), canvasIdFor("9")]
  doc.reading.set(readingKey(ada, "c1"), "e1")
  doc.readingCanvas.set(readingKey(ada, "c1"), k1)
  doc.reading.set(readingKey(ada, "c2"), "e2")
  doc.readingCanvas.set(readingKey(ada, "c2"), null)
  doc.reading.set(readingKey(ada, "c3"), "e3")
  doc.readingCanvas.set(readingKey(ada, "c3"), "r-not-a-canvas")
  const first = readReadingCanvases(doc)
  expect([...first]).toEqual([["e1", k1]])
  doc.readingCanvas.set(readingKey(ada, "c1"), k1)
  expect(readReadingCanvases(doc)).toBe(first)
  doc.readingCanvas.set(readingKey(ada, "c1"), k9)
  expect([...readReadingCanvases(doc)]).toEqual([["e1", k9]])
})

test("the cards someone is typing in, from any seat, without decayed ones; the same set while unchanged", () => {
  const ada = writerId("ada@x.io")
  const doc = newPresenceDoc()
  doc.typingIn.set(seatKey(ada, "s1"), cardIdFor("c1"))
  doc.typingIn.set(seatKey(ada, "s2"), null)
  const first = readTypingIn(doc)
  expect([...first]).toEqual([cardIdFor("c1")])
  doc.typingIn.set(seatKey(ada, "s1"), cardIdFor("c1"))
  expect(readTypingIn(doc)).toBe(first)
  doc.typingIn.set(seatKey(ada, "s1"), null)
  expect([...readTypingIn(doc)]).toEqual([])
})
