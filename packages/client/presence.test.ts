import { type EntryLike, indexTree, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { presenceColors, writerOrder } from "./presence.tsx"

const ADA = writerId("ada")
const BEA = writerId("bea")
const CAT = writerId("cat")
const DAN = writerId("dan")
const chat = (id: string, writer: ReturnType<typeof writerId>): EntryLike => ({
  id,
  parentId: null,
  type: "message",
  message: { role: "chat", content: "hi", writer },
})

test("writerOrder: by first message, then those only named", () => {
  const index = indexTree({
    "2": chat("2", ADA),
    "1": chat("1", BEA),
    "3": chat("3", BEA),
  })
  expect(writerOrder(index, [DAN, CAT, ADA])).toEqual([BEA, ADA, CAT, DAN])
})

test("presenceColors: the first three people each have their own colour", () => {
  const colorOf = presenceColors([ADA, BEA, CAT, DAN])
  const first = [ADA, BEA, CAT].map(colorOf)
  expect(new Set(first).size).toBe(3)
  expect(presenceColors([ADA, BEA, CAT])(BEA)).toBe(first[1])
  expect(colorOf(DAN)).toMatch(/^hsl\(/)
})
