import { readdirSync, readFileSync } from "node:fs"
import { SLOTS } from "@pinetrie/interface"
import { describe, expect, test } from "vitest"
import { slotColor } from "./colors.ts"

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
const seeds = Array.from({ length: SLOTS }, (_, i) => i)

type Scheme = "light" | "dark"
const SCHEMES: readonly Scheme[] = ["light", "dark"]

/** A hex written short (`#fff`) or long, as six digits. */
const long = (hex: string) =>
  hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join("")}` : hex

/**
 * The colour the stylesheet names `--<name>` on a `scheme` page, as six-digit
 * hex: its `light-dark()` value for that page, or its one value; "" for none.
 */
function named(name: string, scheme: Scheme): string {
  const value = new RegExp(`--${name}: ([^;]+);`).exec(html)?.[1]?.trim() ?? ""
  const pair = /^light-dark\((#[0-9a-f]+), (#[0-9a-f]+)\)$/.exec(value)
  const hex = pair === null ? value : scheme === "light" ? pair[1] : pair[2]
  return hex !== undefined && /^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(hex)
    ? long(hex)
    : ""
}
const palette = (scheme: Scheme) => seeds.map(i => named(`slot-${i}`, scheme))

test("the stylesheet has a colour for every slot on both pages, and no more", () => {
  for (const scheme of SCHEMES) expect(palette(scheme)).not.toContain("")
  expect(html).not.toContain(`--slot-${SLOTS}:`)
})

test("a slot's colour is the stylesheet's for it", () => {
  expect(slotColor(3)).toBe("var(--slot-3)")
  expect(slotColor("pending")).toBe("var(--slot-pending)")
})

/**
 * Modules that draw colours a program wrote, not the page's own: a
 * command's 256-colour and RGB output stays as the program wrote it on
 * either page, as a terminal draws it. Its 16 basic colours are still the
 * stylesheet's.
 */
const PROGRAM_COLOURS = ["output-style.ts"]

// A colour written in code would stay as it is on a page with other colours.
test("the page's code writes no colour of its own, only the stylesheet's", () => {
  const dir = new URL(".", import.meta.url)
  const colour =
    /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?![^)]*var\()/i
  const written = readdirSync(dir)
    .filter(f => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .filter(f => !PROGRAM_COLOURS.includes(f))
    .filter(f => colour.test(readFileSync(new URL(f, dir), "utf8")))
  expect(written).toEqual([])
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

describe.each(SCHEMES)("on a %s page", scheme => {
  const page = named("page", scheme)
  const PALETTE = palette(scheme)
  /** People's first colours, the attention amber, the review's lines. */
  const reserved = [
    "person-1",
    "person-2",
    "person-3",
    "attention",
    "ok-soft",
    "danger-soft",
  ].map(n => named(n, scheme))

  test("text reads on the page: faint at 4.5:1 or more, quiet at 3:1", () => {
    expect(page).not.toBe("")
    expect(contrast(named("text-faint", scheme), page)).toBeGreaterThanOrEqual(
      4.5,
    )
    expect(contrast(named("text-quiet", scheme), page)).toBeGreaterThanOrEqual(
      3,
    )
  })

  test.each(Array.from({ length: 16 }, (_, n) => n))(
    "a terminal's colour %i reads on a tool's output: 4.5:1 or more on --sunk",
    n => {
      const sunk = named("sunk", scheme)
      const color = named(`ansi-${n}`, scheme)
      expect([sunk, color]).not.toContain("")
      expect(contrast(color, sunk)).toBeGreaterThanOrEqual(4.5)
    },
  )

  test("a command's stderr bar reads on its output, at 4.5:1 or more on --sunk", () => {
    expect(
      contrast(named("stderr", scheme), named("sunk", scheme)),
    ).toBeGreaterThanOrEqual(4.5)
  })

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
})

describe("the hover pairs", () => {
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
