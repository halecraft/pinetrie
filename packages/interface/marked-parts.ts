// interface/marked-parts — a text cut at ranges of it, for whatever marks
// them: a search's matches, a command's stderr.

import type { TextRange } from "@pinetrie/core"

/** A run of a text, marked when it lies in one of the ranges it was cut at. */
interface MarkedPart {
  readonly text: string
  readonly marked: boolean
}

/**
 * `text` cut at `ranges`, sorted and not overlapping, each part marked when
 * it lies in one; a range reaching past the text is clipped to it. No part
 * is empty, and the parts join back to `text`.
 */
export function markedParts(
  text: string,
  ranges: readonly TextRange[],
): readonly MarkedPart[] {
  const parts: MarkedPart[] = []
  const add = (s: string, marked: boolean) => {
    if (s !== "") parts.push({ text: s, marked })
  }
  let at = 0
  for (const r of ranges) {
    const from = Math.max(at, Math.min(r.from, text.length))
    const to = Math.min(r.to, text.length)
    if (to <= from) continue
    add(text.slice(at, from), false)
    add(text.slice(from, to), true)
    at = to
  }
  add(text.slice(at), false)
  return parts
}
