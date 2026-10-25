import type { PaletteIndex, TerminalStyle } from "@pinetrie/interface"
import { expect, test } from "vitest"
import { outputRunStyle } from "./output-style.ts"

const style = (s: Partial<TerminalStyle> = {}): TerminalStyle => ({
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
  ...s,
})
const palette = (n: number) => ({
  kind: "palette" as const,
  index: n as PaletteIndex,
})

test("a style that sets nothing draws bare", () => {
  expect(outputRunStyle(style())).toBeUndefined()
})

test("a basic colour is the stylesheet's, bright ones too", () => {
  expect(outputRunStyle(style({ fg: palette(1) }))).toEqual({
    color: "var(--ansi-1)",
  })
  expect(outputRunStyle(style({ bg: palette(9) }))).toEqual({
    backgroundColor: "var(--ansi-9)",
  })
})

test.each([
  [16, "rgb(0 0 0)"],
  [17, "rgb(0 0 95)"],
  [22, "rgb(0 95 0)"],
  [52, "rgb(95 0 0)"],
  [231, "rgb(255 255 255)"],
  [232, "rgb(8 8 8)"],
  [255, "rgb(238 238 238)"],
])("palette colour %i is the xterm cube's or grey ramp's %s", (n, css) => {
  expect(outputRunStyle(style({ fg: palette(n) }))?.color).toBe(css)
})

test("an RGB colour is drawn as written", () => {
  expect(
    outputRunStyle(style({ fg: { kind: "rgb", red: 1, green: 2, blue: 3 } })),
  ).toEqual({ color: "rgb(1 2 3)" })
})

test("inverse swaps the colours, the output's own standing in for one unset", () => {
  expect(
    outputRunStyle(style({ inverse: true, fg: palette(1), bg: palette(4) })),
  ).toEqual({ color: "var(--ansi-4)", backgroundColor: "var(--ansi-1)" })
  expect(outputRunStyle(style({ inverse: true }))).toEqual({
    color: "var(--sunk)",
    backgroundColor: "var(--text)",
  })
})

test("bold, italic, dim, and underline with strike", () => {
  expect(
    outputRunStyle(
      style({
        bold: true,
        italic: true,
        dim: true,
        underline: true,
        strike: true,
      }),
    ),
  ).toEqual({
    fontWeight: 700,
    fontStyle: "italic",
    opacity: 0.6,
    textDecorationLine: "underline line-through",
  })
})
