import { readFileSync } from "node:fs"
import { PENDING_TRACK } from "@pinetrie/core"
import { newRootId } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import {
  PALETTE,
  PENDING_COLOR,
  rootColor,
  rootSeed,
  STRIDE,
  slotColor,
  trackSlot,
} from "./palette.ts"

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
const size = PALETTE.length
const seeds = Array.from({ length: size }, (_, i) => i)
/** How far apart two slots are, round the palette either way. */
const apart = (a: number, b: number) =>
  Math.min((a - b + size) % size, (b - a + size) % size)

describe("rootSeed", () => {
  test("minted roots start on every slot, not all on one", () => {
    const used = new Set(
      Array.from({ length: 200 }, () => rootSeed(newRootId())),
    )
    expect(used.size).toBe(size)
  })

  test("a root's colour is its trunk's", () => {
    const root = newRootId()
    expect(rootColor(root)).toBe(slotColor(trackSlot(rootSeed(root), 0)))
  })
})

describe("trackSlot", () => {
  test.each(
    seeds,
  )("from seed %i, the first tracks take every slot once", seed => {
    const slots = Array.from({ length: size }, (_, t) => trackSlot(seed, t))
    expect(slots[0]).toBe(seed)
    expect(new Set(slots).size).toBe(size)
  })

  test.each(
    seeds,
  )("from seed %i, neighbouring tracks are a quarter of the palette apart or more", seed => {
    for (let t = 0; t < 2 * size; t += 1) {
      const a = trackSlot(seed, t)
      const b = trackSlot(seed, t + 1)
      if (typeof a !== "number" || typeof b !== "number")
        throw new Error("a track has no slot")
      expect(apart(a, b)).toBeGreaterThanOrEqual(size / 4)
    }
  })

  test("a fresh branch is grey, whatever the seed", () => {
    expect(trackSlot(5, PENDING_TRACK)).toBe("pending")
    expect(slotColor("pending")).toBe(PENDING_COLOR)
  })

  test("the stride is coprime with the palette", () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    expect(gcd(STRIDE, size)).toBe(1)
  })
})

// sRGB to OKLab, for S110's bounds.
const linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const rgb = (hex: string) =>
  [1, 3, 5].map(i => linear(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
function oklab(hex: string): readonly number[] {
  const [r = 0, g = 0, b = 0] = rgb(hex)
  const [l, m, s] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt) as [number, number, number]
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
const distance = (a: string, b: string) => {
  const [x, y] = [oklab(a), oklab(b)]
  return Math.hypot(...x.map((v, i) => v - (y[i] ?? 0)))
}
const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = rgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe("PALETTE (S110)", () => {
  const page = /--page: (#[0-9a-f]{6})/.exec(html)?.[1] ?? ""
  /** People's first colours, the attention amber, the review's lines. */
  const reserved = [
    "#ff4fd8",
    "#ffffff",
    "#ffe030",
    "#e0c080",
    "#a8d8a8",
    "#e89a9a",
  ]

  test.each(PALETTE)("%s is 4.5:1 or more on --page", color => {
    expect(page).not.toBe("")
    expect(contrast(color, page)).toBeGreaterThanOrEqual(4.5)
  })

  test.each(PALETTE)("%s is apart from every other track colour", color => {
    for (const other of PALETTE)
      if (other !== color)
        expect(distance(color, other)).toBeGreaterThanOrEqual(0.059)
  })

  test.each(
    PALETTE,
  )("%s is apart from the colours that already mean something", color => {
    for (const r of reserved)
      expect(distance(color, r)).toBeGreaterThanOrEqual(0.08)
  })

  test("index.html links a header and its fork dots on hover, for every slot", () => {
    for (const slot of [...seeds.map(String), "pending"]) {
      expect(html).toContain(
        `#strip:has(.column-head[data-color="${slot}"]:hover) .fork-dot[data-color="${slot}"]`,
      )
      expect(html).toContain(
        `#strip:has(.fork-dot[data-color="${slot}"]:hover) .column-head[data-color="${slot}"]`,
      )
    }
  })
})
