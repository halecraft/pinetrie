import { threadIdFor, writerId } from "@pinetrie/core"
import { decodeQueuedFact } from "@pinetrie/rules"
import { expect, test } from "vitest"
import {
  factInInventory,
  queuedFactInInventory,
} from "./0030-fact-in-inventory.ts"

const ADA = writerId("ada@example.com")
const BEA = writerId("bea@example.com")
const undelivered = (why: object) => ({
  kind: "undelivered",
  lane: threadIdFor("answering"),
  to: threadIdFor("asking"),
  toName: "amber-fox",
  why,
  by: ADA,
})

test("an undelivered fact to a thread in an inventory decodes again, its holder kept", () => {
  const renamed = factInInventory(undelivered({ kind: "held", by: BEA }))
  expect(renamed).toEqual(undelivered({ kind: "in-inventory", holder: BEA }))
  expect(decodeQueuedFact(JSON.stringify(renamed))).toEqual(renamed)
})

test("another fact, another reason, or one already renamed needs nothing", () => {
  expect(factInInventory({ kind: "squashed" })).toBeNull()
  expect(factInInventory(undelivered({ kind: "gone" }))).toBeNull()
  expect(
    factInInventory(undelivered({ kind: "in-inventory", holder: BEA })),
  ).toBeNull()
})

test("a queued fact's row is rewritten with its fact", () => {
  const row = queuedFactInInventory({
    fact: JSON.stringify(undelivered({ kind: "held", by: BEA })),
  })
  expect(JSON.parse((row as { fact: string }).fact)).toEqual(
    undelivered({ kind: "in-inventory", holder: BEA }),
  )
})
