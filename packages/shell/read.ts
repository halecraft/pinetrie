// shell/read — a command read once: its runs by role, and its layout.

import { type ParsedScript, parse } from "unbash"
import { shellLayout } from "./layout.ts"
import { plainSpans, roleSpans, type ShellSpan } from "./spans.ts"
import { statementLines, statementSpans } from "./statements.ts"

/** A text as a reader is shown it. */
export interface ShellText {
  /** Its runs; their texts join to the text. */
  readonly spans: readonly ShellSpan[]
  /** The lines that begin a top-level statement other than the first (`statementLines`). */
  readonly starts: readonly number[]
  /**
   * Each top-level statement's first and last line, from 0, in order: the
   * same statements, in a layout, as in its source. None for a text that
   * does not parse.
   */
  readonly statements: readonly ShownStatement[]
}

/** The lines of a text one statement lies on, from 0. */
export interface ShownStatement {
  readonly first: number
  readonly last: number
}

export interface ShellRead {
  /** The source; one plain run, and no starts, when it does not parse. */
  readonly source: ShellText
  /**
   * The source laid out to the width; undefined when the layout is the
   * source: it has lines of its own, does not parse, or fits.
   */
  readonly laidOut: ShellText | undefined
}

/** A command as a reader sees it, laid out to `width` columns. */
export function readShell(source: string, width: number): ShellRead {
  const parsed = parse(source)
  if ((parsed.errors?.length ?? 0) > 0)
    return {
      source: { spans: plainSpans(source), starts: [], statements: [] },
      laidOut: undefined,
    }
  const layout = shellLayout(source, parsed, width)
  return {
    source: shellText(source, parsed),
    laidOut:
      layout === undefined ? undefined : shellText(layout.text, layout.parsed),
  }
}

const shellText = (text: string, parsed: ParsedScript): ShellText => ({
  spans: roleSpans(text, parsed),
  starts: statementLines(text, parsed),
  statements: statementSpans(text, parsed).map(s => ({
    first: s.first - 1,
    last: s.last - 1,
  })),
})
