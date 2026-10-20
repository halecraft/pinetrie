import { readFileSync } from "node:fs"
import { SLOTS } from "@pinetrie/interface"
import { describe, expect, test } from "vitest"
import { slotColor } from "./colors.ts"
import { FIRST_COLORS } from "./presence.tsx"

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
const seeds = Array.from({ length: SLOTS }, (_, i) => i)

/** The colour the stylesheet names `--<name>`, as a six-digit hex; "" for none. */
const named = (name: string): string =>
  new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(html)?.[1] ?? ""
const PALETTE = seeds.map(i => named(`slot-${i}`))

test("the stylesheet has a colour for every slot, and no more", () => {
  expect(PALETTE).not.toContain("")
  expect(html).not.toContain(`--slot-${SLOTS}:`)
})

test("a slot's colour is the stylesheet's for it", () => {
  expect(slotColor(3)).toBe("var(--slot-3)")
  expect(slotColor("pending")).toBe("var(--slot-pending)")
})

test("a fresh branch is grey", () => {
  const [, r, g, b] = /--slot-pending: #(\w)(\w)(\w);/.exec(html) ?? []
  expect(r).toBeDefined()
  expect(new Set([r, g, b]).size).toBe(1)
})

// sRGB to OKLab, for the palette's bounds.
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

describe("the slot colours", () => {
  const page = named("page")
  /** People's first colours, the attention amber, the review's lines. */
  const reserved = [
    ...FIRST_COLORS,
    named("attention"),
    named("ok-soft"),
    named("danger-soft"),
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

  test.each(PALETTE)(
    "%s is apart from the colours that already mean something",
    color => {
      expect(reserved).not.toContain("")
      for (const r of reserved)
        expect(distance(color, r)).toBeGreaterThanOrEqual(0.08)
    },
  )

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
