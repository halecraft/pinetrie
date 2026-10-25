import { describe, expect, test } from "vitest"
import { entryRevealScroll } from "./entry-reveal.ts"

describe("entryRevealScroll", () => {
  const view = { top: 100, bottom: 500 }
  test("an entry wholly in view scrolls nothing", () => {
    expect(entryRevealScroll({ top: 120, bottom: 480 }, view)).toBe(0)
  })
  test("an entry above the view scrolls up to its top", () => {
    expect(entryRevealScroll({ top: 40, bottom: 140 }, view)).toBe(-60)
  })
  test("an entry below the view scrolls down to its bottom", () => {
    expect(entryRevealScroll({ top: 450, bottom: 560 }, view)).toBe(60)
  })
  test("an entry taller than the view, its top below the view's, scrolls only to its top", () => {
    expect(entryRevealScroll({ top: 300, bottom: 1200 }, view)).toBe(200)
  })
  test("an entry taller than the view, its top above the view's, scrolls up to its top", () => {
    expect(entryRevealScroll({ top: -400, bottom: 900 }, view)).toBe(-500)
  })
})
