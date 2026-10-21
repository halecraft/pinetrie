import { canvasIdFor } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import { foldMotion } from "./column-motion.ts"

describe("foldMotion", () => {
  const canvas = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
  const card = cardIdFor("c1")
  test("a card's fold or the canvas column's, with which way; nothing for another action", () => {
    expect(
      foldMotion({
        kind: "view",
        canvas,
        first: null,
        change: { kind: "fold", card, unfolded: false },
      }),
    ).toEqual({ column: { kind: "card", card }, unfolded: false })
    expect(
      foldMotion({
        kind: "view",
        canvas,
        first: null,
        change: { kind: "fold-canvas", unfolded: true },
      }),
    ).toEqual({ column: { kind: "canvas", canvas }, unfolded: true })
    expect(
      foldMotion({
        kind: "view",
        canvas,
        first: null,
        change: { kind: "density", card, density: "outline" },
      }),
    ).toBeNull()
    expect(foldMotion({ kind: "close-canvas", canvas })).toBeNull()
  })
})
