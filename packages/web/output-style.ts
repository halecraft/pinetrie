// web/output-style — the CSS a run of a terminal's output is drawn in, from
// the style interface read off its SGR. The 16 basic colours are the
// stylesheet's `--ansi-N`, which follow the page's theme; the 256-colour
// cube, its greys and an RGB colour are the program's own, drawn as written,
// as a terminal draws them.

import type { TerminalColor, TerminalStyle } from "@pinetrie/interface"

/** The inline CSS a run sets: React's names for the properties. */
export interface OutputCss {
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontWeight?: number
  readonly fontStyle?: "italic"
  readonly textDecorationLine?: string
  readonly opacity?: number
}

/** The xterm cube's six levels per channel, for palette colours 16 to 231. */
const CUBE = [0, 95, 135, 175, 215, 255] as const

const rgb = (red: number, green: number, blue: number) =>
  `rgb(${red} ${green} ${blue})`

/** A colour as CSS: a basic one the stylesheet's, any other as its value. */
function cssColor(color: TerminalColor): string {
  if (color.kind === "rgb") return rgb(color.red, color.green, color.blue)
  const n = color.index
  if (n < 16) return `var(--ansi-${n})`
  if (n >= 232) {
    const grey = 8 + 10 * (n - 232)
    return rgb(grey, grey, grey)
  }
  const i = n - 16
  const level = (k: number) => CUBE[k] ?? 0
  return rgb(
    level(Math.floor(i / 36)),
    level(Math.floor(i / 6) % 6),
    level(i % 6),
  )
}

/**
 * The CSS a run's style draws as; undefined when it sets nothing, so the run
 * is drawn as bare text. Inverse swaps the colours, the output's own ground
 * (`--sunk`) and text (`--text`) standing in for a colour left unset.
 */
export function outputRunStyle(style: TerminalStyle): OutputCss | undefined {
  const fg = style.fg === null ? undefined : cssColor(style.fg)
  const bg = style.bg === null ? undefined : cssColor(style.bg)
  const [color, backgroundColor] = style.inverse
    ? [bg ?? "var(--sunk)", fg ?? "var(--text)"]
    : [fg, bg]
  const decoration = [
    ...(style.underline ? ["underline"] : []),
    ...(style.strike ? ["line-through"] : []),
  ].join(" ")
  const css: OutputCss = {
    ...(color === undefined ? {} : { color }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(style.bold ? { fontWeight: 700 } : {}),
    ...(style.italic ? { fontStyle: "italic" as const } : {}),
    ...(decoration === "" ? {} : { textDecorationLine: decoration }),
    ...(style.dim ? { opacity: 0.6 } : {}),
  }
  return Object.keys(css).length === 0 ? undefined : css
}
