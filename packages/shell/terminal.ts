// shell/terminal — a terminal's output as structure: its escape sequences
// read, its SGR styles kept as values, and runs of text by style. It knows
// nothing of tool calls or of how a client draws a style.

declare const paletteIndexBrand: unique symbol

/** One of the terminal palette's 256 colours, made only by `paletteIndex`. */
export type PaletteIndex = number & { readonly [paletteIndexBrand]: true }

/** `n` as a palette colour, or null for anything outside 0 to 255. */
export const paletteIndex = (n: number): PaletteIndex | null =>
  Number.isInteger(n) && n >= 0 && n <= 255 ? (n as PaletteIndex) : null

/** The 16 basic colours, which SGR's 30s, 40s, 90s and 100s name by number. */
const BASIC: readonly TerminalColor[] = Array.from({ length: 16 }, (_, i) => ({
  kind: "palette",
  index: i as PaletteIndex,
}))

/** A colour a style names: one of the terminal's palette, or one of its own. */
export type TerminalColor =
  | { readonly kind: "palette"; readonly index: PaletteIndex }
  | {
      readonly kind: "rgb"
      readonly red: number
      readonly green: number
      readonly blue: number
    }

/** What SGR sets on the text after it. A null colour is the terminal's own. */
export interface TerminalStyle {
  readonly fg: TerminalColor | null
  readonly bg: TerminalColor | null
  readonly bold: boolean
  readonly dim: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly inverse: boolean
  readonly strike: boolean
}

export const PLAIN_STYLE: TerminalStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
}

/** Some of an output's text, the style it was written in, and where it starts in the text read. */
export interface StyledRun {
  readonly text: string
  readonly style: TerminalStyle
  /**
   * The offset of its first character in the text `styledRuns` read, escape
   * sequences counted: a range of that text (a pipe's, say) cuts it there.
   */
  readonly at: number
}

/**
 * Every 7-bit escape sequence, in the order tried: a control sequence (CSI);
 * a string one (OSC, DCS, SOS, PM, APC) ended by BEL or ST; a CSI or string
 * the text ends inside of, which a live view cut between two chunks; any
 * other. The order matters: the last would read a cut CSI's `ESC [` as a
 * whole sequence, and leave its parameters as text. The 8-bit C1 forms are
 * left as text, as pi's sanitising leaves them.
 */
const ESCAPE_SEQUENCE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are what it reads
  /\u001b\[([\x30-\x3f]*)([\x20-\x2f]*)([\x40-\x7e])|\u001b[\]P^_X][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b(?:\[[\x30-\x3f]*[\x20-\x2f]*|[\]P^_X][^\u0007\u001b]*)?$|\u001b[\x20-\x2f]*[\x30-\x7e]/g

/** An SGR's parameters, or null for any other sequence. */
const sgrParams = (match: RegExpExecArray): string | null =>
  match[3] === "m" && match[2] === "" && /^[\d;:]*$/.test(match[1] ?? "")
    ? (match[1] ?? "")
    : null

/** Each escape sequence in `text`, and the text before and after them, each text at its offset. */
function* pieces(
  text: string,
): Generator<
  | { readonly kind: "text"; readonly text: string; readonly at: number }
  | { readonly kind: "sgr"; readonly source: string; readonly params: string }
  | { readonly kind: "other" }
> {
  let at = 0
  for (const match of text.matchAll(ESCAPE_SEQUENCE)) {
    if (match.index > at)
      yield { kind: "text", text: text.slice(at, match.index), at }
    const params = sgrParams(match)
    yield params === null
      ? { kind: "other" }
      : { kind: "sgr", source: match[0], params }
    at = match.index + match[0].length
  }
  if (at < text.length) yield { kind: "text", text: text.slice(at), at }
}

/**
 * A terminal's output as kept: its SGR sequences as written, every other
 * escape sequence dropped whole, and `sanitize` applied to the text
 * between, so a control byte it drops can never be an SGR's ESC.
 */
export function sgrOnlyText(
  output: string,
  sanitize: (text: string) => string,
): string {
  let out = ""
  for (const piece of pieces(output))
    if (piece.kind === "text") out += sanitize(piece.text)
    else if (piece.kind === "sgr") out += piece.source
  return out
}

/** Text with every escape sequence dropped. */
export function plainText(text: string): string {
  if (!text.includes("\u001b")) return text
  let out = ""
  for (const piece of pieces(text)) if (piece.kind === "text") out += piece.text
  return out
}

/**
 * Text as runs by the style each part was written in; every sequence but SGR
 * dropped. A run is the text between two sequences, never two joined, so its
 * `at` places all of it.
 */
export function styledRuns(text: string): StyledRun[] {
  const runs: StyledRun[] = []
  let style = PLAIN_STYLE
  for (const piece of pieces(text)) {
    if (piece.kind === "sgr") style = styleAfter(style, piece.params)
    else if (piece.kind === "text")
      runs.push({ text: piece.text, style, at: piece.at })
  }
  return runs
}

/** An RGB channel, or null for anything outside 0 to 255. */
const channelValue = (n: number | undefined): number | null =>
  n !== undefined && Number.isInteger(n) && n >= 0 && n <= 255 ? n : null

/**
 * An extended colour from the numbers after its 38 or 48: `5;n`, or
 * `2;r;g;b` (`2:cs:r:g:b` in the colon form, its colour space ignored), and
 * how many of the fields after its own the `;` form took. A colour out of
 * range is none, and still takes the fields it named.
 */
function extendedColor(
  rest: readonly number[],
  colon: boolean,
): { readonly color: TerminalColor | null; readonly took: number } {
  if (rest[0] === 5) {
    const index = rest[1] === undefined ? null : paletteIndex(rest[1])
    return {
      color: index === null ? null : { kind: "palette", index },
      took: 2,
    }
  }
  if (rest[0] === 2) {
    const [red, green, blue] = (
      colon && rest.length >= 5 ? rest.slice(2, 5) : rest.slice(1, 4)
    ).map(channelValue)
    return {
      color:
        red == null || green == null || blue == null
          ? null
          : { kind: "rgb", red, green, blue },
      took: 4,
    }
  }
  return { color: null, took: 0 }
}

/** What `params` (an SGR's, between `[` and `m`) leaves of `style`. An empty parameter is 0, a reset. */
function styleAfter(style: TerminalStyle, params: string): TerminalStyle {
  const fields = params.split(";")
  let s = style
  for (let i = 0; i < fields.length; i++) {
    const parts = (fields[i] ?? "").split(":").map(p => (p === "" ? 0 : +p))
    const code = parts[0] ?? 0
    const colon = parts.length > 1
    if (code === 38 || code === 48) {
      const rest = colon
        ? parts.slice(1)
        : fields.slice(i + 1).map(f => (f === "" ? 0 : +f))
      const { color, took } = extendedColor(rest, colon)
      if (!colon) i += took
      if (color !== null)
        s = code === 38 ? { ...s, fg: color } : { ...s, bg: color }
      continue
    }
    if (code === 4 && colon) {
      s = { ...s, underline: parts[1] !== 0 }
      continue
    }
    s = styleAfterCode(s, code)
  }
  return s
}

/** What one plain SGR code leaves of `s`; a code it does not draw leaves it. */
function styleAfterCode(s: TerminalStyle, code: number): TerminalStyle {
  if (code >= 30 && code <= 37) return { ...s, fg: BASIC[code - 30] ?? null }
  if (code >= 90 && code <= 97)
    return { ...s, fg: BASIC[code - 90 + 8] ?? null }
  if (code >= 40 && code <= 47) return { ...s, bg: BASIC[code - 40] ?? null }
  if (code >= 100 && code <= 107)
    return { ...s, bg: BASIC[code - 100 + 8] ?? null }
  switch (code) {
    case 0:
      return PLAIN_STYLE
    case 1:
      return { ...s, bold: true }
    case 2:
      return { ...s, dim: true }
    case 3:
      return { ...s, italic: true }
    case 4:
    case 21:
      return { ...s, underline: true }
    case 7:
      return { ...s, inverse: true }
    case 9:
      return { ...s, strike: true }
    case 22:
      return { ...s, bold: false, dim: false }
    case 23:
      return { ...s, italic: false }
    case 24:
      return { ...s, underline: false }
    case 27:
      return { ...s, inverse: false }
    case 29:
      return { ...s, strike: false }
    case 39:
      return { ...s, fg: null }
    case 49:
      return { ...s, bg: null }
    default:
      return s
  }
}
