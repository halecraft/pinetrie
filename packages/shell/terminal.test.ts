import { describe, expect, test } from "vitest"
import {
  type PaletteIndex,
  PLAIN_STYLE,
  paletteIndex,
  plainText,
  sgrOnlyText,
  styledRuns,
  type TerminalStyle,
} from "./terminal.ts"

const E = "\u001b"
const keep = (t: string) => t
// biome-ignore lint/suspicious/noControlCharactersInRegex: control bytes are what it drops
const noControls = (t: string) => t.replace(/[\x00-\x08\x0e-\x1f]/g, "")

describe("sgrOnlyText", () => {
  test("keeps an SGR as written", () => {
    expect(sgrOnlyText(`${E}[1;32mok${E}[0m`, keep)).toBe(`${E}[1;32mok${E}[0m`)
  })

  test.each([
    ["an erase", `a${E}[2Kb`],
    ["a cursor move", `a${E}[3Ab`],
    ["a private mode", `a${E}[?25lb`],
    ["a private SGR-like sequence", `a${E}[>4;2mb`],
    ["a hyperlink, ended by BEL", `a${E}]8;;http://x\u0007b`],
    ["a title, ended by ST", `a${E}]0;title${E}\\b`],
    ["a charset", `a${E}(Bb`],
    ["a keypad mode", `a${E}=b`],
  ])("drops %s whole", (_, raw) => {
    expect(sgrOnlyText(raw, keep)).toBe("ab")
  })

  test("drops a sequence the text ends inside of", () => {
    expect(sgrOnlyText(`a${E}[1;3`, keep)).toBe("a")
    expect(sgrOnlyText(`a${E}]8;;http://x`, keep)).toBe("a")
  })

  test("sanitizes only the text between sequences, never an SGR's ESC", () => {
    expect(sgrOnlyText(`\x01${E}[31mred\x02`, noControls)).toBe(`${E}[31mred`)
  })
})

test("plainText drops every escape sequence, SGR among them", () => {
  expect(
    plainText(`${E}[2m Tests ${E}[22m${E}[2K ${E}[32m6 passed${E}[39m`),
  ).toBe(" Tests  6 passed")
})

const style = (s: Partial<TerminalStyle>): TerminalStyle => ({
  ...PLAIN_STYLE,
  ...s,
})
const palette = (n: number) => ({
  kind: "palette" as const,
  index: n as PaletteIndex,
})

describe("styledRuns", () => {
  test("splits text at each sequence, each run at its offset in the text read", () => {
    expect(styledRuns(`a${E}[1mb${E}[1mc${E}[22md`)).toEqual([
      { text: "a", style: PLAIN_STYLE, at: 0 },
      { text: "b", style: style({ bold: true }), at: 5 },
      { text: "c", style: style({ bold: true }), at: 10 },
      { text: "d", style: PLAIN_STYLE, at: 16 },
    ])
  })

  test("keeps a style across lines", () => {
    expect(styledRuns(`${E}[31ma\nb`)).toEqual([
      { text: "a\nb", style: style({ fg: palette(1) }), at: 5 },
    ])
  })

  test("drops every sequence but SGR", () => {
    expect(styledRuns(`a${E}[2Kb`).map(r => [r.text, r.at])).toEqual([
      ["a", 0],
      ["b", 5],
    ])
  })

  test("an output with no sequence is one plain run, and an empty one none", () => {
    expect(styledRuns("x\n")).toEqual([
      { text: "x\n", style: PLAIN_STYLE, at: 0 },
    ])
    expect(styledRuns("")).toEqual([])
  })
})

describe("an SGR's parameters", () => {
  const rgb = { kind: "rgb", red: 1, green: 2, blue: 3 } as const
  test.each([
    ["1", "", PLAIN_STYLE],
    ["1", "0", PLAIN_STYLE],
    [
      "0",
      "1;2;3;4;7;9",
      style({
        bold: true,
        dim: true,
        italic: true,
        underline: true,
        inverse: true,
        strike: true,
      }),
    ],
    ["1;2", "22", PLAIN_STYLE],
    ["3;7;9", "23;27;29", PLAIN_STYLE],
    ["0", "21", style({ underline: true })],
    ["0", "4:3", style({ underline: true })],
    ["4", "4:0", PLAIN_STYLE],
    ["4", "24", PLAIN_STYLE],
    ["0", "31", style({ fg: palette(1) })],
    ["0", "91", style({ fg: palette(9) })],
    ["0", "41", style({ bg: palette(1) })],
    ["0", "101", style({ bg: palette(9) })],
    ["31;41", "39;49", PLAIN_STYLE],
    ["0", "38;5;208", style({ fg: palette(208) })],
    ["0", "38;5;1", style({ fg: palette(1) })],
    ["0", "48;2;1;2;3", style({ bg: rgb })],
    ["0", "38:5:208", style({ fg: palette(208) })],
    ["0", "38:2::1:2:3", style({ fg: rgb })],
    ["0", "38:2:1:2:3", style({ fg: rgb })],
    ["0", "38;5;208;1", style({ fg: palette(208), bold: true })],
    ["0", "38;5;300;1", style({ bold: true })],
    ["0", "5;8;53", PLAIN_STYLE],
  ] as const)("ESC[%sm then ESC[%sm", (before, params, after) => {
    expect(styledRuns(`${E}[${before}m${E}[${params}mx`)).toMatchObject([
      { text: "x", style: after },
    ])
  })
})

test("paletteIndex takes 0 to 255, and nothing else", () => {
  expect([0, 255, -1, 256, 1.5].map(paletteIndex)).toEqual([
    0,
    255,
    null,
    null,
    null,
  ])
})
