// The presence document's shape. What decay and disconnects do across peers
// was measured through Exchanges (`TECHNICAL.md`, "Presence").
import { batch, createDoc, SUBSTRATE } from "@kyneta/schema"
import { describe, expect, test } from "vitest"
import { newPresenceDoc } from "./fixtures.ts"
import { presenceDoc, readingKey, seatKey, writerOfKey } from "./index.ts"

const tick = (doc: object, now: number) =>
  (doc as Record<symbol, { tick?: (n: number) => void }>)[SUBSTRATE]?.tick?.(
    now,
  )

describe("presence: flat records of decaying strings", () => {
  test("the shape binds, and each writer's keys are its own", () => {
    const doc = newPresenceDoc()
    const me = seatKey("w-ada@x.io", "s1")
    batch(doc, d => {
      d.reading.set(readingKey(me, "c1"), "e1")
      d.reading.set(readingKey(me, "c2"), "e2")
      d.typing.set(me, "e2")
    })
    expect(doc.reading()).toEqual({
      "w-ada@x.io:s1:c1": "e1",
      "w-ada@x.io:s1:c2": "e2",
    })
    expect(doc.typing()).toEqual({ "w-ada@x.io:s1": "e2" })
  })
  test("every key's writer is before its first colon", () => {
    const me = seatKey("w-ada@x.io", "s1")
    expect([writerOfKey(me), writerOfKey(readingKey(me, "c1"))]).toEqual([
      "w-ada@x.io",
      "w-ada@x.io",
    ])
  })
  test("a value with no fresh write decays to null; the key stays", () => {
    const doc = createDoc(presenceDoc({ presenceMs: 1_000, typingMs: 100 }))
    batch(doc, d => {
      d.reading.set("w-ada:c1", "e1")
      d.typing.set("w-ada", "e1")
    })
    tick(doc, Date.now() + 500)
    expect([doc.reading()["w-ada:c1"], doc.typing()["w-ada"]]).toEqual([
      "e1",
      null,
    ])
    tick(doc, Date.now() + 2_000)
    expect(doc.reading()).toEqual({ "w-ada:c1": null })
  })
  test("a closed column's key can be deleted", () => {
    const doc = newPresenceDoc()
    batch(doc, d => d.reading.set("w-ada:c1", "e1"))
    batch(doc, d => d.reading.delete("w-ada:c1"))
    expect(doc.reading()).toEqual({})
  })
})
