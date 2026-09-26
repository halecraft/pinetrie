// The presence document's shape, pinned before anything is built on it
// (PLAN-2026-09-27-presence, Phase 0). What decay and disconnects do across
// peers was measured through Exchanges; see the plan's implementation notes.
import { batch, createDoc, SUBSTRATE } from "@kyneta/schema"
import { describe, expect, test } from "vitest"
import { newPresenceDoc, presenceDoc, readingKey } from "./index.ts"

const tick = (doc: object, now: number) =>
  (doc as Record<symbol, { tick?: (n: number) => void }>)[SUBSTRATE]?.tick?.(
    now,
  )

describe("presence: flat records of decaying strings", () => {
  test("the shape binds, and each writer's keys are its own", () => {
    const doc = newPresenceDoc()
    batch(doc, d => {
      d.reading.set(readingKey("w-ada", "c1"), "e1")
      d.reading.set(readingKey("w-ada", "c2"), "e2")
      d.typing.set("w-ada", "e2")
    })
    expect(doc.reading()).toEqual({ "w-ada:c1": "e1", "w-ada:c2": "e2" })
    expect(doc.typing()).toEqual({ "w-ada": "e2" })
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
