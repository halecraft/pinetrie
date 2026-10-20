// shell/read — a command read once: its runs by role, and its layout.

import { type ParsedScript, parse } from "unbash"
import { shellLayout } from "./layout.ts"
import { plainSpans, roleSpans, type ShellSpan } from "./spans.ts"
import { statementLines } from "./statements.ts"

/** A text as a reader is shown it. */
export interface ShellText {
  /** Its runs; their texts join to the text. */
  readonly spans: readonly ShellSpan[]
  /** The lines that begin a top-level statement other than the first (`statementLines`). */
  readonly starts: readonly number[]
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
      source: { spans: plainSpans(source), starts: [] },
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
})
