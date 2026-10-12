// shell/read — a command read once: its runs by role, and its layout.

import { parse } from "unbash"
import { layoutOf } from "./layout.ts"
import { plainSpans, type ShellSpan, spansOf } from "./spans.ts"

export interface ShellRead {
  /** The source in runs; their texts join to the source. One plain run when it does not parse. */
  readonly spans: readonly ShellSpan[]
  /**
   * The source laid out to the width, in runs; undefined when the layout is
   * the source: it has lines of its own, does not parse, or fits.
   */
  readonly laidOut: readonly ShellSpan[] | undefined
}

/** A command as a reader sees it, laid out to `width` columns. */
export function readShell(source: string, width: number): ShellRead {
  const parsed = parse(source)
  if ((parsed.errors?.length ?? 0) > 0)
    return { spans: plainSpans(source), laidOut: undefined }
  const layout = layoutOf(source, parsed, width)
  return {
    spans: spansOf(source, parsed),
    laidOut:
      layout === undefined ? undefined : spansOf(layout.text, layout.parsed),
  }
}
